/**
 * Candidate filtering and scoring (E07-003..E07-022).
 *
 * Hard filters run FIRST and are absolute — no score can rescue a candidate that
 * fails one. Only survivors are scored. Every rejection is recorded with the
 * filter that caused it, so "why not that mailbox?" is answerable from the trace.
 */

import type { EspFamily, HardFilter, RouteTrace, ScoreFactors, RouterWeights } from "./index.js";
import { DEFAULT_WEIGHTS, score } from "./index.js";

export interface Candidate {
  mailboxId: string;
  domainId: string;
  ipId: string;
  nodeId: string;

  // Fleet state
  mailboxStatus: string;
  domainStatus: string;
  ipStatus: string;
  nodeStatus: string;
  nodeRole: string;
  nodeVerified: boolean;
  pool: string;

  domainVerified: boolean;
  /** Router refuses a domain before this instant, whatever else is true. */
  domainAgeReadyAt: Date | null;
  warmupHoldAt: Date | null;

  // Capacity
  mailboxDailyCap: number;
  mailboxSentToday: number;

  // Scoring inputs
  reputationScore: number;
  /** Measured placement for (this domain, this recipient ESP), 0..1. */
  espAffinity: Record<string, number>;
  warmupDay: number;
  riskPenalty: number;
  /** When this mailbox last sent to the recipient's company domain. */
  lastSendToRecipientDomainAt: Date | null;
  /** When this mailbox last sent anything. LRU tie-break across equal scores. */
  lastSendAt?: Date | null;
}

export interface FilterContext {
  at: Date;
  pool: string;
  /**
   * When set and non-empty, the campaign attached these mailboxes. Named `pool`
   * is then ignored. Null / empty → named-pool matching (legacy).
   */
  mailboxIds?: Set<string> | null;
  esp: EspFamily;
  recipientDomain: string;
  /** Domains this jurisdiction is permitted to send from, or null for no restriction. */
  allowedDomainIds: Set<string> | null;
  /** How long one mailbox must wait before hitting the same company again. */
  recipientDomainCooldownMs: number;
  /** Ceiling on how many mailboxes may touch one company across the whole fleet. */
  recipientDomainFanoutCap: number;
  recipientDomainFanoutUsed: number;
  /** Intended burst size, used by warmupFit. */
  intendedVolume: number;
}

/** Returns the filter that rejects this candidate, or null if it survives. */
export function reject(c: Candidate, ctx: FilterContext): HardFilter | null {
  if (!c.domainVerified) return "domain-unverified";
  if (c.domainAgeReadyAt !== null && c.domainAgeReadyAt > ctx.at) return "domain-before-age-ready";
  if (c.mailboxStatus !== "ACTIVE") return "mailbox-not-active";
  if (c.warmupHoldAt !== null) return "mailbox-warmup-hold";
  if (c.ipStatus === "QUARANTINED") return "ip-quarantined";
  if (c.ipStatus === "THROTTLED") return "ip-throttled";
  if (c.nodeStatus !== "ACTIVE" || !c.nodeVerified) return "node-unhealthy";
  if (c.nodeRole !== "CAMPAIGN") return "node-role-not-campaign";
  if (c.mailboxSentToday >= c.mailboxDailyCap) return "no-cap-headroom";
  if (ctx.mailboxIds && ctx.mailboxIds.size > 0) {
    if (!ctx.mailboxIds.has(c.mailboxId)) return "pool-mismatch";
  } else if (c.pool !== ctx.pool) {
    return "pool-mismatch";
  }
  if (ctx.allowedDomainIds !== null && !ctx.allowedDomainIds.has(c.domainId)) {
    return "policy-denies-domain-for-jurisdiction";
  }
  if (
    c.lastSendToRecipientDomainAt !== null &&
    ctx.at.getTime() - c.lastSendToRecipientDomainAt.getTime() < ctx.recipientDomainCooldownMs
  ) {
    return "recipient-domain-cooldown";
  }
  if (ctx.recipientDomainFanoutUsed >= ctx.recipientDomainFanoutCap) {
    return "recipient-domain-fanout-cap";
  }
  return null;
}

