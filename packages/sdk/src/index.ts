/**
 * ems — official SDK.
 *
 *   import { EMS } from "ems";
 *   const um = new EMS(process.env.EMS_API_KEY!);
 *   await um.emails.send({ from: "you@yourdomain.com", to: "user@acme.com",
 *                          subject: "Hi", html: "<p>Hello</p>" });
 *
 * Zero dependencies — uses the global `fetch` (Node 18+, edge runtimes, browsers).
 */

import { createInboxesResource } from "./inboxes.js";

export interface EMSOptions {
  apiKey: string;
  /** Defaults to https://api.electronicmailservices.com */
  baseUrl?: string;
  /** Override fetch (e.g. for tests / custom agents). */
  fetch?: typeof fetch;
}

export type Recipients = string | string[];

export interface SendEmailParams {
  from: string;
  to: Recipients;
  subject: string;
  html?: string;
  text?: string;
  cc?: Recipients;
  bcc?: Recipients;
  replyTo?: Recipients;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  /**
   * When to send, as an ISO-8601 timestamp with an explicit UTC offset —
   * `"2026-08-12T09:30:00Z"` or `"2026-08-12T09:30:00-04:00"`. Must be in the
   * future; anything else (including natural language) is rejected with a 422.
   */
  scheduledAt?: string;
  /** Dedupe key — repeats with the same key return the original send. */
  idempotencyKey?: string;
}

export interface SendEmailResponse {
  id: string;
}

export interface EmailRecord {
  id: string;
  to: string[];
  subject: string;
  status: string;
  from?: string;
  created_at?: string;
  events?: { type: string; at: string }[];
}

export type VerifyStatus = "deliverable" | "risky" | "undeliverable" | "unknown";

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  reasons: string[];
}

export interface VerifyResponse {
  results: VerifyResult[];
  summary: {
    total: number;
    deliverable: number;
    risky: number;
    undeliverable: number;
    unknown: number;
  };
}

export interface DomainHealth {
  domain: string;
  checkedAt: string;
  /** 0-100 mail-health score */
  score: number;
  mx: { host: string; priority: number }[];
  spf: {
    record: string | null;
    recordCount: number;
    lookups: number;
    lookupLimit: number;
    overLimit: boolean;
    all: string | null;
  };
  dmarc: { record: string | null; policy: string | null; pct: string | null; rua: string[] };
  dkim: { selector: string; present: boolean }[];
  /** Detected sending platforms (e.g. "Google Workspace", "Resend", "ems"). */
  senders: string[];
  risks: { level: "ok" | "warn" | "error"; title: string; detail: string }[];
}

export class EMSError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EMSError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_BASE_URL = "https://api.electronicmailservices.com";

