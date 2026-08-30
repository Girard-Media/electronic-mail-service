/**
 * Ledger computation (E11-002..E11-032). planning/ARCHITECTURE.md §4.
 *
 * Five independent series with different half-lives, composed only at read time.
 * The two rules that make this honest:
 *
 *  1. A composite is NEVER returned without its decomposition. There is no
 *     stored "the score" — if we cannot show which measurements produced a
 *     number, we do not show the number.
 *  2. Insufficient volume returns null, not a default. A brand-new mailbox with
 *     three sends has no reputation; reporting 0.5 for it would be a fabrication
 *     that the router would then act on.
 *
 * Every factor carries the source it came from — maillog, dnsbl, dmarc, tlsrpt,
 * fbl, seed — so invariant I6 is checkable rather than aspirational.
 */

export type Subject = "IP" | "DOMAIN" | "MAILBOX" | "CONTENT" | "ENGAGEMENT";

export type FactorSource = "maillog" | "dnsbl" | "dmarc" | "tlsrpt" | "fbl" | "seed" | "rspamd" | "registry";

export interface Factor {
  key: string;
  /** Normalised 0..1, where 1 is good. */
  value: number;
  weight: number;
  source: FactorSource;
  /** What the number was computed from, for the tooltip and the audit. */
  sample: number;
  observedAt: Date;
}

export interface LedgerReading {
  subject: Subject;
  subjectId: string;
  score: number | null;
  insufficientData: boolean;
  sampleSize: number;
  factors: Factor[];
  windowEnd: Date;
}

/** Below this, a subject has no honest reputation to report (E11-014, E11-015). */
export const MIN_SAMPLE: Record<Subject, number> = {
  IP: 50, DOMAIN: 50, MAILBOX: 20, CONTENT: 10, ENGAGEMENT: 20,
};

export const HALF_LIFE_DAYS: Record<Subject, number> = {
  IP: 21, DOMAIN: 10, MAILBOX: 3, CONTENT: 1, ENGAGEMENT: 7,
};

export function decay(value: number, ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return value;
  return value * Math.pow(0.5, ageDays / halfLifeDays);
}

