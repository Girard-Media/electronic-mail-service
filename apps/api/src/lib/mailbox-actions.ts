import { errors } from "@ems/core";
import { prisma } from "@ems/db";
import { enqueueEmail } from "./send.js";

// Shared mailbox actions used by the dashboard (session-auth) and the public
// /inboxes API (key-auth): compose from a mailbox, and reply to a stored
// message. One implementation so threading headers, sent-folder copies, and
// the active-mailbox gate cannot drift between the two surfaces.

const snippetOf = (text?: string | null, html?: string | null) =>
  (text || (html ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

export async function sendFromMailbox(
  projectId: string,
  mailboxId: string,
  input: { to: string; subject: string; text?: string; html?: string },
): Promise<{ emailId: string; messageId: string }> {
  const mb = await prisma.mailbox.findFirst({
    where: { id: mailboxId, projectId },
    select: { id: true, address: true, displayName: true, status: true },
  });
  if (!mb) throw errors.notFound("Mailbox not found.");
  if (mb.status !== "active") throw errors.validation("This mailbox isn't active.");
  const from = mb.displayName ? `${mb.displayName} <${mb.address}>` : mb.address;
  const to = input.to.toLowerCase();
  const { id: emailId } = await enqueueEmail(
    projectId,
    {
      from,
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    } as Parameters<typeof enqueueEmail>[1],
    null,
  );
  const sent = await prisma.message.create({
    data: {
      mailboxId: mb.id,
      fromAddr: mb.address,
      toAddrs: [to],
      subject: input.subject,
      snippet: snippetOf(input.text, input.html),
      text: input.text ?? null,
      html: input.html ?? null,
      seen: true,
      folder: "sent",
    },
    select: { id: true },
  });
  return { emailId, messageId: sent.id };
}

export async function replyToMessage(
  projectId: string,
  messageId: string,
  input: { text?: string; html?: string },
): Promise<{ emailId: string; messageId: string; threadId: string }> {
  const orig = await prisma.message.findFirst({
    where: { id: messageId, mailbox: { projectId } },
    select: {
      id: true, messageId: true, threadId: true, subject: true, fromAddr: true, mailboxId: true,
      mailbox: { select: { address: true, displayName: true, status: true } },
    },
  });
  if (!orig) throw errors.notFound("Message not found.");
  if (orig.mailbox.status !== "active") throw errors.validation("This mailbox isn't active.");
  // The recipient comes from the original (inbound) From header — validate it's a
  // real address before sending (we bypass the send schema here).
  const toAddr = (orig.fromAddr.match(/<([^>]+)>/)?.[1] ?? orig.fromAddr).trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(toAddr)) {
    throw errors.validation("Can't reply — the original sender's address is invalid.");
  }
  const from = orig.mailbox.displayName
    ? `${orig.mailbox.displayName} <${orig.mailbox.address}>`
    : orig.mailbox.address;
  const subject = `Re: ${(orig.subject || "").replace(/^(re:\s*)+/i, "")}`.trim();
  const threadId = orig.threadId ?? orig.id;
  const ref = orig.messageId ? `<${orig.messageId.replace(/^<|>$/g, "")}>` : null;
  const headers = ref ? { "In-Reply-To": ref, References: ref } : undefined;
  const { id: emailId } = await enqueueEmail(
    projectId,
    {
      from,
      to: toAddr,
      subject,
      html: input.html,
      text: input.text,
      headers,
    } as Parameters<typeof enqueueEmail>[1],
    null,
  );
  const sent = await prisma.message.create({
    data: {
      mailboxId: orig.mailboxId,
      fromAddr: orig.mailbox.address,
      toAddrs: [toAddr],
      subject,
      snippet: snippetOf(input.text, input.html),
      text: input.text ?? null,
      html: input.html ?? null,
      threadId,
      inReplyTo: orig.messageId,
      seen: true,
      folder: "sent",
    },
    select: { id: true },
  });
  // Backfill the original's threadId so the conversation links up.
  if (!orig.threadId) {
    await prisma.message.update({ where: { id: orig.id }, data: { threadId } }).catch(() => {});
  }
  return { emailId, messageId: sent.id, threadId };
}
