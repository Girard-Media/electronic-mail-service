import { hash32 } from "./schedule.js";
/**
 * @ems/sequence — the durable per-enrolment state machine.
 *
 * A reply stops the enrolment AND every other campaign targeting that person,
 * as a domain event rather than a per-campaign check (E15-019).
 */

// EnrollmentState / TERMINAL / ENROLLMENT_TRANSITIONS live in ./enroll.ts.

/**
 * Variant assignment is deterministic from (leadId, stepId) so re-runs are
 * stable and results stay attributable (E15-011, E15-012).
 */
export function assignVariant(leadId: string, stepId: string, weights: number[]): number {
  // Same finalised hash as the scheduler's jitter — unfinalised FNV-1a clusters
  // badly on short, similar keys, and lead ids are exactly that.
  const h = hash32(`${leadId}:${stepId}`);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let point = h % total;
  for (let i = 0; i < weights.length; i++) {
    point -= weights[i] ?? 0;
    if (point < 0) return i;
  }
  return weights.length - 1;
}

export * from "./schedule.js";
export * from "./enroll.js";
export * from "./halt.js";
