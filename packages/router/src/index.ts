/**
 * @ems/router — the send-path decision engine.
 *
 * CONTRACT (planning/ARCHITECTURE.md §3.2). This package is the ONLY one
 * permitted to make a final send decision. Nothing else may choose a mailbox.
 *
 * Input:  a SendIntent plus the recipient's ESP family.
 * Output: a SendPlan, or a Deferral. Deferral is a first-class success —
 *         it is the mechanism that keeps reputation solvent.
 */

export type EspFamily =
  | "google"
  | "microsoft"
  | "yahoo"
  | "proofpoint"
  | "mimecast"
  | "barracuda"
  | "generic";

export interface RouteRequest {
  intentId: string;
  orgId: string;
  campaignId: string;
  recipientEmail: string;
  recipientDomain: string;
  esp: EspFamily;
  /** Campaign's domain pool. Candidates outside it are filtered before scoring. */
  pool: string;
  /** ISO-3166-2 resolved by @ems/policy. Never routed without one (I7). */
  jurisdiction: string;
  at: Date;
}

export interface SendPlan {
  kind: "plan";
  nodeId: string;
  ipId: string;
  domainId: string;
  mailboxId: string;
  sendAt: Date;
  score: number;
  /** Why this mailbox and not the others. Persisted to SendIntent.routeTrace (I5). */
  trace: RouteTrace;
}

export interface RouteTrace {
  candidatesConsidered: number;
  candidatesFiltered: Array<{ mailboxId: string; filter: HardFilter }>;
  chosen: { mailboxId: string; factors: ScoreFactors };
  runnersUp: Array<{ mailboxId: string; score: number }>;
  weightsVersion: string;
}

/** Hard filters run before scoring. Any one of these removes a candidate outright. */
export type HardFilter =
  | "domain-unverified"
  | "domain-before-age-ready"
  | "mailbox-not-active"
  | "mailbox-warmup-hold"
  | "ip-quarantined"
  | "ip-throttled"
  | "node-unhealthy"
  | "node-role-not-campaign"
  | "no-cap-headroom"
  | "pool-mismatch"
  | "policy-denies-domain-for-jurisdiction"
  | "recipient-domain-cooldown"
  | "recipient-domain-fanout-cap";

export interface ScoreFactors {
  reputationScore: number;
  headroom: number;
  espAffinity: number;
  warmupFit: number;
  recencyPenalty: number;
  riskPenalty: number;
}

/** Every weight is versioned config. Never a magic number in code (E07-019). */
export interface RouterWeights {
  version: string;
  reputationScore: number;
  headroom: number;
  espAffinity: number;
  warmupFit: number;
  recencyPenalty: number;
  riskPenalty: number;
}

export const DEFAULT_WEIGHTS: RouterWeights = {
  version: "w1",
  reputationScore: 0.35,
  headroom: 0.2,
  espAffinity: 0.2,
  warmupFit: 0.15,
  recencyPenalty: 0.05,
  riskPenalty: 0.05,
};

export type DeferReason =
  | "no-candidates"
  | "all-caps-exhausted"
  | "outside-send-window"
  | "esp-backoff"
  | "node-circuit-open"
  | "fleet-paused";

export interface Deferral {
  kind: "defer";
  until: Date;
  reason: DeferReason;
  /** Which constraint bound. Surfaced to the customer as the reason a campaign is slow. */
  bindingConstraint: string;
}

export type RouteResult = SendPlan | Deferral;

export function score(factors: ScoreFactors, w: RouterWeights = DEFAULT_WEIGHTS): number {
  return (
    w.reputationScore * factors.reputationScore +
    w.headroom * factors.headroom +
    w.espAffinity * factors.espAffinity +
    w.warmupFit * factors.warmupFit -
    w.recencyPenalty * factors.recencyPenalty -
    w.riskPenalty * factors.riskPenalty
  );
}

export * from "./buckets.js";
export * from "./candidates.js";

