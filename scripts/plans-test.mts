// Plan matrix unit test — resolution (case/alias/unknown), unlimited handling,
// and the limit predicate the server enforces with.
import {
  planLimits,
  withinLimit,
  isUnlimited,
  PLANS,
  planPricing,
  computeBill,
  normalizePlanId,
  OPERATOR_PLAN,
  isOperatorWorkspace,
  effectivePlanId,
} from "../packages/core/src/plans.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

ok("free is the default for null/undefined", planLimits(null) === PLANS.free && planLimits(undefined) === PLANS.free);
ok("unknown plan falls back to free", planLimits("totally-made-up").monthlySends === PLANS.free.monthlySends);
ok("case-insensitive", planLimits("PRO") === PLANS.pro);
ok("whitelabel alias → white-label", planLimits("whitelabel") === PLANS["white-label"]);
ok("white-label has unlimited domains", isUnlimited(planLimits("white-label").sendingDomains));
ok(
  "operator plan is enterprise unlimited",
  OPERATOR_PLAN === "enterprise" &&
    isUnlimited(planLimits(OPERATOR_PLAN).sendingDomains) &&
    isUnlimited(planLimits(OPERATOR_PLAN).monthlySends) &&
    isUnlimited(planLimits(OPERATOR_PLAN).webhookEndpoints) &&
    isUnlimited(planLimits(OPERATOR_PLAN).teamSeats),
);
ok("operator workspace: top-level + admin owner", isOperatorWorkspace(null, true) === true);
ok("operator workspace: child org is never operator", isOperatorWorkspace("parent_1", true) === false);
ok("operator workspace: non-admin owner stays on stored plan", isOperatorWorkspace(null, false) === false);
ok("effectivePlanId lifts leftover free for operator", effectivePlanId("free", { parentOrgId: null, ownerIsPlatformAdmin: true }) === OPERATOR_PLAN);
ok("effectivePlanId leaves customer free alone", effectivePlanId("free", { parentOrgId: null, ownerIsPlatformAdmin: false }) === "free");
ok("effectivePlanId never lifts a sub-account", effectivePlanId("free", { parentOrgId: "agency", ownerIsPlatformAdmin: true }) === "free");
ok("effectivePlanId keeps a paying customer's scale", effectivePlanId("scale", { parentOrgId: null, ownerIsPlatformAdmin: false }) === "scale");
ok("free: no custom branding", planLimits("free").customBranding === false);
ok("scale: custom branding on", planLimits("scale").customBranding === true);
ok("free/pro/scale: no sub-accounts", !planLimits("free").subAccounts && !planLimits("pro").subAccounts && !planLimits("scale").subAccounts);
ok("white-label + enterprise: sub-accounts on", planLimits("white-label").subAccounts === true && planLimits("enterprise").subAccounts === true);
ok(
  "no plan advertises dedicated IP (product does not exist)",
  Object.values(PLANS).every((p) => p.dedicatedIp === false),
);

ok("withinLimit: under cap allows", withinLimit(0, 1) === true);
ok("withinLimit: at cap blocks", withinLimit(1, 1) === false);
ok("withinLimit: over cap blocks", withinLimit(5, 1) === false);
ok("withinLimit: unlimited always allows", withinLimit(9_999_999, -1) === true);
ok("isUnlimited(-1)", isUnlimited(-1) === true && isUnlimited(0) === false);

// Monotonic sanity: each tier's monthly sends should not decrease free→pro→scale.
ok(
  "send limits increase by tier",
  planLimits("free").monthlySends < planLimits("pro").monthlySends &&
    planLimits("pro").monthlySends < planLimits("scale").monthlySends,
);

// --- pricing + billing ---
ok("normalizePlanId: alias + unknown", normalizePlanId("WHITELABEL") === "white-label" && normalizePlanId("bogus") === "free" && normalizePlanId(null) === "free");
ok("planPricing base prices", planPricing("free").monthlyUsd === 0 && planPricing("pro").monthlyUsd === 18 && planPricing("scale").monthlyUsd === 80 && planPricing("white-label").monthlyUsd === 400);
ok("planPricing whitelabel alias", planPricing("whitelabel").overagePer1kUsd === 0.3);
ok("enterprise is custom", planPricing("enterprise").custom === true && planPricing("scale").custom === false);

const free = computeBill("free", 10_000);
ok("free: hard-capped, no overage, $0", free.overageSends === 0 && free.overageUsd === 0 && free.totalUsd === 0);

const proUnder = computeBill("pro", 40_000);
ok("pro under cap: base only", proUnder.overageSends === 0 && proUnder.totalUsd === 18);

const proOver = computeBill("pro", 60_000); // included 50k → 10k over → 10 * $0.70 = $7
ok("pro overage: 10k over → $18 + $7 = $25", proOver.overageSends === 10_000 && proOver.overageUsd === 7 && proOver.totalUsd === 25, JSON.stringify(proOver));

const scaleOver = computeBill("scale", 600_000); // included 500k → 100k over → 100 * $0.55 = $55
ok("scale overage: 100k over → $80 + $55 = $135", scaleOver.overageUsd === 55 && scaleOver.totalUsd === 135, JSON.stringify(scaleOver));

const wl = computeBill("white-label", 5_001_000); // 1k over → 1 * $0.30
ok("white-label overage: 1k over → $400.30", wl.overageSends === 1_000 && wl.overageUsd === 0.3 && wl.totalUsd === 400.3, JSON.stringify(wl));

const ent = computeBill("enterprise", 9_000_000);
ok("enterprise: unlimited → custom, no overage", ent.custom === true && ent.includedSends === -1 && ent.overageUsd === 0);

ok("computeBill clamps negative/garbage/non-finite sends", computeBill("pro", -5).usedSends === 0 && computeBill("pro", NaN).usedSends === 0 && computeBill("pro", Infinity).usedSends === 0 && Number.isFinite(computeBill("pro", Infinity).totalUsd));
ok("included = enforced cap (planLimits)", computeBill("pro", 0).includedSends === planLimits("pro").monthlySends);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
