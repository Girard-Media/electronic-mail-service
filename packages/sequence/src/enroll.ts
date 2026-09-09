/**
 * Enrolment decisions (E15-001..E15-005, E15-008). Pure.
 */

export type EnrollmentState =
  | "PENDING" | "ACTIVE" | "REPLIED" | "BOUNCED"
  | "UNSUBSCRIBED" | "COMPLETED" | "STOPPED" | "BLOCKED_BY_POLICY";

export const TERMINAL: EnrollmentState[] = [
  "REPLIED", "BOUNCED", "UNSUBSCRIBED", "COMPLETED", "STOPPED", "BLOCKED_BY_POLICY",
];

export const ENROLLMENT_TRANSITIONS: Record<EnrollmentState, EnrollmentState[]> = {
  PENDING: ["ACTIVE", "BLOCKED_BY_POLICY", "STOPPED", "REPLIED", "UNSUBSCRIBED"],
  ACTIVE: ["REPLIED", "BOUNCED", "UNSUBSCRIBED", "COMPLETED", "STOPPED"],
  REPLIED: [], BOUNCED: [], UNSUBSCRIBED: [], COMPLETED: [], STOPPED: [], BLOCKED_BY_POLICY: [],
};

export function canTransitionEnrollment(from: EnrollmentState, to: EnrollmentState): boolean {
  return (ENROLLMENT_TRANSITIONS[from] ?? []).includes(to);
}

const DECEPTIVE_PREFIX = /^\s*(re|fw|fwd)\s*:/i;

/** A first-touch step may never use RE:/FW: — deceptive subject (E15-063). */
export function isDeceptiveFirstTouch(subject: string, isFirstTouch: boolean): boolean {
  return isFirstTouch && DECEPTIVE_PREFIX.test(subject);
}

export type EnrolBlock =
  | "already-enrolled"
  | "terminal"
  | "lead-frozen"
  | "lead-suppressed"
  | "no-first-step"
  | "no-variant"
  | "deceptive-first-touch";

export function enrolDecision(input: {
  existingState: EnrollmentState | null;
  frozen: boolean;
  suppressed: boolean;
  hasFirstStep: boolean;
  hasVariant: boolean;
  firstTouchSubject?: string;
  isFirstTouch?: boolean;
}): { ok: true } | { ok: false; code: EnrolBlock; message: string } {
  if (input.existingState) {
    if (input.existingState === "PENDING" || input.existingState === "ACTIVE") {
      return { ok: false, code: "already-enrolled", message: "This lead is already in the campaign." };
    }
    if ((TERMINAL as string[]).includes(input.existingState)) {
      return { ok: false, code: "terminal", message: `Lead already ended this campaign (${input.existingState}).` };
    }
  }
  if (input.frozen) {
    return { ok: false, code: "lead-frozen", message: "Lead is frozen (GDPR restriction)." };
  }
  if (input.suppressed) {
    return { ok: false, code: "lead-suppressed", message: "Lead is on the suppression list." };
  }
  if (!input.hasFirstStep) {
    return { ok: false, code: "no-first-step", message: "Add a sequence step before enrolling." };
  }
  if (!input.hasVariant) {
    return { ok: false, code: "no-variant", message: "The first step has no copy variant." };
  }
  if (
    input.isFirstTouch &&
    input.firstTouchSubject &&
    isDeceptiveFirstTouch(input.firstTouchSubject, true)
  ) {
    return { ok: false, code: "deceptive-first-touch", message: "A first-touch step cannot use a RE:/FW: subject." };
  }
  return { ok: true };
}

/** Enrolment starts PENDING and becomes ACTIVE only once the first intent exists. */
export function startEnrollmentState(): EnrollmentState {
  return "PENDING";
}
