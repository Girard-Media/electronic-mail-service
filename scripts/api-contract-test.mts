/**
 * API contract test (E20-087..E20-091, E20-031).
 *
 * The registry audit is the CI gate on the public surface: nothing ships
 * unversioned, unscoped, or with an undeclared idempotency posture.
 */
import {
  ERROR_STATUS, errorBody, sanitizeMessage,
  checkIdempotency, hashBody, IDEMPOTENCY_TTL_SEC,
  encodeCursor, decodeCursor, clampLimit, toPage, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
  grants, SCOPE_IMPLIES, ROUTES, auditRegistry, toOpenApi, API_VERSION,
  type IdempotencyStore, type IdempotencyRecord, type Scope, type RouteDef,
} from "../packages/core/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}
const AT = new Date("2026-08-30T00:00:00Z");

console.log("\n--- errors leak nothing ---");
ok("a filesystem path is redacted",
  !sanitizeMessage("failed at /Users/girardmedia/secret/file.ts").includes("girardmedia"));
ok("a connection string is redacted",
  !sanitizeMessage("postgresql://ems:hunter2@10.0.0.2:5432/ems down").includes("hunter2"));
ok("a stack frame is redacted",
  !sanitizeMessage("boom at handler (src/routes/emails.ts:44)").includes("routes/emails"));
ok("a cuid is redacted",
  !sanitizeMessage("lead clh3k9x2p0001qz8v4n7d6a1b not found").includes("clh3k9x2p0001qz8v4n7d6a1b"));
ok("a uuid is redacted",
  !sanitizeMessage("job 3f2a1c4d-91ab-4cde-8f01-2b3c4d5e6f70 failed").includes("3f2a1c4d-91ab"));
ok("an ordinary message survives",
  sanitizeMessage("That address is suppressed.") === "That address is suppressed.");
ok("messages are length-capped", sanitizeMessage("x".repeat(999)).length <= 400);
{
  const b = errorBody("policy_blocked", "Germany requires prior consent.", "req_1");
  ok("the body carries a machine-readable code", b.error.code === "policy_blocked");
  ok("and a correlation id for support", b.error.requestId === "req_1");
}
ok("a policy block is 451, which is literally what it means", ERROR_STATUS.policy_blocked === 451);
ok("a quota breach is 402, not 500", ERROR_STATUS.quota_exceeded === 402);
ok("every code maps to a status", Object.values(ERROR_STATUS).every((s) => s >= 400 && s < 600));

console.log("\n--- idempotency ---");
function store(): IdempotencyStore & { map: Map<string, IdempotencyRecord> } {
  const map = new Map<string, IdempotencyRecord>();
  return {
    map,
    async get(scope, key) { return map.get(`${scope}:${key}`) ?? null; },
    async put(scope, rec) { map.set(`${scope}:${rec.key}`, rec); },
  };
}
{
  const s = store();
  const body = JSON.stringify({ to: "a@b.com" });
  ok("no key means just proceed",
    (await checkIdempotency(s, "sends", null, hashBody(body))).kind === "proceed");
  ok("an unseen key proceeds",
    (await checkIdempotency(s, "sends", "k1", hashBody(body))).kind === "proceed");

  await s.put("sends", { key: "k1", requestHash: hashBody(body), status: 201, body: '{"id":"m1"}', createdAt: AT }, IDEMPOTENCY_TTL_SEC);

  const replay = await checkIdempotency(s, "sends", "k1", hashBody(body));
  ok("a replay with the SAME body returns the original response", replay.kind === "replay");
  ok("including the original status and body",
    replay.kind === "replay" && replay.status === 201 && replay.body === '{"id":"m1"}');

  const conflict = await checkIdempotency(s, "sends", "k1", hashBody(JSON.stringify({ to: "different@b.com" })));
  ok("a reused key with a DIFFERENT body is a conflict, not a silent new send",
    conflict.kind === "conflict");
  ok("and says why", conflict.kind === "conflict" && conflict.message.includes("different request body"));
}
{
  const s = store();
  await s.put("sends", { key: "k1", requestHash: "h", status: 200, body: "{}", createdAt: AT }, 1);
  ok("keys are scoped per endpoint, so the same key on another route proceeds",
    (await checkIdempotency(s, "campaigns", "k1", "h")).kind === "proceed");
}
ok("the same body always hashes the same", hashBody('{"a":1}') === hashBody('{"a":1}'));
ok("a different body hashes differently", hashBody('{"a":1}') !== hashBody('{"a":2}'));

