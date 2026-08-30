/**
 * Reputation ledger test (E11-064..E11-072).
 *
 * The assertions that matter most are the honesty ones: a subject with no
 * volume returns null rather than a plausible middle value, and a composite is
 * never available without its decomposition.
 */
import {
  ipLedger, domainLedger, mailboxLedger, contentLedger, engagementLedger,
  composite, routerScore, riskPenalty, explainDelta, decay, inverseRate,
  HALF_LIFE_DAYS, MIN_SAMPLE, DEFAULT_COMPOSITE,
  type DeliveryWindow, type LedgerReading,
} from "../packages/reputation/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const AT = new Date("2026-08-30T00:00:00Z");
const clean = (sent = 1000): DeliveryWindow => ({
  sent, delivered: sent, deferred: 0, bounced: 0, blockBounces: 0, complaints: 0, observedAt: AT,
});
const rough = (sent = 1000): DeliveryWindow => ({
  sent, delivered: sent * 0.8, deferred: sent * 0.15, bounced: sent * 0.05,
  blockBounces: sent * 0.02, complaints: sent * 0.002, observedAt: AT,
});

console.log("\n--- decay ---");
ok("one half-life halves the value", Math.abs(decay(1, 21, 21) - 0.5) < 1e-9);
ok("two half-lives quarter it", Math.abs(decay(1, 42, 21) - 0.25) < 1e-9);
ok("no age is no decay", decay(0.8, 0, 21) === 0.8);
ok("mailbox decays fastest, IP slowest",
  HALF_LIFE_DAYS.MAILBOX < HALF_LIFE_DAYS.ENGAGEMENT && HALF_LIFE_DAYS.ENGAGEMENT < HALF_LIFE_DAYS.IP);

console.log("\n--- inverse rates ---");
ok("zero bad is a perfect score", inverseRate(0, 1000, 0.05) === 1);
ok("at tolerance the score is zero", inverseRate(50, 1000, 0.05) === 0);
ok("beyond tolerance stays zero, never negative", inverseRate(500, 1000, 0.05) === 0);
ok("half tolerance is half the score", Math.abs(inverseRate(25, 1000, 0.05) - 0.5) < 1e-9);
ok("no volume is not a failure", inverseRate(0, 0, 0.05) === 1);

console.log("\n--- insufficient data returns null, not a guess ---");
{
  const r = mailboxLedger({
    mailboxId: "m1", delivery: clean(3), replies: 0, ageDays: 1,
    warmupDay: 1, warmupPlateau: 40, windowEnd: AT,
  });
  ok("a mailbox with 3 sends has NO score", r.score === null && r.insufficientData, String(r.score));
  ok("but the factors are still shown", r.factors.length > 0);
  ok("and the sample size is reported", r.sampleSize === 3);
}
{
  const r = ipLedger({ ipId: "ip1", delivery: clean(10), listings: [], tlsFailureRate: null, windowEnd: AT });
  ok("an IP below its minimum sample has no score", r.score === null);
  ok("IP needs a larger sample than a mailbox", MIN_SAMPLE.IP > MIN_SAMPLE.MAILBOX);
}

