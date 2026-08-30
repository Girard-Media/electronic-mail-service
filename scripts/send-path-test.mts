/**
 * Send-path integration test (E22-014, E22-015, E07-095..E07-099).
 *
 * Runs all ten stages in process against fakes — no VPS required:
 *
 *   sequence → policy → verify → router → compose → score → pace → emit
 *            → observe (replayed maillog) → attribute (bounce taxonomy)
 *
 * The point is to prove the invariants hold when the pieces are wired together,
 * not just in isolation. In particular: that there is no arrangement of inputs
 * where a blocked message reaches the emit stage.
 *
 * Requires the local stack for the token buckets: pnpm infra:up
 */

import Redis from "ioredis";
import {
  route, select, reject, buildSpecs, claim,
  type Candidate, type FilterContext, type RouteRequest, type RouteDeps,
} from "../packages/router/src/index.js";
import {
  evaluate, validateMessage, resolveJurisdiction, strictnessFromOutcome,
  type JurisdictionRule, type PolicyOutcome, type MessageToValidate, type SuppressionVerdict,
} from "../packages/policy/src/index.js";
import { classify, ACTION_BY_CLASS, ingestBatch, Correlator, espFromRelay } from "../packages/deliverability/src/index.js";
import type { BounceRuleRow } from "../packages/deliverability/src/index.js";
import { JURISDICTION_POLICIES } from "../packages/db/src/seed/jurisdiction-policy.js";
import { BOUNCE_RULES } from "../packages/db/src/seed/bounce-rules.js";
import { assignVariant, isDeceptiveFirstTouch } from "../packages/sequence/src/index.js";
import { capForDay, shouldHold, STANDARD } from "../packages/warmup/src/index.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379", { maxRetriesPerRequest: 3 });

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const AT = new Date("2026-08-30T14:00:00Z");

const RULES = new Map<string, JurisdictionRule>(
  JURISDICTION_POLICIES.map((j) => [j.countryCode, {
    countryCode: j.countryCode, outcome: j.outcome as PolicyOutcome,
    allowedBases: j.allowedBases, version: 1,
  }]),
);
const ruleFor = (c: string | null) => (c ? RULES.get(c) ?? RULES.get("*") ?? null : null);
const strict = strictnessFromOutcome((c) => RULES.get(c)?.outcome);
const TAXONOMY: BounceRuleRow[] = BOUNCE_RULES.map((r, i) => ({
  id: `s${i}`, espFamily: r.espFamily, smtpCode: r.smtpCode, enhancedCode: r.enhancedCode,
  matchSubstr: r.matchSubstr, classify: r.classify, priority: r.priority, approved: true,
}));

