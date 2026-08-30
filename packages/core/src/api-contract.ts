/**
 * Public API primitives (E20-001..E20-012, E20-030).
 *
 * Three problems this solves once, so every route does not solve it differently:
 *
 *  1. Idempotency. Every mutating endpoint accepts a key, and a replay returns
 *     the ORIGINAL response rather than performing the action again. Without
 *     this, a customer's retry after a timeout double-sends.
 *  2. Cursor pagination. Offset pagination silently skips and repeats rows when
 *     the underlying set changes mid-scan, which for a lead list means missed
 *     and duplicated sends.
 *  3. Error shape. One machine-readable code per failure, and never an internal
 *     identifier or a stack trace in the body.
 *
 * The route registry at the bottom is what generates the OpenAPI spec, and a CI
 * check fails the build when the spec and the implementation drift (E20-031).
 */

// ── Errors ───────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "idempotency_key_reuse"
  | "rate_limited"
  | "quota_exceeded"
  | "policy_blocked"
  | "not_ready"
  | "internal_error";

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 422,
  conflict: 409,
  idempotency_key_reuse: 409,
  rate_limited: 429,
  quota_exceeded: 402,
  policy_blocked: 451, // Unavailable For Legal Reasons — precisely what it is
  not_ready: 409,
  internal_error: 500,
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Written for the person reading it, not for a log grep. */
    message: string;
    /** Field-level detail for validation failures only. */
    fields?: Array<{ path: string; message: string }>;
    /** Correlation id so support can find the request without asking for a screenshot. */
    requestId: string;
  };
}

/**
 * Messages are sanitised before they leave the process. An internal id, a file
 * path or a stack frame in an error body is an information leak (E20-010).
 */
