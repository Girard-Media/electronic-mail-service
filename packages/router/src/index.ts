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

export class NotImplemented extends Error {
  constructor(task: string) {
    super(`not implemented — see ${task} in planning/TODO.md`);
    this.name = "NotImplemented";
  }
}

export async function route(_req: RouteRequest): Promise<RouteResult> {
  throw new NotImplemented("E07-003..E07-022");
}

export * from "./buckets.js";
