import { Prisma, prisma } from "@ems/db";
import { parseInboundMessage } from "@ems/providers";
import {
  errors,
  inboundDisposition,
  forwardDestinations,
  stripSubAddress,
  webhookQueue,
} from "@ems/core";
import { enqueueEmail } from "./send.js";

export async function handleMailboxInbound(
  raw: string,
  rcptHeader: string,
): Promise<{ stored: number; forwarded: number }> {
  const address = stripSubAddress(rcptHeader);
  if (!raw || !address.includes("@")) return { stored: 0, forwarded: 0 };
  const domainName = address.split("@")[1] ?? "";

  const include = {
    forwards: { select: { destination: true, verifiedAt: true } },
  } as const;

  let mailbox = await prisma.mailbox.findFirst({
    where: { address, status: "active" },
    include,
  });
  if (!mailbox) {
    mailbox = await prisma.mailbox.findFirst({
      where: { status: "active", catchAll: true, domain: { name: domainName } },
      include,
    });
  }
  if (!mailbox) return { stored: 0, forwarded: 0 };

  const m = parseInboundMessage(raw);
  const size = Buffer.byteLength(raw, "utf8");
  const dests = forwardDestinations(mailbox.address, mailbox.forwards);
  const disp = inboundDisposition({
    keepCopy: mailbox.keepCopy,
    verifiedForwardCount: dests.length,
    usedBytes: Number(mailbox.usedBytes),
    quotaBytes: Number(mailbox.quotaBytes),
    sizeBytes: size,
  });
  if (disp.overQuota) throw errors.mailboxFull();

  if (disp.store) {
    let threadId: string | null = null;
    if (m.inReplyTo) {
      const parent = await prisma.message.findFirst({
        where: { mailboxId: mailbox.id, messageId: m.inReplyTo },
        select: { id: true, threadId: true },
      });
      if (parent) {
        threadId = parent.threadId ?? parent.id;
        if (!parent.threadId) {
          await prisma.message.update({ where: { id: parent.id }, data: { threadId } }).catch(() => {});
        }
      }
    }
    await prisma.message.create({
      data: {
        mailboxId: mailbox.id,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo,
        threadId,
        fromAddr: m.from,
        toAddrs: m.to,
        subject: m.subject,
        snippet: m.snippet,
        text: m.text,
        html: m.html,
        sizeBytes: size,
        folder: "inbox",
      },
    });
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { usedBytes: { increment: BigInt(size) } },
    });
    await fanInInboundWebhook(mailbox.projectId, address, m).catch((e) => {
      console.error("[mta/inbound] webhook fan-out failed (non-fatal):", e);
    });
  }

  let forwarded = 0;
  if (disp.forward) {
    const from = mailbox.displayName
      ? `${mailbox.displayName} <${mailbox.address}>`
      : mailbox.address;
    const originalFrom = (m.from.match(/<([^>]+)>/)?.[1] ?? m.from).trim();
    for (const dest of dests) {
      try {
        await enqueueEmail(
          mailbox.projectId,
          {
            from,
            to: dest,
            reply_to: originalFrom || undefined,
            subject: m.subject || "(no subject)",
            text: m.text || m.snippet || "(empty message)",
            html: m.html,
            headers: {
              "Auto-Submitted": "auto-forwarded",
              "X-Original-From": m.from.slice(0, 200),
              ...(m.messageId ? { "X-Original-Message-Id": m.messageId } : {}),
            },
          } as Parameters<typeof enqueueEmail>[1],
          null,
        );
        forwarded++;
      } catch (e) {
        console.error("[mta/inbound] forward failed (non-fatal):", dest, e);
      }
    }
  }

  return { stored: disp.store ? 1 : 0, forwarded };
}

async function fanInInboundWebhook(
  projectId: string,
  address: string,
  m: ReturnType<typeof parseInboundMessage>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { projectId, enabled: true },
  });
  for (const ep of endpoints) {
    if (ep.eventTypes.length && !ep.eventTypes.includes("email.inbound")) continue;
    const eventBody = {
      type: "email.inbound",
      created_at: new Date().toISOString(),
      data: {
        mailbox: address,
        to: m.to,
        from: m.from,
        subject: m.subject,
        text: m.text?.slice(0, 500_000),
        html: m.html?.slice(0, 1_000_000),
        snippet: m.snippet,
        message_id: m.messageId,
        in_reply_to: m.inReplyTo,
      },
    };
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        eventType: "email.inbound",
        payload: eventBody as Prisma.InputJsonValue,
      },
    });
    await webhookQueue.add("deliver", { deliveryId: delivery.id }, {
      attempts: 6,
      backoff: { type: "exponential", delay: 5000 },
    });
  }
}
