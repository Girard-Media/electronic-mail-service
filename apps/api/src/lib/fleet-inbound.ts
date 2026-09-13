import { prisma } from "@ems/db";
import { parseInboundMessage } from "@ems/providers";
import {
  attributeInbound,
  extractAddr,
  normalizeSubject,
  resolveThread,
  type ThreadIndex,
} from "@ems/inbox";

/**
 * Fleet inbound ingest (E16-010): store a reply arriving at a campaign
 * mailbox and link its thread to the lead, campaign, and mailbox.
 *
 * Join order for the linkage is SendIntent.messageId ↔ In-Reply-To first,
 * References second, sender email last — and the sender fallback yields a
 * lead but never a campaign (see @ems/inbox attribution.ts).
 *
 * Thread selection reuses the tested resolveThread precedence over a
 * pre-fetched in-memory index (resolveThread is synchronous by design, so
 * the DB reads happen up front in three bounded queries). A reply that
 * matches nothing opens a NEW thread rather than merging on a weak signal
 * (E16-009). Unknown recipient → drop ({ stored: 0 }) so the MTA never
 * generates a bounce.
 */
export async function handleFleetInbound(
  raw: string,
  rcptHeader: string,
): Promise<{
  stored: number;
  threadId: string | null;
  leadId: string | null;
  campaignId: string | null;
  via: string;
  newThread: boolean;
}> {
  const empty = { stored: 0, threadId: null, leadId: null, campaignId: null, via: "none", newThread: false };
  const recipient = rcptHeader.trim().toLowerCase();
  if (!raw || !recipient.includes("@")) return empty;

  const mailbox = await prisma.fleetMailbox.findFirst({
    where: { address: { equals: recipient, mode: "insensitive" } },
    select: { id: true, orgId: true, address: true },
  });
  if (!mailbox || !mailbox.orgId) return empty;
  const orgId = mailbox.orgId;

  const m = parseInboundMessage(raw);
  const receivedAt = new Date();
  const headerIds = [m.inReplyTo ?? "", ...m.references].map((s) => s.trim()).filter(Boolean);

  const attribution = await attributeInbound(
    { inReplyTo: m.inReplyTo, references: m.references, from: m.from },
    {
      findIntentByMessageId: async (messageId) => {
        const intent = await prisma.sendIntent.findUnique({
          where: { messageId },
          select: { orgId: true, leadId: true, campaignId: true },
        });
        if (!intent || intent.orgId !== orgId) return null;
        return { leadId: intent.leadId, campaignId: intent.campaignId };
      },
      findLeadByEmail: async (email) => {
        const lead = await prisma.lead.findFirst({
          where: { orgId, email },
          select: { id: true },
        });
        return lead ? { id: lead.id } : null;
      },
    },
  );

  // Pre-fetch everything resolveThread may ask for.
  const [msgs, intents, openThreads] = await Promise.all([
    headerIds.length
      ? prisma.inboxMessage.findMany({
          where: { messageId: { in: headerIds }, thread: { orgId } },
          select: { messageId: true, threadId: true },
        })
      : Promise.resolve([]),
    headerIds.length
      ? prisma.sendIntent.findMany({
          where: { messageId: { in: headerIds }, orgId },
          select: { messageId: true, leadId: true, campaignId: true },
        })
      : Promise.resolve([]),
    prisma.inboxThread.findMany({
      where: { orgId, mailboxId: mailbox.id, state: "OPEN" },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      include: { lead: { select: { email: true } } },
    }),
  ]);

  const threadByMessageId = new Map(msgs.map((r) => [r.messageId as string, r.threadId]));
  // Our own outbound id rejoins the still-open thread already attributed to
  // that lead + campaign on this mailbox — the same conversation continuing.
  const openByTriple = new Map(
    openThreads.map((t) => [`${t.leadId}␟${t.campaignId}`, t.id]),
  );
  for (const intent of intents) {
    if (intent.messageId && !threadByMessageId.has(intent.messageId)) {
      const tid = openByTriple.get(`${intent.leadId}␟${intent.campaignId}`);
      if (tid) threadByMessageId.set(intent.messageId, tid);
    }
  }

  const index: ThreadIndex = {
    byMessageId: (id) => threadByMessageId.get(id) ?? null,
    bySubject: (normalized) =>
      openThreads
        .filter((t) => normalizeSubject(t.subject) === normalized)
        .map((t) => ({
          threadId: t.id,
          participants: [t.lead?.email ?? "", mailbox.address].filter(Boolean),
          lastMessageAt: t.lastMessageAt,
        })),
  };

  const match = resolveThread(
    {
      messageId: m.messageId ?? null,
      inReplyTo: m.inReplyTo ?? null,
      references: m.references,
      subject: m.subject,
      from: m.from,
      to: [recipient],
      receivedAt,
    },
    index,
  );

  let threadId: string;
  let newThread = false;
  if (match.kind === "new") {
    const thread = await prisma.inboxThread.create({
      data: {
        orgId,
        mailboxId: mailbox.id,
        leadId: attribution.leadId,
        campaignId: attribution.campaignId,
        subject: m.subject || "(no subject)",
        lastMessageAt: receivedAt,
      },
      select: { id: true },
    });
    threadId = thread.id;
    newThread = true;
  } else {
    threadId = match.threadId;
    await prisma.inboxThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: receivedAt,
        // A later reply may attribute where the first could not (e.g. the
        // first arrived without headers and only matched by sender). Fill
        // gaps, never overwrite a linked row with a weaker signal.
        ...(attribution.leadId ? { leadId: attribution.leadId } : {}),
        ...(attribution.campaignId ? { campaignId: attribution.campaignId } : {}),
      },
    });
  }

  await prisma.inboxMessage.create({
    data: {
      threadId,
      direction: "inbound",
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      fromAddress: extractAddr(m.from) || m.from.slice(0, 320),
      toAddress: recipient,
      subject: m.subject || null,
      bodyText: m.text ?? null,
      bodyHtml: m.html ?? null,
    },
  });

  return {
    stored: 1,
    threadId,
    leadId: attribution.leadId,
    campaignId: attribution.campaignId,
    via: attribution.via,
    newThread,
  };
}