const LEAK_PATTERNS: RegExp[] = [
  /\/(?:Users|home|srv|var|opt)\/[^\s"']+/g,   // filesystem paths
  /\bat\s+\w+\s+\(.*?\)/g,                      // stack frames
  /\b(?:postgres|postgresql|redis|clickhouse):\/\/[^\s"']+/gi, // connection strings
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\bc[a-z0-9]{24}\b/g,                          // cuids
];

export function sanitizeMessage(message: string): string {
  let out = message;
  for (const p of LEAK_PATTERNS) out = out.replace(p, "[redacted]");
  return out.slice(0, 400);
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  fields?: ApiErrorBody["error"]["fields"],
): ApiErrorBody {
  return { error: { code, message: sanitizeMessage(message), requestId, ...(fields ? { fields } : {}) } };
}

// ── Idempotency ──────────────────────────────────────────────────────────────

export interface IdempotencyRecord {
  key: string;
  /** Hash of the request body — a reused key with a DIFFERENT body is an error. */
  requestHash: string;
  status: number;
  body: string;
  createdAt: Date;
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  put(scope: string, record: IdempotencyRecord, ttlSec: number): Promise<void>;
}

export type IdempotencyOutcome =
  | { kind: "proceed" }
  | { kind: "replay"; status: number; body: string }
  | { kind: "conflict"; message: string };

/**
 * A reused key with the SAME body replays the original response. A reused key
 * with a DIFFERENT body is a client bug and must be an error — silently doing
 * the new thing under an old key is how a retry becomes a wrong send.
 */
export async function checkIdempotency(
  store: IdempotencyStore,
  scope: string,
  key: string | null,
  requestHash: string,
): Promise<IdempotencyOutcome> {
  if (!key) return { kind: "proceed" };
  const prior = await store.get(scope, key);
  if (!prior) return { kind: "proceed" };
  if (prior.requestHash !== requestHash) {
    return {
      kind: "conflict",
      message: "This Idempotency-Key was already used with a different request body.",
    };
  }
  return { kind: "replay", status: prior.status, body: prior.body };
}

export function hashBody(body: string): string {
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) { h ^= body.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0).toString(36);
}

export const IDEMPOTENCY_TTL_SEC = 24 * 60 * 60;

// ── Cursor pagination ────────────────────────────────────────────────────────

export interface Cursor {
  /** Sort value of the last row returned — the stable anchor. */
  at: string;
  /** Tie-break so rows sharing a timestamp are neither skipped nor repeated. */
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!at || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export interface Page<T> {
  data: T[];
  /** null when this is the last page. Never a total count — it would be a lie
   *  under concurrent writes and an expensive one to compute. */
  nextCursor: string | null;
  hasMore: boolean;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

/**
 * Build a page from limit+1 rows: the extra row proves there is a next page
 * without a second query or a count.
 */
export function toPage<T>(
  rows: T[], limit: number, cursorOf: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Fleet WRITES are operator-only and are deliberately not reachable with a
 * tenant key at all (E20-023) — provisioning a node is not a customer action.
 */
export type Scope =
  | "sending"      // create sends, enrol leads
  | "read"         // read anything the org owns
  | "leads.write"
  | "campaigns.write"
  | "fleet.read"
  | "fleet.write"  // operator only
  | "full";

export const SCOPE_IMPLIES: Record<Scope, Scope[]> = {
  full: ["sending", "read", "leads.write", "campaigns.write", "fleet.read", "fleet.write"],
  sending: ["read"],
  "leads.write": ["read"],
  "campaigns.write": ["read"],
  "fleet.write": ["fleet.read", "read"],
  "fleet.read": ["read"],
  read: [],
};

export function grants(held: Scope[], required: Scope): boolean {
  return held.some((s) => s === required || SCOPE_IMPLIES[s].includes(required));
}

// ── Route registry → OpenAPI ─────────────────────────────────────────────────

export interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  scope: Scope;
  /** Mutating routes must declare whether they honour Idempotency-Key. */
  idempotent?: boolean;
  paginated?: boolean;
  /** Documented failure codes beyond the universal ones. */
  errors?: ApiErrorCode[];
}

export const API_VERSION = "v1";

/**
 * The single source of truth for the public surface. The OpenAPI document is
 * generated from this, and a CI check asserts every mutating route declares its
 * idempotency posture and that nothing is registered without a scope.
 */
export const ROUTES: RouteDef[] = [
  // Leads
  { method: "POST",   path: "/v1/leads",             summary: "Create or upsert a lead",        scope: "leads.write", idempotent: true, errors: ["validation_error", "quota_exceeded"] },
  { method: "GET",    path: "/v1/leads",             summary: "List leads",                     scope: "read", paginated: true },
  { method: "GET",    path: "/v1/leads/{id}",        summary: "Get a lead",                     scope: "read", errors: ["not_found"] },
  { method: "PATCH",  path: "/v1/leads/{id}",        summary: "Update a lead",                  scope: "leads.write", idempotent: true, errors: ["not_found", "validation_error"] },
  // Naturally idempotent: erasing an already-erased lead is a success, not a 404.
  { method: "DELETE", path: "/v1/leads/{id}",        summary: "Erase a lead (suppression is retained)", scope: "leads.write", idempotent: true, errors: ["not_found"] },
  { method: "POST",   path: "/v1/leads/import",      summary: "Bulk import with a provenance attestation", scope: "leads.write", idempotent: true, errors: ["validation_error", "policy_blocked"] },

  // Lists
  { method: "POST",   path: "/v1/lists",             summary: "Create a list",                  scope: "leads.write", idempotent: true },
  { method: "GET",    path: "/v1/lists",             summary: "List lists",                     scope: "read", paginated: true },
  { method: "GET",    path: "/v1/lists/{id}/compliance", summary: "Per-row compliance report",  scope: "read", errors: ["not_found"] },
  { method: "POST",   path: "/v1/lists/{id}/activate",   summary: "Activate a list for sending", scope: "leads.write", idempotent: true, errors: ["policy_blocked", "not_ready"] },

  // Campaigns
  { method: "POST",   path: "/v1/campaigns",         summary: "Create a campaign",              scope: "campaigns.write", idempotent: true },
  { method: "GET",    path: "/v1/campaigns",         summary: "List campaigns",                 scope: "read", paginated: true },
  { method: "GET",    path: "/v1/campaigns/{id}",    summary: "Get a campaign",                 scope: "read", errors: ["not_found"] },
  { method: "PATCH",  path: "/v1/campaigns/{id}",    summary: "Update a campaign",              scope: "campaigns.write", idempotent: true, errors: ["not_found", "conflict"] },
  { method: "POST",   path: "/v1/campaigns/{id}/launch", summary: "Launch a campaign",          scope: "campaigns.write", idempotent: true, errors: ["not_ready", "policy_blocked", "quota_exceeded"] },
  { method: "POST",   path: "/v1/campaigns/{id}/pause",  summary: "Pause a campaign",           scope: "campaigns.write", idempotent: true, errors: ["not_found"] },
  { method: "POST",   path: "/v1/campaigns/{id}/enrol",  summary: "Enrol leads into a campaign", scope: "campaigns.write", idempotent: true, errors: ["policy_blocked"] },

  // Verification
  { method: "POST",   path: "/v1/verify",            summary: "Verify one address",             scope: "sending", idempotent: true, errors: ["quota_exceeded"] },
  { method: "POST",   path: "/v1/verify/batch",      summary: "Verify a batch (async job)",     scope: "sending", idempotent: true, errors: ["quota_exceeded"] },
  { method: "GET",    path: "/v1/verify/jobs/{id}",  summary: "Get a verification job",         scope: "read", errors: ["not_found"] },

  // Suppression + unsubscribe
  { method: "GET",    path: "/v1/suppressions",      summary: "List suppressions",              scope: "read", paginated: true },
  { method: "POST",   path: "/v1/suppressions",      summary: "Suppress an address",            scope: "leads.write", idempotent: true },
  // Providers retry the one-click POST. Unsubscribing twice must be a success,
  // never an error — a failed retry that leaves someone subscribed is illegal.
  { method: "POST",   path: "/v1/unsubscribe",       summary: "RFC 8058 one-click unsubscribe", scope: "read", idempotent: true },

  // Deliverability (read-only: these are measurements, not settings)
  { method: "GET",    path: "/v1/deliverability/placement",  summary: "Seed placement results", scope: "read" },
  { method: "GET",    path: "/v1/deliverability/reputation", summary: "Reputation with its decomposition", scope: "read" },
  { method: "GET",    path: "/v1/deliverability/listings",   summary: "Active blocklist listings", scope: "read" },
  { method: "GET",    path: "/v1/messages/{messageId}/journey", summary: "Full journey of one message", scope: "read", errors: ["not_found"] },

  // Fleet
  { method: "GET",    path: "/v1/fleet/nodes",       summary: "List blast nodes",               scope: "fleet.read", paginated: true },
  { method: "GET",    path: "/v1/fleet/domains",     summary: "List sending domains",           scope: "fleet.read", paginated: true },
  { method: "GET",    path: "/v1/fleet/mailboxes",   summary: "List mailboxes",                 scope: "fleet.read", paginated: true },
  { method: "POST",   path: "/v1/fleet/nodes",       summary: "Provision a node (operator only)", scope: "fleet.write", idempotent: true, errors: ["forbidden"] },
  { method: "POST",   path: "/v1/fleet/mailboxes/{id}/drain", summary: "Drain a mailbox (operator only)", scope: "fleet.write", idempotent: true, errors: ["forbidden", "not_found"] },

  // Inbox
  { method: "GET",    path: "/v1/threads",           summary: "List inbox threads",             scope: "read", paginated: true },
  { method: "GET",    path: "/v1/threads/{id}",      summary: "Get a thread",                   scope: "read", errors: ["not_found"] },
  { method: "POST",   path: "/v1/threads/{id}/reply", summary: "Reply on a thread",             scope: "sending", idempotent: true, errors: ["not_found", "policy_blocked"] },

  // Compliance evidence
  { method: "GET",    path: "/v1/policy/decisions",  summary: "Policy decisions (audit evidence)", scope: "read", paginated: true },
  { method: "POST",   path: "/v1/privacy/export",    summary: "Request a data export",          scope: "read", idempotent: true },
  { method: "POST",   path: "/v1/privacy/erase",     summary: "Request erasure",                scope: "leads.write", idempotent: true },

  // Usage
  { method: "GET",    path: "/v1/usage",             summary: "Metered usage this period",      scope: "read" },
];

export interface RegistryDefect {
  route: string;
  problem: string;
}

/** Invariants over the surface itself, checked in CI (E20-031). */
export function auditRegistry(routes: RouteDef[] = ROUTES): RegistryDefect[] {
  const defects: RegistryDefect[] = [];
  const seen = new Set<string>();

  for (const r of routes) {
    const id = `${r.method} ${r.path}`;
    if (seen.has(id)) defects.push({ route: id, problem: "duplicate route" });
    seen.add(id);

    if (!r.path.startsWith(`/${API_VERSION}/`)) {
      defects.push({ route: id, problem: "not under the versioned prefix" });
    }
    if (r.method !== "GET" && r.idempotent === undefined) {
      defects.push({ route: id, problem: "mutating route does not declare its idempotency posture" });
    }
    if (r.method === "GET" && r.idempotent !== undefined) {
      defects.push({ route: id, problem: "GET declares idempotency, which is meaningless" });
    }
    if (r.summary.trim() === "") defects.push({ route: id, problem: "missing summary" });
    for (const m of r.path.matchAll(/\{([^}]*)\}/g)) {
      const param = m[1] ?? "";
      // lowerCamelCase: starts lowercase, letters and digits only. `messageId`
      // is fine; `MessageId` and `message_id` are not.
      if (!/^[a-z][a-zA-Z0-9]*$/.test(param)) {
        defects.push({ route: id, problem: `path parameter "${param}" is not lowerCamelCase` });
      }
    }
  }
  return defects;
}

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
}

export function toOpenApi(routes: RouteDef[] = ROUTES): OpenApiDoc {
  const paths: OpenApiDoc["paths"] = {};
  for (const r of routes) {
    paths[r.path] ??= {};
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1], in: "path", required: true, schema: { type: "string" },
    }));
    if (r.paginated) {
      params.push({ name: "cursor", in: "query", required: false, schema: { type: "string" } } as never);
      params.push({ name: "limit", in: "query", required: false, schema: { type: "integer" } } as never);
    }
    const codes = ["unauthorized", "forbidden", "rate_limited", "internal_error", ...(r.errors ?? [])];
    paths[r.path]![r.method.toLowerCase()] = {
      summary: r.summary,
      security: [{ apiKey: [] }],
      "x-required-scope": r.scope,
      ...(r.idempotent ? { "x-idempotent": true } : {}),
      parameters: params,
      responses: Object.fromEntries([
        ["200", { description: "OK" }],
        ...[...new Set(codes)].map((c) => [String(ERROR_STATUS[c as ApiErrorCode]), { description: c }]),
      ]),
    };
  }
  return { openapi: "3.1.0", info: { title: "Electronic Mail Services API", version: API_VERSION }, paths };
}
