/**
 * @ems/warmup — ramp scheduling plus our own peer network.
 *
 * We deliberately do NOT join or build a cross-customer warmup exchange where
 * strangers' mailboxes fake engagement with each other (ADR-0003). Our own
 * fleet exercising itself is honest, controllable, and not shared-fate.
 */

export interface WarmupPlan {
  id: string;
  name: string;
  startPerDay: number;
  incrementWeek: number;
  plateau: number;
  minDomainAgeDays: number;
  maxBounceRate: number;
  maxDeferRate: number;
  maxComplaintRate: number;
  weekdayOnly: boolean;
  jitterPct: number;
}

export const CONSERVATIVE: WarmupPlan = {
  id: "conservative", name: "Conservative",
  startPerDay: 3, incrementWeek: 3, plateau: 30, minDomainAgeDays: 21,
  maxBounceRate: 0.02, maxDeferRate: 0.08, maxComplaintRate: 0.0005,
  weekdayOnly: true, jitterPct: 0.3,
};

export const STANDARD: WarmupPlan = {
  id: "standard", name: "Standard",
  startPerDay: 5, incrementWeek: 5, plateau: 40, minDomainAgeDays: 14,
  maxBounceRate: 0.03, maxDeferRate: 0.1, maxComplaintRate: 0.001,
  weekdayOnly: true, jitterPct: 0.25,
};

/** Daily cap for a given warmup day. Never exceeds the plan's plateau. */
export function capForDay(plan: WarmupPlan, warmupDay: number): number {
  const weeks = Math.floor(Math.max(0, warmupDay) / 7);
  return Math.min(plan.plateau, plan.startPerDay + weeks * plan.incrementWeek);
}

export type HoldReason = "bounce-rate" | "defer-rate" | "complaint-rate" | "placement-floor";

export interface HealthWindow {
  sent: number;
  bounced: number;
  deferred: number;
  complaints: number;
}

/**
 * The ramp holds instead of pushing through damage. A hold is recorded with the
 * metric that triggered it and surfaced in plain language (E06-012, E06-013).
 */
export function shouldHold(plan: WarmupPlan, w: HealthWindow): HoldReason | null {
  if (w.sent === 0) return null;
  if (w.bounced / w.sent > plan.maxBounceRate) return "bounce-rate";
  if (w.deferred / w.sent > plan.maxDeferRate) return "defer-rate";
  if (w.complaints / w.sent > plan.maxComplaintRate) return "complaint-rate";
  return null;
}

/** Rollback reduces to the last healthy level rather than only holding (E06-011). */
export function rollbackCap(currentCap: number, plan: WarmupPlan): number {
  return Math.max(plan.startPerDay, currentCap - plan.incrementWeek);
}
