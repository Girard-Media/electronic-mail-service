/**
 * Campaign sending pool (D17).
 *
 * A campaign either attaches an explicit mailbox set (the ListKit "put these
 * domains on this campaign" move) or falls back to the named fleet pool string
 * (`Campaign.domainPool`, default "default").
 *
 * Attaching a domain means attaching every mailbox on that domain that is still
 * in an attachable status. The router still refuses anything that is not
 * ACTIVE — WARMING rows sit on the join so they enter rotation when they
 * graduate, without a second attach step.
 */

export const ATTACHABLE_MAILBOX_STATUSES = ["ACTIVE", "WARMING", "PAUSED"] as const;
export type AttachableMailboxStatus = (typeof ATTACHABLE_MAILBOX_STATUSES)[number];

export const TERMINAL_MAILBOX_STATUSES = ["DRAINING", "RETIRED", "BURNED", "CREATED"] as const;

export interface PoolMailbox {
  id: string;
  domainId: string;
  status: string;
}

export type ResolvedPool =
  | { kind: "attached"; mailboxIds: Set<string> }
  | { kind: "named"; pool: string };

/** Empty attach list → named pool. Non-empty → only those mailboxes. */
export function resolveCampaignPool(namedPool: string, attachedMailboxIds: string[]): ResolvedPool {
  if (attachedMailboxIds.length === 0) return { kind: "named", pool: namedPool };
  return { kind: "attached", mailboxIds: new Set(attachedMailboxIds) };
}

export function isAttachableStatus(status: string): boolean {
  return (ATTACHABLE_MAILBOX_STATUSES as readonly string[]).includes(status);
}

/**
 * Expand domain ids to mailbox ids. Unknown domains contribute nothing.
 * Terminal / CREATED mailboxes are skipped — they cannot send.
 */
export function expandDomainAttach(domainIds: string[], mailboxes: PoolMailbox[]): string[] {
  if (domainIds.length === 0) return [];
  const wanted = new Set(domainIds);
  const ids: string[] = [];
  for (const m of mailboxes) {
    if (wanted.has(m.domainId) && isAttachableStatus(m.status)) ids.push(m.id);
  }
  return ids;
}

/** Union mailbox ids + domain expansion, de-duplicated, stable order. */
export function mergeAttach(input: {
  mailboxIds?: string[];
  domainIds?: string[];
  mailboxes: PoolMailbox[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of input.mailboxIds ?? []) push(id);
  for (const id of expandDomainAttach(input.domainIds ?? [], input.mailboxes)) push(id);
  return out;
}

/** Daily headroom across a pool. Used to block launch when the campaign cap cannot fit. */
export function poolCapacityToday(
  mailboxes: Array<{ status: string; dailyCap: number; sentToday: number }>,
): { eligible: number; remainingToday: number } {
  let eligible = 0;
  let remainingToday = 0;
  for (const m of mailboxes) {
    if (m.status !== "ACTIVE") continue;
    eligible += 1;
    remainingToday += Math.max(0, m.dailyCap - m.sentToday);
  }
  return { eligible, remainingToday };
}
