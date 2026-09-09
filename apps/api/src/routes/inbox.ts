import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@ems/db";
import { errors } from "@ems/core";
import { haltLeadAcrossCampaigns, haltTargetForIntent } from "../lib/halt.js";
import type { SessionVars } from "../middleware/session.js";

/**
 * Unified inbox across fleet mailboxes (E16-034..036).
 * Filters: campaign, domain, mailbox, intent. Default sort: newest first.
 */
export const inbox = new Hono<{ Variables: SessionVars }>();

const INTENTS = new Set([
  "INTERESTED",
  "NOT_INTERESTED",
  "OUT_OF_OFFICE",
  "REFERRAL",
  "UNSUBSCRIBE",
  "AUTO_REPLY",
  "BOUNCE",
  "OTHER",
]);

inbox.get("/threads", async (c) => {
  const orgId = c.get("orgId");
  const campaignId = c.req.query("campaignId") || undefined;
  const mailboxId = c.req.query("mailboxId") || undefined;
  const domainId = c.req.query("domainId") || undefined;
  const intent = c.req.query("intent") || undefined;
  if (intent && !INTENTS.has(intent)) throw errors.validation("Unknown intent.");

  const take = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40) || 40));

  const mailboxFilter: { id?: string; domainId?: string } = {};
  if (mailboxId) mailboxFilter.id = mailboxId;
  if (domainId) mailboxFilter.domainId = domainId;

  const threads = await prisma.inboxThread.findMany({
    where: {
      orgId,
      ...(campaignId ? { campaignId } : {}),
      ...(intent ? { intent: intent as never } : {}),
      ...(mailboxId || domainId ? { mailbox: mailboxFilter } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take,
    include: {
      mailbox: { select: { id: true, address: true, domainId: true } },
      lead: { select: { id: true, email: true } },
    },
  });

  return c.json({
    data: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      state: t.state,
      intent: t.intent,
      intentConfidence: t.intentConfidence,
      campaignId: t.campaignId,
      mailboxId: t.mailbox.id,
      mailbox: t.mailbox.address,
      domainId: t.mailbox.domainId,
      leadId: t.lead?.id ?? null,
      leadEmail: t.lead?.email ?? null,
      lastMessageAt: t.lastMessageAt,
    })),
  });
});

inbox.post("/threads/:id/outcome", async (c) => {
  const orgId = c.get("orgId");
  const parsed = z.object({
    intent: z.enum([
      "INTERESTED",
      "NOT_INTERESTED",
      "OUT_OF_OFFICE",
      "REFERRAL",
      "UNSUBSCRIBE",
      "AUTO_REPLY",
      "BOUNCE",
      "OTHER",
    ]),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("intent is required.");
  const thread = await prisma.inboxThread.findFirst({
    where: { id: c.req.param("id"), orgId },
  });
  if (!thread) throw errors.notFound("Thread not found.");
  await prisma.inboxThread.update({
    where: { id: thread.id },
    data: { intent: parsed.data.intent, intentCorrectedTo: parsed.data.intent },
  });
  const haltTo = haltTargetForIntent(parsed.data.intent);
  let halt = { halted: 0, cancelledIntents: 0 };
  if (haltTo && thread.leadId) {
    halt = await haltLeadAcrossCampaigns({
      orgId,
      leadId: thread.leadId,
      to: haltTo,
      reason: `inbox:${parsed.data.intent}`,
    });
  }
  return c.json({ data: { threadId: thread.id, intent: parsed.data.intent, halt } });
});
