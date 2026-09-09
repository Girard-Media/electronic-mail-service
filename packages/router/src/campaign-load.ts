/**
 * Load the live candidate set for a campaign (E15-031d).
 *
 * Attached CampaignMailbox rows win. An empty join falls back to every
 * org mailbox whose sending IP sits in Campaign.domainPool.
 */

import { prisma } from "@ems/db";
import { utcDayStart } from "./launch.js";
import { toCandidate, type FleetCandidateRow } from "./fleet-map.js";
import type { Candidate } from "./candidates.js";

export interface LoadedPoolMailbox {
  row: FleetCandidateRow;
  candidate: Candidate;
  address: string;
  domainName: string;
  status: string;
  dailyCap: number;
  sentToday: number;
}

export interface LoadedCampaignPool {
  campaign: {
    id: string;
    orgId: string;
    name: string;
    status: string;
    dailyCap: number;
    domainPool: string;
  };
  /** Null when falling back to the named pool. */
  mailboxIds: string[] | null;
  mailboxes: LoadedPoolMailbox[];
}

async function sentTodayByMailbox(mailboxIds: string[], now: Date): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (mailboxIds.length === 0) return counts;
  const day = utcDayStart(now);
  const rows = await prisma.sendIntent.groupBy({
    by: ["mailboxId"],
    where: {
      mailboxId: { in: mailboxIds },
      OR: [
        { state: "ROUTED", routedAt: { gte: day } },
        { state: { in: ["SUBMITTED", "DELIVERED"] }, submittedAt: { gte: day } },
      ],
    },
    _count: { _all: true },
  });
  for (const r of rows) {
    if (r.mailboxId) counts.set(r.mailboxId, r._count._all);
  }
  return counts;
}

function toRow(
  m: {
    id: string;
    status: string;
    dailyCap: number;
    warmupDay: number;
    warmupHoldAt: Date | null;
    healthScore: number;
    lastSendAt: Date | null;
    domainId: string;
    nodeId: string;
    domain: {
      name: string;
      status: string;
      spfOk: boolean;
      dkimOk: boolean;
      dmarcOk: boolean;
      ageReadyAt: Date | null;
      dailyCap: number;
      ip: { id: string; status: string; pool: string; hourlyCap: number } | null;
    };
    node: {
      status: string;
      role: string;
      relayTestOk: boolean;
      dkimTestOk: boolean;
      egress25Ok: boolean;
    };
  },
  sentToday: number,
): FleetCandidateRow | null {
  if (!m.domain.ip) return null;
  return {
    id: m.id,
    domainId: m.domainId,
    nodeId: m.nodeId,
    ipId: m.domain.ip.id,
    mailboxStatus: m.status,
    domainStatus: m.domain.status,
    ipStatus: m.domain.ip.status,
    nodeStatus: m.node.status,
    nodeRole: m.node.role,
    nodeVerified: m.node.relayTestOk && m.node.dkimTestOk && m.node.egress25Ok,
    pool: m.domain.ip.pool,
    domainVerified: m.domain.spfOk && m.domain.dkimOk && m.domain.dmarcOk,
    domainAgeReadyAt: m.domain.ageReadyAt,
    warmupHoldAt: m.warmupHoldAt,
    mailboxDailyCap: m.dailyCap,
    mailboxSentToday: sentToday,
    reputationScore: m.healthScore,
    warmupDay: m.warmupDay,
    lastSendAt: m.lastSendAt,
    domainDailyCap: m.domain.dailyCap,
    ipHourlyCap: m.domain.ip.hourlyCap,
  };
}

export async function loadCampaignPool(
  campaignId: string,
  orgId: string,
  now: Date = new Date(),
): Promise<LoadedCampaignPool | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, orgId },
    include: { mailboxes: { select: { mailboxId: true } } },
  });
  if (!campaign) return null;

  const attached = campaign.mailboxes.map((m) => m.mailboxId);
  const mailboxIds = attached.length > 0 ? attached : null;

  const fleet = await prisma.fleetMailbox.findMany({
    where: mailboxIds
      ? { orgId, id: { in: mailboxIds } }
      : { orgId, domain: { ip: { pool: campaign.domainPool } } },
    include: {
      domain: { include: { ip: true } },
      node: true,
    },
  });

  const sent = await sentTodayByMailbox(fleet.map((m) => m.id), now);
  const mailboxes: LoadedPoolMailbox[] = [];
  for (const m of fleet) {
    const sentToday = sent.get(m.id) ?? 0;
    const row = toRow(m, sentToday);
    if (!row) continue;
    mailboxes.push({
      row,
      candidate: toCandidate(row),
      address: m.address,
      domainName: m.domain.name,
      status: m.status,
      dailyCap: m.dailyCap,
      sentToday,
    });
  }

  return {
    campaign: {
      id: campaign.id,
      orgId: campaign.orgId,
      name: campaign.name,
      status: campaign.status,
      dailyCap: campaign.dailyCap,
      domainPool: campaign.domainPool,
    },
    mailboxIds,
    mailboxes,
  };
}
