import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@ems/db";
import { errors, intentQueue } from "@ems/core";
import { isDeceptiveFirstTouch } from "@ems/sequence";
import { enrolLeads } from "../lib/enrol.js";
import {
  mergeAttach,
  poolCapacityToday,
  isAttachableStatus,
  decideLaunch,
  isLaunchableStatus,
  loadCampaignPool,
  type PoolMailbox,
} from "@ems/router";
import type { SessionVars } from "../middleware/session.js";

/**
 * Campaign CRUD + mailbox-pool attach (D17).
 * Mounted at /app/campaigns. Writes require email:send via dashWriteGuard.
 */
export const campaigns = new Hono<{ Variables: SessionVars }>();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dailyCap: z.number().int().min(1).max(100_000).optional(),
  domainPool: z.string().trim().min(1).max(64).optional(),
});

const attachSchema = z.object({
  mailboxIds: z.array(z.string().min(1)).optional(),
  domainIds: z.array(z.string().min(1)).optional(),
});

async function campaignOfOrg(orgId: string, id: string) {
  const row = await prisma.campaign.findFirst({ where: { id, orgId } });
  if (!row) throw errors.notFound("Campaign not found.");
  return row;
}

function poolView(
  rows: Array<{
    mailboxId: string;
    attachedAt: Date;
    mailbox: {
      id: string;
      address: string;
      displayName: string;
      status: string;
      dailyCap: number;
      domainId: string;
      lastSendAt: Date | null;
      domain: { name: string };
    };
  }>,
) {
  return rows.map((r) => ({
    mailboxId: r.mailboxId,
    address: r.mailbox.address,
    displayName: r.mailbox.displayName,
    status: r.mailbox.status,
    domainId: r.mailbox.domainId,
    domain: r.mailbox.domain.name,
    dailyCap: r.mailbox.dailyCap,
    lastSendAt: r.mailbox.lastSendAt,
    attachedAt: r.attachedAt,
  }));
}

campaigns.get("/", async (c) => {
  const orgId = c.get("orgId");
  const rows = await prisma.campaign.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { mailboxes: true, enrollments: true } } },
  });
  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      dailyCap: r.dailyCap,
      domainPool: r.domainPool,
      mailboxCount: r._count.mailboxes,
      enrollmentCount: r._count.enrollments,
      createdAt: r.createdAt,
    })),
  });
});

campaigns.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("A campaign name is required.");
  const orgId = c.get("orgId");
  const projectId = c.get("projectId");
  const row = await prisma.campaign.create({
    data: {
      orgId,
      projectId,
      name: parsed.data.name,
      dailyCap: parsed.data.dailyCap ?? 200,
      domainPool: parsed.data.domainPool ?? "default",
    },
  });
  return c.json({ data: { id: row.id, name: row.name, status: row.status } }, 201);
});

campaigns.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.campaign.findFirst({
    where: { id: c.req.param("id"), orgId },
    include: {
      mailboxes: {
        include: { mailbox: { include: { domain: { select: { name: true } } } } },
      },
    },
  });
  if (!row) throw errors.notFound("Campaign not found.");
  const loaded = await loadCampaignPool(row.id, orgId);
  const cap = poolCapacityToday(
    (loaded?.mailboxes ?? []).map((m) => ({
      status: m.status,
      dailyCap: m.dailyCap,
      sentToday: m.sentToday,
    })),
  );
  return c.json({
    data: {
      id: row.id,
      name: row.name,
      status: row.status,
      dailyCap: row.dailyCap,
      domainPool: row.domainPool,
      pool: poolView(row.mailboxes),
      capacity: cap,
      createdAt: row.createdAt,
    },
  });
});

