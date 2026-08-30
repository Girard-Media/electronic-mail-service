/**
 * @ems/verify — self-hosted email verification.
 *
 * CRITICAL ISOLATION: the SMTP probe runs from a dedicated verification IP that
 * never sends campaigns. Probing generates connection patterns some receivers
 * penalise; it must never touch campaign IP reputation (E12-016, E12-017).
 *
 * Types live in ./engine and are re-exported here. Declaring them in both places
 * shadows the richer definitions silently — TypeScript does not error on it.
 */

export * from "./engine.js";

/**
 * Statuses that mean "deliverable-unknown" rather than good or bad. Surfaced in
 * the UI so a customer understands what we could and could not establish
 * (E12-026, E12-083).
 */
export const INCONCLUSIVE_STATUSES = ["CATCH_ALL", "UNKNOWN"] as const;

export const STATUS_EXPLANATION: Record<string, string> = {
  VALID: "The receiving server accepted this address and rejected a random one, so the mailbox exists.",
  INVALID: "The receiving server rejected this address, or the domain cannot receive mail.",
  CATCH_ALL: "This domain accepts every address, so we cannot tell whether this mailbox exists. Deliverable-unknown, not valid.",
  ROLE: "A shared or departmental address. Deliverable, but usually lower engagement and higher complaint risk.",
  DISPOSABLE: "A throwaway address provider. Blocked.",
  TRAP_SUSPECT: "Signals consistent with a spam trap. Blocked — one hit can cost a sending IP.",
  UNKNOWN: "We could not establish a verdict. The provider accepts everything at this stage, or the probe did not run.",
};
