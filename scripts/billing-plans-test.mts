/**
 * Plans, quotas and metering test (E19-077..E19-084).
 *
 * The honesty assertions come first: a plan may only claim what it actually
 * gets, and peer warmup must never reach an invoice.
 */
import {
  PLANS, UNLIMITED, isUnlimited, planLimit, checkQuota, checkMetered,
  isBillable, countsTowardReputation, NON_BILLABLE_SEND_KINDS,
  createLedger, assessDowngrade, recommendPlan, costPerPositiveReply, WARN_AT,
  type PlanId, type UsageEvent,
} from "../packages/billing/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}
const AT = new Date("2026-08-30T00:00:00Z");

console.log("\n--- plan honesty ---");
{
  const shared: PlanId[] = ["trial", "starter", "growth"];
  ok("no shared-pool plan claims a dedicated IP",
    shared.every((p) => PLANS[p].dedicatedIp === false && PLANS[p].dedicatedIps === 0));
  ok("the first plan claiming a dedicated IP actually provisions one",
    PLANS.scale.dedicatedIp === true && PLANS.scale.dedicatedIps >= 1);
  ok("a plan claiming a dedicated IP is never also on the shared pool",
    (["scale", "enterprise"] as PlanId[]).every((p) => !PLANS[p].sharedPool));
  ok("the trial explicitly says shared", PLANS.trial.sharedPool === true);
}
{
  const ids: PlanId[] = ["starter", "growth", "scale"];
  ok("mailbox limits grow monotonically",
    ids.every((p, i) => i === 0 || PLANS[p].mailboxes > PLANS[ids[i-1]!]!.mailboxes));
  ok("send allowances grow monotonically",
    ids.every((p, i) => i === 0 || PLANS[p].sends > PLANS[ids[i-1]!]!.sends));
  ok("overage gets cheaper as volume grows",
    PLANS.scale.overageUsd.sends! < PLANS.starter.overageUsd.sends!);
}
ok("only enterprise is unlimited", isUnlimited(PLANS.enterprise.mailboxes) && !isUnlimited(PLANS.scale.mailboxes));
ok("the trial is finite in every dimension — a squatting guard",
  (["mailboxes","domains","seats","sends"] as const).every((k) => !isUnlimited(PLANS.trial[k])));

console.log("\n--- quota enforcement at consumption ---");
{
  const r = checkQuota("starter", "mailboxes", 2);
  ok("under the limit is allowed", r.allowed && r.remaining === 2, JSON.stringify(r));
}
{
  const r = checkQuota("starter", "mailboxes", 5);
  ok("at the limit is refused", !r.allowed);
  ok("and names the plan in the reason", !r.allowed && r.reason.includes("Starter"));
}
{
  const r = checkQuota("starter", "mailboxes", 4);
  ok("the last unit warns before it is gone", r.allowed && r.warn);
}
{
  const r = checkQuota("starter", "mailboxes", 1);
  ok("plenty of headroom does not warn", r.allowed && !r.warn);
}
ok("the warn threshold is documented", WARN_AT > 0 && WARN_AT < 1);
ok("unlimited never refuses", checkQuota("enterprise", "mailboxes", 1e9).allowed);
{
  const r = checkQuota("starter", "mailboxes", 3, 5);
  ok("a bulk request that would breach is refused as a whole", !r.allowed);
}

console.log("\n--- metered dimensions run into overage, not a wall ---");
{
  const r = checkMetered("starter", "sends", 6_000, 1);
  ok("past the allowance is still allowed when overage is priced", r.allowed);
  ok("and the overage is quantified", r.allowed && r.overage?.units === 1);
  ok("with a cost the customer can check",
    r.allowed && Math.abs((r.overage?.costUsd ?? 0) - PLANS.starter.overageUsd.sends!) < 1e-9);
}
{
  const r = checkMetered("trial", "sends", 200, 1);
  ok("a plan with NO overage price hard-stops instead", !r.allowed);
}
{
  const r = checkMetered("starter", "sends", 6_000, 1000, 1.0, 0);
  ok("a spend cap refuses rather than surprising the customer", !r.allowed);
  ok("and says the cap is why", !r.allowed && r.reason.includes("spend cap"));
}
{
  const r = checkMetered("starter", "sends", 6_000, 1, 100.0, 0);
  ok("a generous spend cap still allows", r.allowed);
}