console.log("\n--- the five ledgers ---");
{
  const good = ipLedger({ ipId: "ip1", delivery: clean(), listings: [], tlsFailureRate: 0, windowEnd: AT });
  const bad = ipLedger({
    ipId: "ip2", delivery: rough(),
    listings: [{ provider: "zen.spamhaus.org", severity: "critical", since: AT }],
    tlsFailureRate: 0.2, windowEnd: AT,
  });
  ok("a clean IP scores high", (good.score ?? 0) > 0.9, String(good.score));
  ok("a listed IP with deferrals scores low", (bad.score ?? 1) < 0.3, String(bad.score));
  ok("the listing is named in the factors",
    bad.factors.some((f) => f.key.includes("zen.spamhaus.org")));
  ok("every factor names its source",
    bad.factors.every((f) => ["maillog","dnsbl","dmarc","tlsrpt","fbl","seed","rspamd","registry"].includes(f.source)));
}
{
  const d = domainLedger({
    domainId: "d1", delivery: clean(), dmarcAlignment: 1, dmarcSample: 500,
    placementInbox: 0.9, placementSample: 20, listings: [], windowEnd: AT,
  });
  ok("a healthy domain scores high", (d.score ?? 0) > 0.9, String(d.score));
  ok("placement is included when the probe sample is real",
    d.factors.find((f) => f.key === "inbox placement")?.weight === 0.2);
}
{
  const d = domainLedger({
    domainId: "d2", delivery: clean(), dmarcAlignment: null, dmarcSample: 0,
    placementInbox: 1, placementSample: 2, listings: [], windowEnd: AT,
  });
  ok("a tiny placement sample is down-weighted, not trusted",
    d.factors.find((f) => f.key === "inbox placement")?.weight === 0.05);
  ok("a missing DMARC signal is simply absent, not zero",
    !d.factors.some((f) => f.source === "dmarc"));
}
{
  const engaged = mailboxLedger({
    mailboxId: "m1", delivery: clean(500), replies: 25, ageDays: 90,
    warmupDay: 60, warmupPlateau: 40, windowEnd: AT,
  });
  const silent = mailboxLedger({
    mailboxId: "m2", delivery: clean(500), replies: 0, ageDays: 90,
    warmupDay: 60, warmupPlateau: 40, windowEnd: AT,
  });
  ok("replies lift a mailbox", (engaged.score ?? 0) > (silent.score ?? 0));
  ok("opens are nowhere in the model", !engaged.factors.some((f) => /open/i.test(f.key)));
}
{
  const c = contentLedger({
    contentId: "c1", rspamdScore: 0.5, listedLinkFraction: 0, linkCount: 3,
    neighbourPlacement: 0.9, neighbourSample: 20, windowEnd: AT,
  });
  const spammy = contentLedger({
    contentId: "c2", rspamdScore: 6, listedLinkFraction: 0.5, linkCount: 4,
    neighbourPlacement: 0.2, neighbourSample: 20, windowEnd: AT,
  });
  ok("clean content scores high", (c.score ?? 0) > 0.85, String(c.score));
  ok("spammy content scores low", (spammy.score ?? 1) < 0.3, String(spammy.score));
  ok("an rspamd score past the reject threshold contributes zero, not negative",
    (spammy.factors.find((f) => f.key === "rspamd score")?.value ?? -1) === 0);
}
{
  const e = engagementLedger({
    subjectId: "camp1", sent: 1000, replies: 50, positiveReplies: 20,
    unsubscribes: 2, complaints: 0, windowEnd: AT,
  });
  ok("a well-performing campaign scores high", (e.score ?? 0) > 0.85, String(e.score));
  ok("positive replies carry the most weight of any engagement factor",
    (e.factors.find((f) => f.key === "positive reply rate")?.weight ?? 0) ===
    Math.max(...e.factors.map((f) => f.weight)));
}

