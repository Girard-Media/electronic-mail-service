/**
 * Reply-halt (E15-018, E15-019, E15-023).
 *
 * A human reply stops every in-flight enrolment for that person, not just the
 * campaign that sourced the thread. Unsubscribe is the same shape with a
 * different terminal state. OOO / auto-reply / bounce do not halt here.
 */

import {
  canTransitionEnrollment,
  TERMINAL,
  type EnrollmentState,
} from "./enroll.js";

export type HaltTo = "REPLIED" | "UNSUBSCRIBED";

export function haltTargetForIntent(intent: string): HaltTo | null {
  if (intent === "UNSUBSCRIBE") return "UNSUBSCRIBED";
  if (intent === "INTERESTED" || intent === "NOT_INTERESTED" || intent === "REFERRAL") {
    return "REPLIED";
  }
  return null;
}

export function isInFlight(state: EnrollmentState): boolean {
  return state === "PENDING" || state === "ACTIVE";
}

export function haltEnrollment(state: EnrollmentState, to: HaltTo): EnrollmentState | null {
  if ((TERMINAL as string[]).includes(state)) return null;
  if (!isInFlight(state)) return null;
  if (!canTransitionEnrollment(state, to)) return null;
  return to;
}

export type IntentCancelState = "PENDING" | "DEFERRED" | "ROUTED";

export function shouldCancelIntent(state: string): state is IntentCancelState {
  return state === "PENDING" || state === "DEFERRED" || state === "ROUTED";
}
