/**
 * Campaign mailbox pool (D17) — pure tests, no database.
 *
 * Attach-by-domain expansion, named-pool fallback, router candidate filter,
 * LRU tie-break across equal scores.
 */
import {
  reject, select,
  resolveCampaignPool, expandDomainAttach, mergeAttach, poolCapacityToday, isAttachableStatus,
  type Candidate, type FilterContext,
} from "../packages/router/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const AT = new Date("2026-09-09T14:00:00Z");

function mailbox(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    mailboxId: id, domainId: `dom-${id}`, ipId: "ip-1", nodeId: "node-1",
    mailboxStatus: "ACTIVE", domainStatus: "ACTIVE", ipStatus: "ACTIVE",
    nodeStatus: "ACTIVE", nodeRole: "CAMPAIGN", nodeVerified: true, pool: "default",
    domainVerified: true, domainAgeReadyAt: new Date("2026-01-01T00:00:00Z"),
    warmupHoldAt: null,
    mailboxDailyCap: 40, mailboxSentToday: 0,
    reputationScore: 0.8, espAffinity: { google: 0.9 },
    warmupDay: 30, riskPenalty: 0.05, lastSendToRecipientDomainAt: null,
    lastSendAt: null,
    ...over,
  };
}

function ctx(over: Partial<FilterContext> = {}): FilterContext {
  return {
    at: AT, pool: "default", esp: "google", recipientDomain: "acme.com",
    allowedDomainIds: null, recipientDomainCooldownMs: 72 * 3600_000,
    recipientDomainFanoutCap: 3, recipientDomainFanoutUsed: 0, intendedVolume: 1,
    ...over,
  };
}

console.log("\n--- resolve / expand ---");
ok("empty attach falls back to the named pool",
  resolveCampaignPool("default", []).kind === "named");
ok("non-empty attach is an explicit set",
  resolveCampaignPool("default", ["a", "b"]).kind === "attached");
{
  const fleet = [
    { id: "m1", domainId: "d1", status: "ACTIVE" },
    { id: "m2", domainId: "d1", status: "WARMING" },
    { id: "m3", domainId: "d1", status: "BURNED" },
    { id: "m4", domainId: "d2", status: "ACTIVE" },
  ];
  const ids = expandDomainAttach(["d1"], fleet);
  ok("attaching a domain takes ACTIVE + WARMING mailboxes", ids.length === 2 && ids.includes("m1") && ids.includes("m2"));
  ok("and skips BURNED", !ids.includes("m3"));
  ok("and does not leak the other domain", !ids.includes("m4"));
  const merged = mergeAttach({ mailboxIds: ["m4"], domainIds: ["d1"], mailboxes: fleet });
  ok("merge unions mailbox ids and domain expansion", merged.length === 3 && merged[0] === "m4");
}
ok("CREATED is not attachable", !isAttachableStatus("CREATED"));
ok("PAUSED is attachable (stays on the join, router filters it)", isAttachableStatus("PAUSED"));
{
  const cap = poolCapacityToday([
    { status: "ACTIVE", dailyCap: 40, sentToday: 10 },
    { status: "ACTIVE", dailyCap: 40, sentToday: 40 },
    { status: "WARMING", dailyCap: 5, sentToday: 0 },
  ]);
  ok("capacity counts only ACTIVE mailboxes", cap.eligible === 2);
  ok("and remaining is clamped at zero", cap.remainingToday === 30);
}

console.log("\n--- router: attached mailbox set ---");
{
  const a = mailbox("mbx-a", { pool: "default" });
  const b = mailbox("mbx-b", { pool: "default" });
  ok("named pool still matches when mailboxIds is unset", reject(a, ctx()) === null);
  ok("an attached set rejects mailboxes outside it",
    reject(b, ctx({ mailboxIds: new Set(["mbx-a"]) })) === "pool-mismatch");
  ok("and accepts mailboxes inside it even if the named pool would not",
    reject(mailbox("mbx-a", { pool: "other" }), ctx({ mailboxIds: new Set(["mbx-a"]) })) === null);
  const s = select([a, b], ctx({ mailboxIds: new Set(["mbx-b"]) }));
  ok("select only considers the attached set", s.chosen?.mailboxId === "mbx-b", String(s.chosen?.mailboxId));
  ok("and records the outsider as pool-mismatch",
    s.trace.candidatesFiltered.some((f) => f.mailboxId === "mbx-a" && f.filter === "pool-mismatch"));
}

console.log("\n--- router: LRU tie-break ---");
{
  const recent = mailbox("mbx-recent", {
    reputationScore: 0.8, espAffinity: { google: 0.9 },
    lastSendAt: new Date(AT.getTime() - 60_000),
  });
  const idle = mailbox("mbx-idle", {
    reputationScore: 0.8, espAffinity: { google: 0.9 },
    lastSendAt: new Date(AT.getTime() - 86_400_000),
  });
  const s = select([recent, idle], ctx());
  ok("equal scores rotate to the least-recently-used mailbox",
    s.chosen?.mailboxId === "mbx-idle", String(s.chosen?.mailboxId));
  const tied = [mailbox("zzz"), mailbox("aaa")];
  ok("never-sent still breaks ties on id", select(tied, ctx()).chosen?.mailboxId === "aaa");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
