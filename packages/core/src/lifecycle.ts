/**
 * Email lifecycle rules — the status state machine, kept pure so the API, the
 * workers, and the tests all agree on one definition.
 *
 * Status is monotonic and forward-only:
 *   queued ─┬─→ sent ─→ delivered
 *           │        └─→ bounced / complained
 *           ├─→ failed
 *           └─→ canceled
 *   scheduled ─→ (queued path above)
 */

/** Every status an Email row can hold. Mirrors the `EmailStatus` enum in Prisma. */
export const EMAIL_STATUSES = [
  "queued",
  "scheduled",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "canceled",
] as const;

export type EmailStatusName = (typeof EMAIL_STATUSES)[number];

/**
 * Statuses a message can still be pulled back from — it has not been handed to
 * a receiving server yet. Anything past this point is out of our hands.
 */
export const CANCELABLE_STATUSES = ["queued", "scheduled"] as const;

export type CancelDecision =
  /** Safe to cancel — perform the conditional update. */
  | { action: "cancel" }
  /** Already cancelled; report success so retries stay idempotent. */
  | { action: "already_canceled" }
  /** The message has left (or failed); cancelling is no longer meaningful. */
  | { action: "too_late"; status: EmailStatusName };

/**
 * Decide what cancelling a message in `status` should do.
 *
 * Exhaustive over `EMAIL_STATUSES` on purpose: adding a status to the schema
 * without deciding its cancel semantics makes the lifecycle test fail rather
 * than silently defaulting to "cancelable".
 */
export function cancelDecision(status: EmailStatusName): CancelDecision {
  if (status === "canceled") return { action: "already_canceled" };
  if ((CANCELABLE_STATUSES as readonly string[]).includes(status)) {
    return { action: "cancel" };
  }
  return { action: "too_late", status };
}

/** Human-facing reason used in the 409 when a message can no longer be cancelled. */
export function notCancelableMessage(id: string, status: EmailStatusName): string {
  const past: Partial<Record<EmailStatusName, string>> = {
    sent: "already been sent",
    delivered: "already been delivered",
    bounced: "already bounced",
    complained: "already been marked as spam",
    failed: "already failed",
  };
  return `Email ${id} has ${past[status] ?? `status "${status}"`} and can no longer be canceled.`;
}