/** Clamp and guard NaN in one place, so no factor can poison a composite. */
function norm(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** A rate where LOWER is better (bounces, complaints) → a 0..1 score. */
export function inverseRate(bad: number, total: number, tolerance: number): number {
  if (total <= 0) return 1;
  const rate = bad / total;
  if (rate <= 0) return 1;
  if (rate >= tolerance) return 0;
  return norm(1 - rate / tolerance);
}

// ── Inputs, one shape per ledger ─────────────────────────────────────────────

export interface DeliveryWindow {
  sent: number;
  delivered: number;
  deferred: number;
  bounced: number;
  blockBounces: number;
  complaints: number;
  observedAt: Date;
}

export interface IpInputs {
  ipId: string;
  delivery: DeliveryWindow;
  /** Active DNSBL listings, weighted by severity. */
  listings: Array<{ provider: string; severity: "critical" | "high" | "medium" | "low"; since: Date }>;
  tlsFailureRate: number | null;
  windowEnd: Date;
}

export interface DomainInputs {
  domainId: string;
  delivery: DeliveryWindow;
  /** DMARC aggregate: fraction of reported messages that aligned. */
  dmarcAlignment: number | null;
  dmarcSample: number;
  /** Latest seed probe: fraction landing in the primary inbox. */
  placementInbox: number | null;
  placementSample: number;
  listings: Array<{ provider: string; severity: "critical" | "high" | "medium" | "low"; since: Date }>;
  windowEnd: Date;
}

export interface MailboxInputs {
  mailboxId: string;
  delivery: DeliveryWindow;
  replies: number;
  ageDays: number;
  warmupDay: number;
  warmupPlateau: number;
  windowEnd: Date;
}

export interface ContentInputs {
  contentId: string;
  /** rspamd score; lower is better, ~5 is the usual reject threshold. */
  rspamdScore: number | null;
  /** Fraction of links whose domain is on a URI blocklist. */
  listedLinkFraction: number;
  linkCount: number;
  /** Historical primary-inbox rate for structurally similar bodies. */
  neighbourPlacement: number | null;
  neighbourSample: number;
  windowEnd: Date;
}

export interface EngagementInputs {
  subjectId: string;
  sent: number;
  replies: number;
  positiveReplies: number;
  unsubscribes: number;
  complaints: number;
  windowEnd: Date;
}

const SEVERITY_PENALTY: Record<string, number> = { critical: 1, high: 0.7, medium: 0.4, low: 0.15 };

function listingFactor(
  listings: Array<{ provider: string; severity: string; since: Date }>,
  source: FactorSource,
  weight: number,
  windowEnd: Date,
): Factor {
  const worst = listings.reduce((m, l) => Math.max(m, SEVERITY_PENALTY[l.severity] ?? 0.3), 0);
  return {
    key: listings.length === 0 ? "no active listings" : `listed on ${listings.map((l) => l.provider).join(", ")}`,
    value: norm(1 - worst),
    weight, source, sample: listings.length, observedAt: windowEnd,
  };
}

// ── The five ledgers ─────────────────────────────────────────────────────────

export function ipLedger(i: IpInputs): LedgerReading {
  const d = i.delivery;
  const factors: Factor[] = [
    listingFactor(i.listings, "dnsbl", 0.4, i.windowEnd),
    { key: "deferral rate", value: inverseRate(d.deferred, d.sent, 0.15), weight: 0.25,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
    { key: "reputation-block rate", value: inverseRate(d.blockBounces, d.sent, 0.02), weight: 0.25,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
  ];
  if (i.tlsFailureRate !== null) {
    factors.push({ key: "TLS failure rate", value: inverseRate(i.tlsFailureRate, 1, 0.05), weight: 0.1,
      source: "tlsrpt", sample: 1, observedAt: i.windowEnd });
  }
  return assemble("IP", i.ipId, factors, d.sent, i.windowEnd);
}

export function domainLedger(i: DomainInputs): LedgerReading {
  const d = i.delivery;
  const factors: Factor[] = [
    { key: "bounce rate", value: inverseRate(d.bounced, d.sent, 0.05), weight: 0.25,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
    { key: "complaint rate", value: inverseRate(d.complaints, d.sent, 0.001), weight: 0.25,
      source: "fbl", sample: d.sent, observedAt: d.observedAt },
    listingFactor(i.listings, "dnsbl", 0.15, i.windowEnd),
  ];
  if (i.dmarcAlignment !== null) {
    factors.push({ key: "DMARC alignment", value: norm(i.dmarcAlignment), weight: 0.15,
      source: "dmarc", sample: i.dmarcSample, observedAt: i.windowEnd });
  }
  if (i.placementInbox !== null) {
    // Placement is the only true measure, so it carries real weight — but only
    // when the probe sample is large enough to mean anything.
    const weight = i.placementSample >= 5 ? 0.2 : 0.05;
    factors.push({ key: "inbox placement", value: norm(i.placementInbox), weight,
      source: "seed", sample: i.placementSample, observedAt: i.windowEnd });
  }
  return assemble("DOMAIN", i.domainId, factors, d.sent, i.windowEnd);
}

export function mailboxLedger(i: MailboxInputs): LedgerReading {
  const d = i.delivery;
  const rampProgress = i.warmupPlateau > 0 ? norm(i.warmupDay / 28) : 1;
  const factors: Factor[] = [
    { key: "bounce rate", value: inverseRate(d.bounced, d.sent, 0.05), weight: 0.3,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
    { key: "deferral rate", value: inverseRate(d.deferred, d.sent, 0.15), weight: 0.15,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
    { key: "complaint rate", value: inverseRate(d.complaints, d.sent, 0.001), weight: 0.25,
      source: "fbl", sample: d.sent, observedAt: d.observedAt },
    // Replies are the engagement signal we trust. Opens are excluded entirely
    // (Apple MPP made them fiction) — see E11-082/083.
    { key: "reply rate", value: d.sent > 0 ? norm((i.replies / d.sent) / 0.05) : 0, weight: 0.2,
      source: "maillog", sample: d.sent, observedAt: d.observedAt },
    { key: "warmup maturity", value: rampProgress, weight: 0.1,
      source: "registry", sample: i.ageDays, observedAt: i.windowEnd },
  ];
  return assemble("MAILBOX", i.mailboxId, factors, d.sent, i.windowEnd);
}

export function contentLedger(i: ContentInputs): LedgerReading {
  const factors: Factor[] = [];
  if (i.rspamdScore !== null) {
    // 0 is clean, 5 is the usual reject threshold. Above 5 scores zero.
    factors.push({ key: "rspamd score", value: norm(1 - i.rspamdScore / 5), weight: 0.4,
      source: "rspamd", sample: 1, observedAt: i.windowEnd });
  }
  factors.push({ key: "link-domain reputation", value: norm(1 - i.listedLinkFraction), weight: 0.3,
    source: "dnsbl", sample: i.linkCount, observedAt: i.windowEnd });
  if (i.neighbourPlacement !== null && i.neighbourSample >= 5) {
    factors.push({ key: "placement of similar bodies", value: norm(i.neighbourPlacement), weight: 0.3,
      source: "seed", sample: i.neighbourSample, observedAt: i.windowEnd });
  }
  return assemble("CONTENT", i.contentId, factors, i.linkCount + (i.rspamdScore === null ? 0 : 10), i.windowEnd);
}

export function engagementLedger(i: EngagementInputs): LedgerReading {
  const factors: Factor[] = [
    { key: "reply rate", value: i.sent > 0 ? norm((i.replies / i.sent) / 0.05) : 0, weight: 0.3,
      source: "maillog", sample: i.sent, observedAt: i.windowEnd },
    { key: "positive reply rate", value: i.sent > 0 ? norm((i.positiveReplies / i.sent) / 0.02) : 0, weight: 0.35,
      source: "maillog", sample: i.sent, observedAt: i.windowEnd },
    { key: "unsubscribe rate", value: inverseRate(i.unsubscribes, i.sent, 0.02), weight: 0.15,
      source: "maillog", sample: i.sent, observedAt: i.windowEnd },
    { key: "complaint rate", value: inverseRate(i.complaints, i.sent, 0.001), weight: 0.2,
      source: "fbl", sample: i.sent, observedAt: i.windowEnd },
  ];
  return assemble("ENGAGEMENT", i.subjectId, factors, i.sent, i.windowEnd);
}

function assemble(
  subject: Subject, subjectId: string, factors: Factor[], sampleSize: number, windowEnd: Date,
): LedgerReading {
  const insufficient = sampleSize < MIN_SAMPLE[subject] || factors.length === 0;
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const score = insufficient || totalWeight === 0
    ? null
    : norm(factors.reduce((s, f) => s + norm(f.value) * f.weight, 0) / totalWeight);
  return { subject, subjectId, score, insufficientData: insufficient, sampleSize, factors, windowEnd };
}

// ── Composite ────────────────────────────────────────────────────────────────

export interface CompositeWeights {
  version: string;
  IP: number; DOMAIN: number; MAILBOX: number; CONTENT: number; ENGAGEMENT: number;
}

export const DEFAULT_COMPOSITE: CompositeWeights = {
  version: "c1", IP: 0.25, DOMAIN: 0.25, MAILBOX: 0.25, CONTENT: 0.1, ENGAGEMENT: 0.15,
};

export interface Composite {
  score: number | null;
  insufficientData: boolean;
  /** Never omitted. The API refuses to expose a composite without this (E11-022). */
  ledgers: LedgerReading[];
  weightsVersion: string;
  /** Which ledgers had nothing to say, so the UI can label the gap. */
  missing: Subject[];
}

/**
 * Composed at read time from whatever readings exist. Ledgers with insufficient
 * data are EXCLUDED and named, rather than being counted as 0.5 — averaging in a
 * fabricated middle value is how a fleet with no history looks mediocre instead
 * of unknown, and the router would then act on it.
 */
export function composite(
  readings: LedgerReading[],
  weights: CompositeWeights = DEFAULT_COMPOSITE,
): Composite {
  const usable = readings.filter((r) => r.score !== null);
  const missing = readings.filter((r) => r.score === null).map((r) => r.subject);

  if (usable.length === 0) {
    return { score: null, insufficientData: true, ledgers: readings, weightsVersion: weights.version, missing };
  }
  const totalWeight = usable.reduce((s, r) => s + weights[r.subject], 0);
  const score = totalWeight === 0
    ? null
    : norm(usable.reduce((s, r) => s + (r.score ?? 0) * weights[r.subject], 0) / totalWeight);

  return { score, insufficientData: false, ledgers: readings, weightsVersion: weights.version, missing };
}

// ── Router inputs ────────────────────────────────────────────────────────────

/**
 * The router asks for a number. It gets one only when we have one — a subject
 * with no history returns the neutral bootstrap value AND is flagged, so the
 * caller can decide rather than silently trusting a guess (E11-054..E11-057).
 */
export function routerScore(c: Composite, bootstrap = 0.5): { value: number; confident: boolean } {
  return c.score === null ? { value: bootstrap, confident: false } : { value: c.score, confident: true };
}

/**
 * Risk penalty for the router, driven by the things that predict a block rather
 * than describe the past: an active listing, a rising complaint trend.
 */
export function riskPenalty(opts: {
  listings: Array<{ severity: string }>;
  complaintRateNow: number;
  complaintRatePrior: number;
  bounceRateNow: number;
  bounceRatePrior: number;
}): { value: number; reasons: string[] } {
  const reasons: string[] = [];
  let penalty = 0;

  const worst = opts.listings.reduce((m, l) => Math.max(m, SEVERITY_PENALTY[l.severity] ?? 0.3), 0);
  if (worst > 0) { penalty += worst * 0.6; reasons.push("active blocklist listing"); }

  // Rate of change matters more than level — a slow degradation must be caught
  // before it crosses an absolute threshold (E11-034, E11-035).
  if (opts.complaintRateNow > opts.complaintRatePrior * 2 && opts.complaintRateNow > 0.0005) {
    penalty += 0.25; reasons.push("complaint rate doubling");
  }
  if (opts.bounceRateNow > opts.bounceRatePrior * 2 && opts.bounceRateNow > 0.02) {
    penalty += 0.2; reasons.push("bounce rate doubling");
  }
  return { value: norm(penalty), reasons };
}

/** Rank what moved a score, so the delta view can explain itself (E11-028). */
export function explainDelta(before: LedgerReading, after: LedgerReading): Array<{ key: string; delta: number }> {
  const prior = new Map(before.factors.map((f) => [f.key, f]));
  return after.factors
    .map((f) => ({ key: f.key, delta: (f.value - (prior.get(f.key)?.value ?? f.value)) * f.weight }))
    .filter((d) => Math.abs(d.delta) > 1e-9)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
