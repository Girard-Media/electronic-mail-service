import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@ems/db";
import { errors, intentQueue } from "@ems/core";
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