console.log("\n--- cursor pagination ---");
{
  const c = { at: "2026-08-30T00:00:00.000Z", id: "lead_9" };
  ok("a cursor round-trips", JSON.stringify(decodeCursor(encodeCursor(c))) === JSON.stringify(c));
  ok("garbage decodes to null, it does not throw", decodeCursor("!!!not-base64!!!") === null);
  ok("an empty cursor decodes to null", decodeCursor("") === null);
}
ok("no limit uses the default", clampLimit(undefined) === DEFAULT_PAGE_SIZE);
ok("an oversized limit is clamped", clampLimit(100000) === MAX_PAGE_SIZE);
ok("a negative limit falls back", clampLimit(-5) === DEFAULT_PAGE_SIZE);
ok("a non-numeric limit falls back", clampLimit("abc") === DEFAULT_PAGE_SIZE);
{
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, at: `2026-08-30T00:00:0${i}.000Z` }));
  const page = toPage(rows, 5, (r) => ({ at: r.at, id: r.id }));
  ok("limit+1 rows means there IS more", page.hasMore && page.data.length === 5);
  ok("and a next cursor is issued", page.nextCursor !== null);
  ok("the cursor anchors on the LAST returned row",
    decodeCursor(page.nextCursor!)?.id === "r4");
}
{
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, at: "same" }));
  const page = toPage(rows, 5, (r) => ({ at: r.at, id: r.id }));
  ok("a short page has no next cursor", !page.hasMore && page.nextCursor === null);
}
{
  // Rows sharing a timestamp are exactly where offset pagination loses data.
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, at: "2026-08-30T00:00:00.000Z" }));
  const page = toPage(rows, 3, (r) => ({ at: r.at, id: r.id }));
  const cur = decodeCursor(page.nextCursor!)!;
  ok("the id tie-break disambiguates identical timestamps", cur.at === rows[0]!.at && cur.id === "r2");
}

console.log("\n--- scopes ---");
ok("full grants everything", (Object.keys(SCOPE_IMPLIES) as Scope[]).every((s) => grants(["full"], s)));
ok("sending implies read", grants(["sending"], "read"));
ok("read does NOT imply sending", !grants(["read"], "sending"));
ok("read does not imply fleet.read", !grants(["read"], "fleet.read"));
ok("fleet.read does not imply fleet.write", !grants(["fleet.read"], "fleet.write"));
ok("fleet.write implies fleet.read", grants(["fleet.write"], "fleet.read"));
ok("leads.write does not imply campaigns.write", !grants(["leads.write"], "campaigns.write"));
ok("holding several scopes unions them", grants(["read", "leads.write"], "leads.write"));