import { select, type Candidate, type FilterContext } from "./candidates.js";
import { buildSpecs, claim, type BucketClient, type BucketInputs } from "./buckets.js";

export interface RouteDeps {
  /** Live candidates for this request's pool. */
  candidates: Candidate[];
  filterContext: FilterContext;
  buckets: BucketClient;
  /** Per-candidate cap inputs, keyed by mailboxId. */
  capsFor(c: Candidate): Omit<BucketInputs, "at" | "esp">;
  weights?: RouterWeights;
  /** Backoff schedule for repeated deferrals, in minutes. */
  deferBackoffMin?: number[];
  deferCount?: number;
}

const DEFAULT_BACKOFF_MIN = [1, 5, 15, 30, 60, 120, 240];

/**
 * The send decision (ARCHITECTURE §3.2).
 *
 * Order is load-bearing: filter and score FIRST, then attempt the atomic bucket
 * claim on the winner. Claiming before scoring would spend allowance on a
 * mailbox we might not choose.
 *
 * If the winner's claim fails, we fall through to the next-best candidate rather
 * than deferring outright — the binding constraint was that mailbox's bucket,
 * not the fleet's capacity.
 */
export async function route(req: RouteRequest, deps: RouteDeps): Promise<RouteResult> {
  const { chosen, trace } = select(deps.candidates, deps.filterContext, deps.weights ?? DEFAULT_WEIGHTS);

  if (chosen === null) {
    return defer(req, trace, deps, inferReason(trace));
  }

  // Try the winner, then runners-up, before giving up on the whole request.
  const byId = new Map(deps.candidates.map((c) => [c.mailboxId, c]));
  const order: Candidate[] = [chosen, ...trace.runnersUp.map((r) => byId.get(r.mailboxId)).filter((c): c is Candidate => !!c)];

  for (const cand of order) {
    const specs = buildSpecs({ ...deps.capsFor(cand), esp: req.esp, at: req.at });
    const claimed = await claim(deps.buckets, specs);
    if (claimed.ok) {
      const factors = trace.chosen.mailboxId === cand.mailboxId
        ? trace.chosen.factors
        : { ...trace.chosen.factors };
      return {
        kind: "plan",
        nodeId: cand.nodeId,
        ipId: cand.ipId,
        domainId: cand.domainId,
        mailboxId: cand.mailboxId,
        sendAt: req.at,
        score: 0,
        trace: { ...trace, chosen: { mailboxId: cand.mailboxId, factors } },
      };
    }
  }

  return defer(req, trace, deps, "all-caps-exhausted");
}

function inferReason(trace: RouteTrace): DeferReason {
  if (trace.candidatesConsidered === 0) return "no-candidates";
  const filters = trace.candidatesFiltered.map((f) => f.filter);
  if (filters.every((f) => f === "no-cap-headroom")) return "all-caps-exhausted";
  if (filters.some((f) => f === "node-unhealthy")) return "node-circuit-open";
  return "no-candidates";
}

function defer(req: RouteRequest, trace: RouteTrace, deps: RouteDeps, reason: DeferReason): Deferral {
  const schedule = deps.deferBackoffMin ?? DEFAULT_BACKOFF_MIN;
  const n = Math.min(deps.deferCount ?? 0, schedule.length - 1);
  const minutes = schedule[n] ?? schedule[schedule.length - 1] ?? 60;

  // Name the constraint that actually bound, so a slow campaign can be explained
  // in terms the customer can act on rather than a generic "deferred".
  const counts = new Map<string, number>();
  for (const f of trace.candidatesFiltered) counts.set(f.filter, (counts.get(f.filter) ?? 0) + 1);
  const binding = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    kind: "defer",
    until: new Date(req.at.getTime() + minutes * 60_000),
    reason,
    bindingConstraint: binding ? `${binding[0]} (${binding[1]} of ${trace.candidatesConsidered})` : reason,
  };
}