campaigns.post("/:id/launch", async (c) => {
  const orgId = c.get("orgId");
  const loaded = await loadCampaignPool(c.req.param("id"), orgId);
  if (!loaded) throw errors.notFound("Campaign not found.");
  if (!isLaunchableStatus(loaded.campaign.status)) {
    throw errors.conflict(
      "not_launchable",
      `Campaign is ${loaded.campaign.status} and cannot launch.`,
    );
  }
  const decision = decideLaunch(
    loaded.campaign.dailyCap,
    loaded.mailboxes.map((m) => ({
      status: m.status,
      dailyCap: m.dailyCap,
      sentToday: m.sentToday,
    })),
  );
  if (!decision.ok) {
    throw errors.conflict(decision.code, decision.message);
  }

  const updated = await prisma.campaign.update({
    where: { id: loaded.campaign.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const due = await prisma.sendIntent.findMany({
    where: {
      campaignId: updated.id,
      state: { in: ["PENDING", "DEFERRED"] },
      dueAt: { lte: new Date() },
    },
    select: { id: true },
    take: 500,
  });
  if (due.length > 0) {
    await intentQueue.addBulk(
      due.map((i) => ({ name: "route", data: { intentId: i.id }, opts: { jobId: `intent-${i.id}` } })),
    );
  }

  return c.json({
    data: {
      id: updated.id,
      status: updated.status,
      startedAt: updated.startedAt,
      capacity: decision.capacity,
      queuedIntents: due.length,
    },
  });
});

campaigns.put("/:id/mailboxes", async (c) => {
  const orgId = c.get("orgId");
  const campaign = await campaignOfOrg(orgId, c.req.param("id"));
  const parsed = attachSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("mailboxIds or domainIds is required.");
  const mailboxIds = parsed.data.mailboxIds ?? [];
  const domainIds = parsed.data.domainIds ?? [];
  if (mailboxIds.length === 0 && domainIds.length === 0) {
    throw errors.validation("mailboxIds or domainIds is required.");
  }

  const fleet = await prisma.fleetMailbox.findMany({
    where: { orgId },
    select: { id: true, domainId: true, status: true },
  });
  const byId = new Map(fleet.map((m) => [m.id, m]));
  const ids = mergeAttach({
    mailboxIds,
    domainIds,
    mailboxes: fleet as PoolMailbox[],
  });
  if (ids.length === 0) {
    throw errors.validation("None of those domains have attachable mailboxes.");
  }
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) throw errors.notFound("Mailbox not found in this workspace.");
    if (!isAttachableStatus(m.status)) {
      throw errors.validation(`Mailbox ${id} is ${m.status} and cannot join a campaign pool.`);
    }
  }

  await prisma.$transaction([
    prisma.campaignMailbox.deleteMany({ where: { campaignId: campaign.id } }),
    prisma.campaignMailbox.createMany({
      data: ids.map((mailboxId) => ({ campaignId: campaign.id, mailboxId })),
    }),
  ]);

  const attached = await prisma.campaignMailbox.findMany({
    where: { campaignId: campaign.id },
    include: { mailbox: { include: { domain: { select: { name: true } } } } },
  });
  return c.json({ data: { id: campaign.id, pool: poolView(attached) } });
});

campaigns.delete("/:id/mailboxes/:mailboxId", async (c) => {
  const orgId = c.get("orgId");
  const campaign = await campaignOfOrg(orgId, c.req.param("id"));
  await prisma.campaignMailbox.deleteMany({
    where: { campaignId: campaign.id, mailboxId: c.req.param("mailboxId") },
  });
  return c.json({ ok: true });
});

campaigns.post("/:id/steps", async (c) => {
  const campaign = await campaignOfOrg(c.get("orgId"), c.req.param("id"));
  const parsed = z.object({
    subject: z.string().trim().min(1).max(200),
    bodyText: z.string().trim().min(1).max(20_000),
    bodyHtml: z.string().max(80_000).optional(),
    delayDays: z.number().int().min(0).max(60).optional(),
    delayHours: z.number().int().min(0).max(23).optional(),
    isFirstTouch: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("subject and bodyText are required.");
  const last = await prisma.sequenceStep.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (last?.position ?? -1) + 1;
  const isFirstTouch = parsed.data.isFirstTouch ?? position === 0;
  if (isDeceptiveFirstTouch(parsed.data.subject, isFirstTouch)) {
    throw errors.validation("A first-touch step cannot use a RE:/FW: subject.");
  }
  const step = await prisma.sequenceStep.create({
    data: {
      campaignId: campaign.id,
      position,
      delayDays: parsed.data.delayDays ?? 0,
      delayHours: parsed.data.delayHours ?? 0,
      isFirstTouch,
      variants: {
        create: {
          label: "A",
          subject: parsed.data.subject,
          bodyText: parsed.data.bodyText,
          bodyHtml: parsed.data.bodyHtml ?? null,
          weight: 1,
        },
      },
    },
    include: { variants: true },
  });
  return c.json({ data: step }, 201);
});

campaigns.post("/:id/enroll", async (c) => {
  const campaign = await campaignOfOrg(c.get("orgId"), c.req.param("id"));
  const parsed = z.object({
    leadIds: z.array(z.string().min(1)).max(500).optional(),
    listId: z.string().min(1).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("leadIds or listId is required.");
  let leadIds = parsed.data.leadIds ?? [];
  if (parsed.data.listId) {
    const members = await prisma.leadListMembership.findMany({
      where: { listId: parsed.data.listId, list: { orgId: c.get("orgId") } },
      select: { leadId: true },
    });
    leadIds = [...new Set([...leadIds, ...members.map((m) => m.leadId)])];
  }
  if (leadIds.length === 0) throw errors.validation("leadIds or listId is required.");
  const result = await enrolLeads({
    orgId: c.get("orgId"),
    projectId: c.get("projectId"),
    campaignId: campaign.id,
    leadIds,
  });
  return c.json({ data: result });
});

campaigns.get("/:id/enrollments", async (c) => {
  const campaign = await campaignOfOrg(c.get("orgId"), c.req.param("id"));
  const rows = await prisma.campaignLead.findMany({
    where: { campaignId: campaign.id },
    orderBy: { enrolledAt: "desc" },
    take: 200,
    include: { lead: { select: { id: true, email: true, status: true } } },
  });
  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      state: r.state,
      currentStep: r.currentStep,
      nextDueAt: r.nextDueAt,
      stoppedReason: r.stoppedReason,
      leadId: r.lead.id,
      email: r.lead.email,
      leadStatus: r.lead.status,
    })),
  });
});