console.log("\n--- the registry audit (the CI gate) ---");
{
  const defects = auditRegistry();
  ok("the shipped registry has no defects", defects.length === 0,
    defects.map((d) => `${d.route}: ${d.problem}`).join("; "));
}
{
  const bad: RouteDef[] = [
    { method: "POST", path: "/leads", summary: "unversioned", scope: "read", idempotent: true },
  ];
  ok("an unversioned route is caught",
    auditRegistry(bad).some((d) => d.problem.includes("versioned prefix")));
}
{
  const bad: RouteDef[] = [
    { method: "POST", path: "/v1/x", summary: "no posture", scope: "read" },
  ];
  ok("a mutating route with no idempotency posture is caught",
    auditRegistry(bad).some((d) => d.problem.includes("idempotency posture")));
}
{
  const bad: RouteDef[] = [
    { method: "GET", path: "/v1/x", summary: "meaningless", scope: "read", idempotent: true },
  ];
  ok("a GET claiming idempotency is caught", auditRegistry(bad).length === 1);
}
{
  const bad: RouteDef[] = [
    { method: "GET", path: "/v1/x", summary: "a", scope: "read" },
    { method: "GET", path: "/v1/x", summary: "b", scope: "read" },
  ];
  ok("a duplicate route is caught", auditRegistry(bad).some((d) => d.problem === "duplicate route"));
}
{
  const bad: RouteDef[] = [
    { method: "GET", path: "/v1/leads/{LeadID}", summary: "a", scope: "read" },
  ];
  ok("a PascalCase path parameter is caught",
    auditRegistry(bad).some((d) => d.problem.includes("lowerCamelCase")));
}
{
  const bad: RouteDef[] = [
    { method: "GET", path: "/v1/leads/{lead_id}", summary: "a", scope: "read" },
  ];
  ok("a snake_case path parameter is caught",
    auditRegistry(bad).some((d) => d.problem.includes("lowerCamelCase")));
}
{
  const good: RouteDef[] = [
    { method: "GET", path: "/v1/messages/{messageId}", summary: "a", scope: "read" },
  ];
  ok("a genuine lowerCamelCase parameter is NOT flagged", auditRegistry(good).length === 0,
    JSON.stringify(auditRegistry(good)));
}

console.log("\n--- surface invariants ---");
ok("every route is versioned", ROUTES.every((r) => r.path.startsWith(`/${API_VERSION}/`)));
ok("every route declares a scope", ROUTES.every((r) => typeof r.scope === "string" && r.scope.length > 0));
ok("every mutating route declares idempotency",
  ROUTES.filter((r) => r.method !== "GET").every((r) => r.idempotent !== undefined));
ok("fleet writes are operator-scoped only",
  ROUTES.filter((r) => r.path.startsWith("/v1/fleet/") && r.method !== "GET")
        .every((r) => r.scope === "fleet.write"));
ok("deliverability is read-only — these are measurements, not settings",
  ROUTES.filter((r) => r.path.startsWith("/v1/deliverability/")).every((r) => r.method === "GET"));
ok("every list endpoint is paginated",
  ROUTES.filter((r) => r.method === "GET" && /\/v1\/(leads|lists|campaigns|threads|suppressions)$/.test(r.path))
        .every((r) => r.paginated === true));
ok("the compliance evidence endpoint exists",
  ROUTES.some((r) => r.path === "/v1/policy/decisions"));
ok("the message journey endpoint exists",
  ROUTES.some((r) => r.path.includes("/journey")));
ok("one-click unsubscribe is a POST", 
  ROUTES.some((r) => r.path === "/v1/unsubscribe" && r.method === "POST"));

console.log("\n--- OpenAPI generation ---");
{
  const doc = toOpenApi();
  ok("the document is 3.1", doc.openapi === "3.1.0");
  ok("every route appears", Object.keys(doc.paths).length === new Set(ROUTES.map((r) => r.path)).size);
  const leads = doc.paths["/v1/leads"] as Record<string, Record<string, unknown>>;
  ok("both methods on a shared path are emitted", !!leads.get && !!leads.post);
  ok("the required scope is exposed for review", leads.post!["x-required-scope"] === "leads.write");
  ok("idempotent routes are marked", leads.post!["x-idempotent"] === true);
  const paginatedParams = (leads.get!.parameters as Array<{ name: string }>).map((p) => p.name);
  ok("paginated routes document cursor and limit",
    paginatedParams.includes("cursor") && paginatedParams.includes("limit"));
  const withParam = doc.paths["/v1/leads/{id}"] as Record<string, Record<string, unknown>>;
  ok("path parameters are extracted",
    (withParam.get!.parameters as Array<{ name: string }>)[0]?.name === "id");
  const activate = doc.paths["/v1/lists/{id}/activate"] as Record<string, Record<string, unknown>>;
  ok("documented failure codes reach the responses",
    Object.keys(activate.post!.responses as object).includes("451"));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