console.log("\n--- composite ---");
{
  const readings: LedgerReading[] = [
    ipLedger({ ipId: "ip1", delivery: clean(), listings: [], tlsFailureRate: 0, windowEnd: AT }),
    domainLedger({ domainId: "d1", delivery: clean(), dmarcAlignment: 1, dmarcSample: 500,
      placementInbox: 0.9, placementSample: 20, listings: [], windowEnd: AT }),
    mailboxLedger({ mailboxId: "m1", delivery: clean(500), replies: 25, ageDays: 90,
      warmupDay: 60, warmupPlateau: 40, windowEnd: AT }),
  ];
  const c = composite(readings);
  ok("a composite is produced", c.score !== null && c.score > 0.85, String(c.score));
  ok("and ALWAYS carries its decomposition", c.ledgers.length === 3);
  ok("with the weights version recorded", c.weightsVersion === DEFAULT_COMPOSITE.version);
  ok("nothing is missing here", c.missing.length === 0);
}
{
  // The case that matters: a new fleet with no history.
  const readings = [
    ipLedger({ ipId: "ip9", delivery: clean(2), listings: [], tlsFailureRate: null, windowEnd: AT }),
    mailboxLedger({ mailboxId: "m9", delivery: clean(2), replies: 0, ageDays: 1,
      warmupDay: 1, warmupPlateau: 40, windowEnd: AT }),
  ];
  const c = composite(readings);
  ok("a fleet with no history has NO composite", c.score === null && c.insufficientData);
  ok("and names which ledgers were silent", c.missing.length === 2);
}
{
  // Mixed: one ledger has data, one does not. The empty one must be EXCLUDED,
  // not averaged in as 0.5 — that would make "unknown" look like "mediocre".
  const withData = domainLedger({ domainId: "d1", delivery: clean(), dmarcAlignment: 1,
    dmarcSample: 500, placementInbox: 1, placementSample: 20, listings: [], windowEnd: AT });
  const without = mailboxLedger({ mailboxId: "m9", delivery: clean(2), replies: 0,
    ageDays: 1, warmupDay: 1, warmupPlateau: 40, windowEnd: AT });
  const c = composite([withData, without]);
  ok("an empty ledger is excluded, not counted as 0.5",
    Math.abs((c.score ?? 0) - (withData.score ?? 0)) < 1e-9, String(c.score));
  ok("and is named as missing", c.missing.includes("MAILBOX"));
}

console.log("\n--- router inputs ---");
{
  const confident = composite([domainLedger({ domainId: "d1", delivery: clean(),
    dmarcAlignment: 1, dmarcSample: 500, placementInbox: 1, placementSample: 20,
    listings: [], windowEnd: AT })]);
  const unknown = composite([mailboxLedger({ mailboxId: "m9", delivery: clean(2), replies: 0,
    ageDays: 1, warmupDay: 1, warmupPlateau: 40, windowEnd: AT })]);
  ok("a known subject gives a confident score", routerScore(confident).confident);
  ok("an unknown subject gives the bootstrap value", routerScore(unknown).value === 0.5);
  ok("and is flagged as NOT confident, so the caller can decide",
    !routerScore(unknown).confident);
}
{
  const r = riskPenalty({
    listings: [{ severity: "critical" }], complaintRateNow: 0.001,
    complaintRatePrior: 0.0002, bounceRateNow: 0.01, bounceRatePrior: 0.01,
  });
  ok("an active critical listing dominates the risk penalty", r.value >= 0.6, String(r.value));
  ok("a doubling complaint rate adds risk", r.reasons.includes("complaint rate doubling"));
  ok("reasons are always given", r.reasons.length >= 2);
}
{
  // Rate of change catches a slow slide before any absolute threshold trips.
  const r = riskPenalty({
    listings: [], complaintRateNow: 0.0009, complaintRatePrior: 0.0002,
    bounceRateNow: 0.01, bounceRatePrior: 0.01,
  });
  ok("a rising complaint trend is caught below the absolute threshold",
    r.value > 0 && r.reasons.includes("complaint rate doubling"), String(r.value));
}
{
  const r = riskPenalty({
    listings: [], complaintRateNow: 0, complaintRatePrior: 0,
    bounceRateNow: 0.005, bounceRatePrior: 0.005,
  });
  ok("a healthy subject carries no risk penalty", r.value === 0 && r.reasons.length === 0);
}

console.log("\n--- delta explanation ---");
{
  const before = mailboxLedger({ mailboxId: "m1", delivery: clean(500), replies: 25,
    ageDays: 90, warmupDay: 60, warmupPlateau: 40, windowEnd: AT });
  const after = mailboxLedger({ mailboxId: "m1", delivery: rough(500), replies: 25,
    ageDays: 90, warmupDay: 60, warmupPlateau: 40, windowEnd: AT });
  const delta = explainDelta(before, after);
  ok("a degradation is explained", delta.length > 0);
  ok("ranked by contribution", Math.abs(delta[0]!.delta) >= Math.abs(delta[delta.length - 1]!.delta));
  ok("and the biggest mover is named",
    ["bounce rate", "complaint rate", "deferral rate"].includes(delta[0]!.key), delta[0]!.key);
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