export class EMS {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKeyOrOptions: string | EMSOptions, options?: Omit<EMSOptions, "apiKey">) {
    const opts: EMSOptions =
      typeof apiKeyOrOptions === "string"
        ? { apiKey: apiKeyOrOptions, ...options }
        : apiKeyOrOptions;
    if (!opts.apiKey) throw new Error("ems: an API key is required.");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("ems: no global fetch — use Node 18+ or pass { fetch }.");
    }
    this.inboxes = createInboxesResource((path, init) => this.request(path, init));
  }

  /**
   * Programmatic inboxes. Create/update/delete need a full-access key;
   * read, send, and reply work with either key kind. Check
   * `inboxes.domains()` — `receiving` is a live MX probe, so we never hand
   * out an address that cannot receive.
   */
  readonly inboxes: ReturnType<typeof createInboxesResource>;

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const { idempotencyKey, headers, ...rest } = init;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new EMSError(
        res.status,
        String(body.name ?? "error"),
        String(body.message ?? `HTTP ${res.status}`),
      );
    }
    return body as T;
  }

  /** Map camelCase params to the on-the-wire snake_case fields (reply_to, scheduled_at). */
  private toWire(params: SendEmailParams): Record<string, unknown> {
    const { replyTo, scheduledAt, idempotencyKey: _i, ...rest } = params;
    return {
      ...rest,
      ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
      ...(scheduledAt !== undefined ? { scheduled_at: scheduledAt } : {}),
    };
  }

  /** Sending. */
  emails = {
    send: (params: SendEmailParams): Promise<SendEmailResponse> =>
      this.request<SendEmailResponse>("/emails", {
        method: "POST",
        idempotencyKey: params.idempotencyKey,
        body: JSON.stringify(this.toWire(params)),
      }),
    /** Send up to 100 messages in one call. Returns a per-item id or error. */
    batch: (
      messages: SendEmailParams[],
    ): Promise<{ data: Array<{ id: string } | { error: string }> }> =>
      this.request("/emails/batch", {
        method: "POST",
        body: JSON.stringify(messages.map((m) => this.toWire(m))),
      }),
    /**
     * Cancel a scheduled or queued message before it sends. Idempotent — a
     * second call on an already-cancelled message succeeds. Throws 409
     * `not_cancelable` once the message has left.
     */
    cancel: (id: string): Promise<{ id: string; status: "canceled" }> =>
      this.request(`/emails/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    get: (id: string): Promise<EmailRecord> =>
      this.request<EmailRecord>(`/emails/${encodeURIComponent(id)}`),
    /** Recent send log (most recent 50). */
    list: (): Promise<{ data: EmailRecord[] }> => this.request("/emails"),
  };

  /**
   * Verify one or many addresses BEFORE sending — flags invalid, dead-domain,
   * disposable, role-based, blacklisted, and suppressed addresses.
   */
  verify(emails: string | string[]): Promise<VerifyResponse> {
    const list = Array.isArray(emails) ? emails : [emails];
    return this.request<VerifyResponse>("/verify", {
      method: "POST",
      body: JSON.stringify({ emails: list }),
    });
  }

  /** Account overview: totals, last-24h, delivery rate, domain + active-key counts. */
  stats(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/stats");
  }

  /**
   * Sending domains. `create` returns the DNS records to publish; `verify`
   * re-checks live DNS and flips the domain to verified once DKIM resolves.
   * Management calls require a full-access key.
   */
  domains = {
    health: (domain: string, dkimSelectors?: string[]): Promise<DomainHealth> => {
      const q = new URLSearchParams({ domain });
      if (dkimSelectors?.length) q.set("dkim", dkimSelectors.join(","));
      return this.request<DomainHealth>(`/domains/health?${q.toString()}`);
    },
    list: (): Promise<{ data: DomainRecord[] }> => this.request("/domains"),
    create: (name: string): Promise<DomainRecord & { records: DomainDnsRecord[] }> =>
      this.request("/domains", { method: "POST", body: JSON.stringify({ name }) }),
    get: (id: string): Promise<DomainRecord & { records: DomainDnsRecord[] }> =>
      this.request(`/domains/${encodeURIComponent(id)}`),
    verify: (
      id: string,
    ): Promise<DomainRecord & { verified: boolean; records: DomainRecordCheck[] }> =>
      this.request(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" }),
    remove: (id: string): Promise<{ id: string; deleted: boolean }> =>
      this.request(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };

  /**
   * API keys. Lets a customer, agency, or agent provision credentials over the
   * API instead of the dashboard. Every call needs a FULL-ACCESS key; keys you
   * paste into an app should be `sending_access` so a leak can't escalate.
   */
  apiKeys = {
    list: (): Promise<{ data: ApiKeyRecord[] }> => this.request("/api-keys"),
    /** The token is returned ONCE. Store it immediately — it is never retrievable. */
    create: (params: {
      name: string;
      permission?: ApiKeyPermission;
    }): Promise<ApiKeyRecord & { token: string }> =>
      this.request("/api-keys", { method: "POST", body: JSON.stringify(params) }),
    remove: (id: string): Promise<{ id: string; revoked: boolean }> =>
      this.request(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}

export type ApiKeyPermission = "full_access" | "sending_access";

export interface ApiKeyRecord {
  id: string;
  name: string;
  permission: ApiKeyPermission;
  prefix?: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface DomainRecord {
  id: string;
  name: string;
  status: "pending" | "verified" | "failed";
  verifiedAt?: string | null;
  createdAt?: string;
}

/** A DNS record to publish for a sending domain. */
export interface DomainDnsRecord {
  purpose: string;
  type: string;
  host: string;
  value: string;
}

/** The result of checking one published record during verification. */
export interface DomainRecordCheck {
  key: string;
  type: string;
  host: string;
  value: string;
  status: "verified" | "missing" | "mismatch";
  found: string | null;
}

export * from "./templates.js";

/** Event names delivered to a webhook endpoint. */
export type WebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.bounced"
  | "email.complained"
  | "email.inbound";

/** Body POSTed to your webhook endpoint. Also sent in the `ems-event` header. */
export interface WebhookEvent {
  type: WebhookEventType;
  /** ISO-8601 timestamp of when the event fired. */
  created_at: string;
  data: {
    /** Present on send-lifecycle events. Absent on `email.inbound`. */
    email_id?: string;
    /** Hosted mailbox that received the message (`email.inbound`). */
    mailbox?: string;
    to: string[];
    from: string;
    subject: string | null;
    /** Bounce/complaint diagnostics, inbound snippet/body, … */
    [key: string]: unknown;
  };
}

const HEX = /^[0-9a-f]+$/i;

// Return type is inferred (not annotated `Uint8Array`) so it keeps its
// ArrayBuffer backing — `crypto.subtle` rejects a possibly-shared buffer.
function hexToBytes(hex: string) {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify the `ems-signature` header on an incoming webhook.
 *
 *   import { verifyWebhook } from "ems";
 *
 *   const raw = await req.text();            // RAW body — see the warning below
 *   const ok  = await verifyWebhook({
 *     payload:   raw,
 *     signature: req.headers.get("ems-signature"),
 *     secret:    process.env.EMS_WEBHOOK_SECRET!,
 *   });
 *   if (!ok) return new Response("bad signature", { status: 400 });
 *   const event = JSON.parse(raw) as WebhookEvent;
 *
 * IMPORTANT: hash the **raw** request body. Parsing and re-serializing JSON
 * changes the bytes and the signature will never match.
 *
 * Uses WebCrypto, so it runs unchanged on Node 18+, edge runtimes, and browsers.
 * The comparison is constant-time (delegated to `crypto.subtle.verify`).
 */
export async function verifyWebhook(opts: {
  /** Raw request body exactly as received. */
  payload: string | Uint8Array;
  /** Value of the `ems-signature` header (`sha256=<hex>`). */
  signature: string | null | undefined;
  /** The endpoint's signing secret, shown once when the endpoint was created. */
  secret: string;
}): Promise<boolean> {
  const { payload, signature, secret } = opts;
  if (!signature || !secret) return false;
  if (!signature.startsWith("sha256=")) return false;

  const sigBytes = hexToBytes(signature.slice("sha256=".length));
  if (!sigBytes) return false;

  const enc = new TextEncoder();
  // Copy a caller-supplied view into a fresh ArrayBuffer-backed array: WebCrypto
  // will not accept a SharedArrayBuffer-backed view.
  const body = typeof payload === "string" ? enc.encode(payload) : new Uint8Array(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, body);
}

export default EMS;

export {
  createInboxesResource,
  type InboxKind,
  type InboxRecord,
  type InboxDomain,
  type InboxMessage,
  type InboxThread,
  type CreateInboxParams,
  type UpdateInboxParams,
  type ListMessagesQuery,
  type SendFromInboxParams,
  type ReplyParams,
} from "./inboxes.js";