console.log("\n--- what is billable ---");
ok("a campaign send is billable", isBillable("campaign"));
ok("a one-to-one reply is billable", isBillable("reply"));
for (const kind of NON_BILLABLE_SEND_KINDS) {
  ok(`${kind} is NOT billable`, !isBillable(kind));
}
ok("peer warmup never reaches an invoice", !isBillable("peer_warmup"));
ok("a placement probe never reaches an invoice", !isBillable("placement_probe"));
ok("but every one of them counts toward reputation — receivers see them",
  NON_BILLABLE_SEND_KINDS.every((k) => countsTowardReputation(k)));

console.log("\n--- usage recording is idempotent ---");
{
  const ledger = createLedger();
  const e = (key: string, qty = 1): UsageEvent =>
    ({ orgId: "org1", dimension: "sends", quantity: qty, idempotencyKey: key, at: AT });

  ledger.record([e("a"), e("b"), e("c")]);
  ok("three distinct events count three", ledger.total("org1", "sends") === 3);

  const retry = ledger.record([e("b"), e("c"), e("d")]);
  ok("a retry containing seen keys does not double-bill", ledger.total("org1", "sends") === 4,
    String(ledger.total("org1", "sends")));
  ok("duplicates are reported, not thrown", retry.duplicates.length === 2);
  ok("and the new event still lands", retry.recorded.length === 1);
}
{
  const ledger = createLedger();
  ledger.record([{ orgId: "a", dimension: "sends", quantity: 5, idempotencyKey: "x", at: AT }]);
  ledger.record([{ orgId: "b", dimension: "sends", quantity: 7, idempotencyKey: "y", at: AT }]);
  ok("usage is per-org", ledger.total("a", "sends") === 5 && ledger.total("b", "sends") === 7);
  ok("and per-dimension", ledger.total("a", "verifications") === 0);
}

console.log("\n--- downgrades never delete silently ---");
{
  const r = assessDowngrade("scale", "starter", { mailboxes: 40, domains: 12, seats: 3, dedicatedIps: 1 });
  ok("a downgrade with excess resources is refused", !r.allowed);
  ok("and every conflict is itemised — mailboxes, domains, seats AND the dedicated IP",
    r.conflicts.length === 4, JSON.stringify(r.conflicts.map((c) => c.resource)));
  ok("losing a dedicated IP is surfaced as a conflict, not done quietly",
    r.conflicts.some((c) => c.resource === "dedicatedIps"));
  ok("with the exact excess named",
    r.conflicts.find((c) => c.resource === "mailboxes")?.excess === 35);
}
{
  const r = assessDowngrade("growth", "starter", { mailboxes: 3, domains: 1, seats: 1, dedicatedIps: 0 });
  ok("a downgrade that fits is allowed", r.allowed && r.conflicts.length === 0);
}

console.log("\n--- plan recommendation, including downward ---");
ok("light usage recommends starter",
  recommendPlan({ mailboxes: 3, domains: 1, seats: 1, sends: 2_000 }) === "starter");
ok("mid usage recommends growth",
  recommendPlan({ mailboxes: 15, domains: 6, seats: 3, sends: 20_000 }) === "growth");
ok("heavy usage recommends scale",
  recommendPlan({ mailboxes: 60, domains: 25, seats: 10, sends: 90_000 }) === "scale");
ok("beyond scale recommends enterprise",
  recommendPlan({ mailboxes: 500, domains: 200, seats: 40, sends: 1_000_000 }) === "enterprise");
ok("one dimension over is enough to move a plan up",
  recommendPlan({ mailboxes: 3, domains: 1, seats: 1, sends: 50_000 }) === "scale");

console.log("\n--- cost per positive reply ---");
{
  const c = costPerPositiveReply({ infrastructureUsd: 60, verificationUsd: 12, aiUsd: 8, positiveReplies: 40 });
  ok("the total is the sum of its parts", c.totalUsd === 80);
  ok("cost per positive reply is computed", c.costPerPositiveReply === 2);
  ok("and the parts remain visible for decomposition",
    c.infrastructureUsd === 60 && c.verificationUsd === 12 && c.aiUsd === 8);
}
{
  const c = costPerPositiveReply({ infrastructureUsd: 60, verificationUsd: 0, aiUsd: 0, positiveReplies: 0 });
  ok("zero replies gives NULL, not Infinity or a fabricated number",
    c.costPerPositiveReply === null);
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
