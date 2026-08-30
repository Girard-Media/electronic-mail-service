/**
 * @ems/inbox — threading, classification and handoff.
 *
 * Inbound content is untrusted data (see @ems/ai wrapUntrusted). The classifier
 * has no tool access, no database write access, and no send authority: the worst
 * case of a successful injection is a wrong label on one reply.
 */

export type ReplyIntent =
  | "INTERESTED" | "NOT_INTERESTED" | "OUT_OF_OFFICE" | "REFERRAL"
  | "UNSUBSCRIBE" | "AUTO_REPLY" | "BOUNCE" | "OTHER";

export type ThreadState = "OPEN" | "SNOOZED" | "CLOSED" | "ARCHIVED";

/**
 * Deliberately asymmetric. An unsubscribe classification acts IMMEDIATELY with
 * no corroboration, because the failure mode of over-suppressing is trivial and
 * the failure mode of under-suppressing is illegal (planning/AI.md §7).
 * Everything else needs corroboration or a human.
 */
export function actsWithoutCorroboration(intent: ReplyIntent): boolean {
  return intent === "UNSUBSCRIBE";
}

/** Ambiguous defaults to suppressing, then queues for human review (E14-060/061). */
export function resolveAmbiguous(intent: ReplyIntent, confidence: number, floor = 0.7): ReplyIntent {
  if (confidence >= floor) return intent;
  return "UNSUBSCRIBE";
}

export interface ThreadKey {
  inReplyTo: string | null;
  references: string[];
  subject: string;
  participants: string[];
}

/** Thread on In-Reply-To/References first; never merge two threads on a weak match. */
export function threadConfidence(k: ThreadKey): number {
  if (k.inReplyTo) return 1;
  if (k.references.length > 0) return 0.95;
  return 0.4;
}

export const WEAK_MATCH_FLOOR = 0.9;
