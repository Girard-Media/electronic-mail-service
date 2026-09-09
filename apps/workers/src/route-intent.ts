/**
 * E15-031d — load the campaign mailbox pool and pass it into route().
 * Stops at ROUTED / DEFERRED. Emit (SMTP) is a later stage.
 */

import { connection, type IntentJobData } from "@ems/core";
import { prisma } from "@ems/db";
import {
  route,
  loadCampaignPool,
  applyRouteResult,
  defaultFilterContext,
  capsForCandidate,
  type RouteRequest,
} from "@ems/router";

export async function routeIntent(job: IntentJobData): Promise<{ state: string; mailboxId: string | null }> {
  const intent = await prisma.sendIntent.findUnique({
    where: { id: job.intentId },
    include: { lead: { select: { email: true, companyDomain: true } }, campaign: true },
  });
  if (!intent) {
    console.warn(`[intent] ${job.intentId} not found — skipping`);
    return { state: "missing", mailboxId: null };
  }
  if (intent.state !== "PENDING" && intent.state !== "DEFERRED") {
    return { state: intent.state, mailboxId: intent.mailboxId };
  }

  const at = new Date();
  const pool = await loadCampaignPool(intent.campaignId, intent.orgId, at);
  if (!pool) {
    await prisma.sendIntent.update({
      where: { id: intent.id },
      data: {
        state: "DEFERRED",
        deferReason: "no-candidates",
        deferUntil: new Date(at.getTime() + 60_000),
        deferCount: { increment: 1 },
        lastError: "campaign pool missing",
      },
    });
    return { state: "DEFERRED", mailboxId: null };
  }

  const recipientEmail = intent.lead.email.toLowerCase();
  const recipientDomain =
    intent.lead.companyDomain?.toLowerCase() ?? recipientEmail.split("@")[1] ?? "";

  const req: RouteRequest = {
    intentId: intent.id,
    orgId: intent.orgId,
    campaignId: intent.campaignId,
    recipientEmail,
    recipientDomain,
    esp: "generic",
    pool: pool.campaign.domainPool,
    mailboxIds: pool.mailboxIds ?? undefined,
    jurisdiction: "US",
    at,
  };

  const byId = new Map(pool.mailboxes.map((m) => [m.row.id, m.row]));
  const result = await route(req, {
    candidates: pool.mailboxes.map((m) => m.candidate),
    filterContext: defaultFilterContext({
      at,
      pool: req.pool,
      mailboxIds: pool.mailboxIds,
      esp: req.esp,
      recipientDomain,
    }),
    buckets: connection,
    capsFor: (c) => {
      const row = byId.get(c.mailboxId);
      if (!row) throw new Error(`candidate ${c.mailboxId} missing from pool load`);
      return capsForCandidate(row);
    },
    deferCount: intent.deferCount,
  });

  const patch = applyRouteResult(result, intent.deferCount);
  await prisma.sendIntent.update({
    where: { id: intent.id },
    data: {
      state: patch.state,
      mailboxId: patch.mailboxId,
      routedAt: patch.routedAt,
      routeScore: patch.routeScore,
      routeTrace: patch.routeTrace as object,
      deferUntil: patch.deferUntil,
      deferReason: patch.deferReason,
      deferCount: patch.deferCount,
      lastError: null,
    },
  });

  if (patch.state === "ROUTED" && patch.mailboxId) {
    await prisma.fleetMailbox.update({
      where: { id: patch.mailboxId },
      data: { lastSendAt: at },
    });
  }

  return { state: patch.state, mailboxId: patch.mailboxId };
}