export function factorsFor(c: Candidate, ctx: FilterContext): ScoreFactors {
  const headroomAbs = Math.max(0, c.mailboxDailyCap - c.mailboxSentToday);
  const headroom = c.mailboxDailyCap > 0 ? headroomAbs / c.mailboxDailyCap : 0;

  // A warming mailbox is a poor choice for a large burst even when it has
  // headroom right now — spending a ramping mailbox's whole day in one batch is
  // exactly the behaviour the warmup engine exists to prevent.
  const rampProgress = Math.min(1, c.warmupDay / 28);
  const burstRatio = c.mailboxDailyCap > 0 ? Math.min(1, ctx.intendedVolume / c.mailboxDailyCap) : 1;
  const warmupFit = 1 - burstRatio * (1 - rampProgress);

  // Recency decays over the cooldown window: a mailbox that hit this company
  // recently is penalised even once it is technically eligible again.
  let recencyPenalty = 0;
  if (c.lastSendToRecipientDomainAt !== null && ctx.recipientDomainCooldownMs > 0) {
    const elapsed = ctx.at.getTime() - c.lastSendToRecipientDomainAt.getTime();
    recencyPenalty = Math.max(0, 1 - elapsed / (ctx.recipientDomainCooldownMs * 4));
  }

  return {
    reputationScore: clamp01(c.reputationScore),
    headroom: clamp01(headroom),
    espAffinity: clamp01(c.espAffinity[ctx.esp] ?? 0.5),
    warmupFit: clamp01(warmupFit),
    recencyPenalty: clamp01(recencyPenalty),
    riskPenalty: clamp01(c.riskPenalty),
  };
}

export interface Selection {
  chosen: Candidate | null;
  trace: RouteTrace;
}

/**
 * Deterministic: identical inputs produce identical selections (E07-022).
 * Ties break on mailboxId so a re-run of the same decision is reproducible.
 */
export function select(
  candidates: Candidate[],
  ctx: FilterContext,
  weights: RouterWeights = DEFAULT_WEIGHTS,
): Selection {
  const filtered: Array<{ mailboxId: string; filter: HardFilter }> = [];
  const survivors: Array<{ c: Candidate; factors: ScoreFactors; s: number }> = [];

  for (const c of candidates) {
    const r = reject(c, ctx);
    if (r !== null) {
      filtered.push({ mailboxId: c.mailboxId, filter: r });
      continue;
    }
    const factors = factorsFor(c, ctx);
    survivors.push({ c, factors, s: score(factors, weights) });
  }

  survivors.sort((a, b) => b.s - a.s || lruCmp(a.c, b.c) || (a.c.mailboxId < b.c.mailboxId ? -1 : 1));
  const best = survivors[0];

  const trace: RouteTrace = {
    candidatesConsidered: candidates.length,
    candidatesFiltered: filtered,
    chosen: best
      ? { mailboxId: best.c.mailboxId, factors: best.factors }
      : { mailboxId: "", factors: zeroFactors() },
    runnersUp: survivors.slice(1, 4).map((x) => ({ mailboxId: x.c.mailboxId, score: round4(x.s) })),
    weightsVersion: weights.version,
  };

  return { chosen: best?.c ?? null, trace };
}

/** Older lastSendAt wins. Never-sent (null) is treated as epoch 0 — first in line. */
function lruCmp(a: Candidate, b: Candidate): number {
  const at = a.lastSendAt?.getTime() ?? 0;
  const bt = b.lastSendAt?.getTime() ?? 0;
  return at - bt;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function zeroFactors(): ScoreFactors {
  return { reputationScore: 0, headroom: 0, espAffinity: 0, warmupFit: 0, recencyPenalty: 0, riskPenalty: 0 };
}