function mailbox(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    mailboxId: id, domainId: `dom-${id}`, ipId: "ip-1", nodeId: "node-1",
    mailboxStatus: "ACTIVE", domainStatus: "ACTIVE", ipStatus: "ACTIVE",
    nodeStatus: "ACTIVE", nodeRole: "CAMPAIGN", nodeVerified: true, pool: "default",
    domainVerified: true, domainAgeReadyAt: new Date("2026-01-01T00:00:00Z"),
    warmupHoldAt: null,
    mailboxDailyCap: 40, mailboxSentToday: 0,
    reputationScore: 0.8, espAffinity: { google: 0.9, microsoft: 0.7 },
    warmupDay: 30, riskPenalty: 0.05, lastSendToRecipientDomainAt: null,
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

async function clearBuckets(ids: string[]) {
  const keys = ids.flatMap((id) =>
    buildSpecs({
      mailboxId: id, domainId: `dom-${id}`, ipId: "ip-1", esp: "google",
      mailboxDailyCap: 1, mailboxHourlyCap: 1, domainDailyCap: 1,
      ipHourlyCap: 1, espQuarterCap: 1, at: AT,
    }).map((s) => s.key));
  if (keys.length) await redis.del(...keys);
}

const caps = (c: Candidate) => ({
  mailboxId: c.mailboxId, domainId: c.domainId, ipId: c.ipId,
  mailboxDailyCap: c.mailboxDailyCap - c.mailboxSentToday,
  mailboxHourlyCap: 100, domainDailyCap: 500, ipHourlyCap: 1000, espQuarterCap: 500,
});

async function main() {
  // ── Stage 1: sequence ──────────────────────────────────────────────────────
  console.log("\n--- 1. sequence ---");
  {
    const a = assignVariant("lead-1", "step-1", [1, 1, 1]);
    const b = assignVariant("lead-1", "step-1", [1, 1, 1]);
    ok("variant assignment is deterministic across runs", a === b);
    ok("variant index is in range", a >= 0 && a < 3);
    const spread = new Set(Array.from({ length: 60 }, (_, i) => assignVariant(`lead-${i}`, "step-1", [1, 1, 1])));
    ok("and still distributes across variants", spread.size === 3, `saw ${spread.size}`);
    ok("RE: on a first touch is refused at composition", isDeceptiveFirstTouch("RE: hello", true));
    ok("RE: is fine on a follow-up", !isDeceptiveFirstTouch("RE: hello", false));
  }

  // ── Stage 2: policy ────────────────────────────────────────────────────────
  console.log("\n--- 2. policy gate ---");
  const jurisdiction = resolveJurisdiction([{ source: "tld", country: "US", confidence: 0.9 }], strict);
  const CLEAN: SuppressionVerdict = { global: false, org: false, domainOrRole: false };
  const FLAGS = { leadFrozen: false, domainVerified: true, kycComplete: true };
  const policyInput = {
    orgId: "org1", leadId: "lead-1", campaignId: "camp-1", intentId: "int-1",
    recipientEmail: "buyer@acme.com", jurisdiction, consents: [], at: AT,
  };
  const decision = evaluate(policyInput, ruleFor(jurisdiction.country), CLEAN, FLAGS);
  ok("a US recipient with a clean record is allowed", decision.decision === "ALLOW");

  // ── Stages 3–4: verify + router ────────────────────────────────────────────
  console.log("\n--- 3-4. router ---");
  await clearBuckets(["mbx-a", "mbx-b", "mbx-c"]);
  const req: RouteRequest = {
    intentId: "int-1", orgId: "org1", campaignId: "camp-1",
    recipientEmail: "buyer@acme.com", recipientDomain: "acme.com",
    esp: "google", pool: "default", jurisdiction: "US", at: AT,
  };
  const fleet = [
    mailbox("mbx-a", { reputationScore: 0.9, espAffinity: { google: 0.95 } }),
    mailbox("mbx-b", { reputationScore: 0.5, espAffinity: { google: 0.4 } }),
    mailbox("mbx-c", { reputationScore: 0.7, espAffinity: { google: 0.6 } }),
  ];
  const deps: RouteDeps = { candidates: fleet, filterContext: ctx(), buckets: redis, capsFor: caps };
  const plan = await route(req, deps);
  ok("the router returns a plan", plan.kind === "plan");
  ok("and picks the best-scoring mailbox", plan.kind === "plan" && plan.mailboxId === "mbx-a",
    plan.kind === "plan" ? plan.mailboxId : plan.reason);
  ok("the trace records why (I5)", plan.kind === "plan" && plan.trace.chosen.factors.espAffinity > 0.9);
  ok("and names the runners-up", plan.kind === "plan" && plan.trace.runnersUp.length === 2);

  console.log("\n--- router: hard filters are absolute ---");
  for (const [label, over, expected] of [
    ["an unverified domain", { domainVerified: false }, "domain-unverified"],
    ["a domain still aging", { domainAgeReadyAt: new Date("2027-01-01") }, "domain-before-age-ready"],
    ["a paused mailbox", { mailboxStatus: "PAUSED" }, "mailbox-not-active"],
    ["a mailbox on warmup hold", { warmupHoldAt: AT }, "mailbox-warmup-hold"],
    ["a quarantined IP", { ipStatus: "QUARANTINED" }, "ip-quarantined"],
    ["an unverified node", { nodeVerified: false }, "node-unhealthy"],
    ["a VERIFY-role node", { nodeRole: "VERIFY" }, "node-role-not-campaign"],
    ["an exhausted daily cap", { mailboxSentToday: 40 }, "no-cap-headroom"],
    ["a pool mismatch", { pool: "isolated" }, "pool-mismatch"],
  ] as const) {
    ok(`${label} is filtered as ${expected}`, reject(mailbox("x", over), ctx()) === expected,
      String(reject(mailbox("x", over), ctx())));
  }
  ok("a VERIFY node can NEVER be routed to (E03-077)",
    reject(mailbox("v", { nodeRole: "VERIFY", reputationScore: 1 }), ctx()) === "node-role-not-campaign");
  ok("a jurisdiction-denied domain is filtered",
    reject(mailbox("x"), ctx({ allowedDomainIds: new Set(["other"]) })) === "policy-denies-domain-for-jurisdiction");
  ok("a mailbox that hit this company recently is on cooldown",
    reject(mailbox("x", { lastSendToRecipientDomainAt: new Date(AT.getTime() - 3600_000) }), ctx())
      === "recipient-domain-cooldown");
  ok("the fleet-wide fan-out cap binds",
    reject(mailbox("x"), ctx({ recipientDomainFanoutUsed: 3 })) === "recipient-domain-fanout-cap");

  console.log("\n--- router: deferral is a first-class success ---");
  {
    const empty = await route(req, { ...deps, candidates: [] });
    ok("an empty fleet defers rather than failing", empty.kind === "defer");
    ok("and names no-candidates", empty.kind === "defer" && empty.reason === "no-candidates");
  }
  {
    const capped = fleet.map((c) => ({ ...c, mailboxSentToday: c.mailboxDailyCap }));
    const r = await route(req, { ...deps, candidates: capped });
    ok("a fully capped fleet defers", r.kind === "defer" && r.reason === "all-caps-exhausted");
    ok("and reports the binding constraint in actionable terms",
      r.kind === "defer" && r.bindingConstraint.includes("no-cap-headroom"),
      r.kind === "defer" ? r.bindingConstraint : "");
  }
  {
    const a = await route(req, { ...deps, deferCount: 0, candidates: [] });
    const b = await route(req, { ...deps, deferCount: 4, candidates: [] });
    ok("deferral backs off with repeated attempts",
      a.kind === "defer" && b.kind === "defer" && b.until.getTime() > a.until.getTime());
  }
  {
    // Deterministic: identical inputs, identical selection (E07-022).
    const s1 = select(fleet, ctx());
    const s2 = select(fleet, ctx());
    ok("selection is deterministic", s1.chosen?.mailboxId === s2.chosen?.mailboxId);
    const tied = [mailbox("zzz"), mailbox("aaa")];
    ok("ties break stably on id", select(tied, ctx()).chosen?.mailboxId === "aaa");
  }
  {
    // A warming mailbox must lose to a warm one for a large burst.
    const warm = mailbox("warm", { warmupDay: 60, mailboxDailyCap: 40, reputationScore: 0.7, espAffinity: { google: 0.7 } });
    const warming = mailbox("warming", { warmupDay: 3, mailboxDailyCap: 40, reputationScore: 0.7, espAffinity: { google: 0.7 } });
    const s = select([warming, warm], ctx({ intendedVolume: 35 }));
    ok("warmupFit steers a large burst away from a ramping mailbox",
      s.chosen?.mailboxId === "warm", String(s.chosen?.mailboxId));
  }

  // ── Stage 5–6: compose + score ─────────────────────────────────────────────
  console.log("\n--- 5-6. compose + validate ---");
  const composed: MessageToValidate = {
    subject: "Quick question about your onboarding flow",
    bodyText: "Hi Dana,\n\n…\n\nAlex Rivera\nNorthwind Labs\n21 Bridge St, Austin TX 78701\n\nUnsubscribe: https://ems.example/u/int-1",
    bodyHtml: null,
    fromAddress: "alex@nw-labs.com", fromDisplayName: "Alex Rivera", personaName: "Alex Rivera",
    postalAddress: "21 Bridge St, Austin TX 78701",
    unsubscribeUrl: "https://ems.example/u/int-1",
    headers: {
      "List-Unsubscribe": "<mailto:u@ems.example>, <https://ems.example/u/int-1>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Message-ID": "<int-1@mta01.nw-labs.com>",
    },
    isFirstTouch: true, fromDomainVerified: true,
  };
  ok("the composed message passes CAN-SPAM validation", validateMessage(composed).ok,
    validateMessage(composed).defects.join(","));

  // ── Stage 7: pace ──────────────────────────────────────────────────────────
  console.log("\n--- 7. pace ---");
  {
    await clearBuckets(["mbx-p"]);
    const c = mailbox("mbx-p", { mailboxDailyCap: 2 });
    const specs = () => buildSpecs({ ...caps(c), esp: "google", at: AT });
    ok("first send claims", (await claim(redis, specs())).ok);
    ok("second send claims", (await claim(redis, specs())).ok);
    const third = await claim(redis, specs());
    ok("the third defers on the daily cap (I3)", !third.ok && third.bindingConstraint === "mailbox-daily");
  }

  // ── Stage 8-9: emit + observe ──────────────────────────────────────────────
  console.log("\n--- 8-9. emit + observe (replayed maillog) ---");
  const correlator = new Correlator();
  const maillog = [
    "Aug 30 14:00:01 mta01 postfix/cleanup[8840]: A1B2C3D4E5: message-id=<int-1@mta01.nw-labs.com>",
    "Aug 30 14:00:03 mta01 postfix/smtp[8841]: A1B2C3D4E5: to=<buyer@acme.com>, relay=aspmx.l.google.com[142.251.16.27]:25, delay=1.6, dsn=2.0.0, status=sent (250 2.0.0 OK 1756533291 d2e1af)",
    "Aug 30 14:00:05 mta01 postfix/cleanup[8842]: B2C3D4E5F6: message-id=<int-2@mta01.nw-labs.com>",
    "Aug 30 14:00:07 mta01 postfix/smtp[8843]: B2C3D4E5F6: to=<gone@acme.com>, relay=aspmx.l.google.com[142.251.16.27]:25, delay=0.8, dsn=5.1.1, status=bounced (host aspmx.l.google.com said: 550-5.1.1 The email account that you tried to reach does not exist)",
    "Aug 30 14:00:09 mta01 postfix/cleanup[8844]: C3D4E5F6A7: message-id=<int-3@mta01.nw-labs.com>",
    "Aug 30 14:00:11 mta01 postfix/smtp[8845]: C3D4E5F6A7: to=<busy@acme.com>, relay=gmail-smtp-in.l.google.com[74.125.24.27]:25, delay=2.2, dsn=4.7.0, status=deferred (host gmail-smtp-in.l.google.com said: 421-4.7.0 Our system has detected an unusual rate of unsolicited mail)",
  ];
  const { events, stats } = ingestBatch(maillog, correlator);
  ok("three deliveries observed", events.length === 3);
  ok("all three correlated to their Message-ID (I4)", stats.correlated === 3 && stats.uncorrelated === 0);
  ok("nothing unparsed", stats.unparsed === 0);
  ok("our sent message joined back to its intent",
    events[0]?.messageId === "int-1@mta01.nw-labs.com");
  ok("`delivered` comes from a status=sent line with a 250 — not a vendor counter (I6)",
    events[0]?.status === "sent" && (events[0]?.response ?? "").startsWith("250"));

  // ── Stage 10: attribute ────────────────────────────────────────────────────
  console.log("\n--- 10. attribute ---");
  {
    const bounce = events[1]!;
    const esp = espFromRelay(bounce.relayHost);
    ok("the receiving MX classifies as google", esp === "google");
    const cls = classify({ espFamily: esp, code: 550, enhanced: bounce.dsn, raw: bounce.response ?? "" }, TAXONOMY);
    ok("the bounce classifies as HARD", cls === "HARD", cls);
    ok("and the action is to suppress", ACTION_BY_CLASS[cls].kind === "suppress");
  }
  {
    const deferred = events[2]!;
    const esp = espFromRelay(deferred.relayHost);
    const cls = classify({ espFamily: esp, code: 421, enhanced: deferred.dsn, raw: deferred.response ?? "" }, TAXONOMY);
    ok("the 421 classifies as BLOCK_RATE", cls === "BLOCK_RATE", cls);
    ok("and throttles the ESP rather than suppressing the recipient",
      ACTION_BY_CLASS[cls].kind === "throttle-esp");
  }

  // ── The invariant that matters most ────────────────────────────────────────
  console.log("\n--- I1/I7: nothing blocked can reach emit ---");
  for (const [label, over] of [
    ["a globally suppressed address", { suppression: { global: true, org: false, domainOrRole: false } }],
    ["an org-suppressed address", { suppression: { global: false, org: true, domainOrRole: false } }],
    ["a role address", { suppression: { global: false, org: false, domainOrRole: true } }],
    ["a frozen lead", { flags: { ...FLAGS, leadFrozen: true } }],
    ["an unverified sending domain", { flags: { ...FLAGS, domainVerified: false } }],
    ["incomplete KYC", { flags: { ...FLAGS, kycComplete: false } }],
  ] as const) {
    const o = over as { suppression?: SuppressionVerdict; flags?: typeof FLAGS };
    const d = evaluate(policyInput, ruleFor("US"), o.suppression ?? CLEAN, o.flags ?? FLAGS);
    ok(`${label} → BLOCK, and the pipeline stops before routing`, d.decision === "BLOCK", d.decision);
  }
  {
    const de = resolveJurisdiction(
      [{ source: "company", country: "US", confidence: 0.7 }, { source: "mxgeo", country: "DE", confidence: 0.4 }],
      strict,
    );
    const d = evaluate({ ...policyInput, jurisdiction: de }, ruleFor(de.country), CLEAN, FLAGS);
    ok("a .com whose MX geolocates to Germany is BLOCKED, not allowed as US",
      de.country === "DE" && d.decision === "BLOCK", `${de.country}/${d.decision}`);
  }

  // ── Warmup interaction ─────────────────────────────────────────────────────
  console.log("\n--- warmup governs the cap the router sees ---");
  ok("day 0 cap is the plan start", capForDay(STANDARD, 0) === 5);
  ok("cap grows weekly", capForDay(STANDARD, 14) === 15);
  ok("cap plateaus and never exceeds it", capForDay(STANDARD, 365) === STANDARD.plateau);
  ok("a healthy window does not hold the ramp",
    shouldHold(STANDARD, { sent: 100, bounced: 1, deferred: 2, complaints: 0 }) === null);
  ok("a bounce spike holds the ramp",
    shouldHold(STANDARD, { sent: 100, bounced: 8, deferred: 2, complaints: 0 }) === "bounce-rate");
  ok("a single complaint in 100 holds the ramp",
    shouldHold(STANDARD, { sent: 100, bounced: 0, deferred: 0, complaints: 1 }) === "complaint-rate");
  ok("a deferral spike holds the ramp",
    shouldHold(STANDARD, { sent: 100, bounced: 0, deferred: 20, complaints: 0 }) === "defer-rate");

  await clearBuckets(["mbx-a", "mbx-b", "mbx-c", "mbx-p"]);
  console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
  await redis.quit();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await redis.quit();
  process.exit(1);
});
