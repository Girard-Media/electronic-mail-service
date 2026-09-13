/**
 * Inbound attribution (E16-010): link a reply to its lead, campaign, and
 * mailbox.
 *
 * The join key is our own Message-ID: every submitted SendIntent stores one
 * (see apps/workers/src/emit-intent.ts), and a reply carries it back in
 * In-Reply-To or References. Precedence is exact-header first, because a
 * sender address alone can never identify WHICH campaign a reply belongs to.
 *
 * What this module refuses to do:
 *
 *  1. Guess a campaign from the sender. A lead may sit in several campaigns;
 *     attributing their reply to the wrong one corrupts reply-rate reporting
 *     and halt-on-reply. Without an intent match, campaignId stays null.
 *  2. Trust cross-org rows. Both lookups are caller-provided so the org scope
 *     lives with the data layer; a lookup that returns a row from another org
 *     is a data-layer bug, and the contract below says so explicitly.
 */

export interface AttributionInput {
  inReplyTo: string | null | undefined;
  /** Oldest → newest, as parsed from the References header. */
  references: string[];
  /** Raw From header value. */
  from: string;
}

/** The rows attribution needs. Both lookups MUST be scoped to one orgId. */
export interface AttributionLookups {
  /** Our outbound intent with this Message-ID, or null. Org-scoped. */
  findIntentByMessageId(messageId: string): Promise<{ leadId: string; campaignId: string } | null>;
  /** Lead with this email address, or null. Org-scoped, lowercase compare. */
  findLeadByEmail(email: string): Promise<{ id: string } | null>;
}

export type AttributionVia = "in-reply-to" | "references" | "sender-email" | "none";

export interface Attribution {
  leadId: string | null;
  /** Only ever set from an intent match — never guessed from the sender. */
  campaignId: string | null;
  via: AttributionVia;
  /** Which header value produced the intent match, for debugging. */
  matchedMessageId: string | null;
}

/** "Dana Lee <dana@acme.com>" → "dana@acme.com". */
export function extractAddr(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase();
}

const NONE: Attribution = { leadId: null, campaignId: null, via: "none", matchedMessageId: null };

export async function attributeInbound(
  input: AttributionInput,
  lookups: AttributionLookups,
): Promise<Attribution> {
  const inReplyTo = input.inReplyTo?.trim();
  if (inReplyTo) {
    const hit = await lookups.findIntentByMessageId(inReplyTo);
    if (hit) {
      return { leadId: hit.leadId, campaignId: hit.campaignId, via: "in-reply-to", matchedMessageId: inReplyTo };
    }
  }

  // References is ordered oldest → newest; the nearest ancestor is ours.
  for (const ref of [...(input.references ?? [])].reverse()) {
    const id = ref.trim();
    if (!id || id === inReplyTo) continue;
    const hit = await lookups.findIntentByMessageId(id);
    if (hit) {
      return { leadId: hit.leadId, campaignId: hit.campaignId, via: "references", matchedMessageId: id };
    }
  }

  const sender = extractAddr(input.from);
  if (sender.includes("@")) {
    const lead = await lookups.findLeadByEmail(sender);
    if (lead) {
      return { leadId: lead.id, campaignId: null, via: "sender-email", matchedMessageId: null };
    }
  }

  return NONE;
}
