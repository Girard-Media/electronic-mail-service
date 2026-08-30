/**
 * @ems/sequence — the durable per-enrolment state machine.
 *
 * A reply stops the enrolment AND every other campaign targeting that person,
 * as a domain event rather than a per-campaign check (E15-019).
 */

export type EnrollmentState =
  | "PENDING" | "ACTIVE" | "REPLIED" | "BOUNCED"
  | "UNSUBSCRIBED" | "COMPLETED" | "STOPPED" | "BLOCKED_BY_POLICY";

export const TERMINAL: EnrollmentState[] = [
  "REPLIED", "BOUNCED", "UNSUBSCRIBED", "COMPLETED", "STOPPED", "BLOCKED_BY_POLICY",
];

export const ENROLLMENT_TRANSITIONS: Record<EnrollmentState, EnrollmentState[]> = {
  PENDING: ["ACTIVE", "BLOCKED_BY_POLICY", "STOPPED"],
  ACTIVE: ["REPLIED", "BOUNCED", "UNSUBSCRIBED", "COMPLETED", "STOPPED"],
  REPLIED: [], BOUNCED: [], UNSUBSCRIBED: [], COMPLETED: [], STOPPED: [], BLOCKED_BY_POLICY: [],
};

export interface SendWindow {
  start: string; // "09:00"
  end: string;   // "17:00"
  days: number[]; // 1=Mon..7=Sun
  timezone: string;
}

/**
 * Variant assignment is deterministic from (leadId, stepId) so re-runs are
 * stable and results stay attributable (E15-011, E15-012).
 */
export function assignVariant(leadId: string, stepId: string, weights: number[]): number {
  let h = 2166136261;
  const key = `${leadId}:${stepId}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let point = (h >>> 0) % total;
  for (let i = 0; i < weights.length; i++) {
    point -= weights[i] ?? 0;
    if (point < 0) return i;
  }
  return weights.length - 1;
}

/** A first-touch step may never use RE:/FW: — deceptive subject, illegal (E15-063). */
const DECEPTIVE_PREFIX = /^\s*(re|fw|fwd)\s*:/i;

export function isDeceptiveFirstTouch(subject: string, isFirstTouch: boolean): boolean {
  return isFirstTouch && DECEPTIVE_PREFIX.test(subject);
}
