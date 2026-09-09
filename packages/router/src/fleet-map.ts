/**
 * Map a fleet row into a router Candidate. Pure — the loader owns Prisma.
 */

import type { Candidate, FilterContext } from "./candidates.js";
import type { BucketInputs } from "./buckets.js";

export interface FleetCandidateRow {
  id: string;
  domainId: string;
  nodeId: string;
  ipId: string;
  mailboxStatus: string;
  domainStatus: string;
  ipStatus: string;
  nodeStatus: string;
  nodeRole: string;
  nodeVerified: boolean;
  pool: string;
  domainVerified: boolean;
  domainAgeReadyAt: Date | null;
  warmupHoldAt: Date | null;
  mailboxDailyCap: number;
  mailboxSentToday: number;
  reputationScore: number;
  warmupDay: number;
  lastSendAt: Date | null;
  domainDailyCap: number;
  ipHourlyCap: number;
}

export function toCandidate(row: FleetCandidateRow): Candidate {
  return {
    mailboxId: row.id,
    domainId: row.domainId,
    ipId: row.ipId,
    nodeId: row.nodeId,
    mailboxStatus: row.mailboxStatus,
    domainStatus: row.domainStatus,
    ipStatus: row.ipStatus,
    nodeStatus: row.nodeStatus,
    nodeRole: row.nodeRole,
    nodeVerified: row.nodeVerified,
    pool: row.pool,
    domainVerified: row.domainVerified,
    domainAgeReadyAt: row.domainAgeReadyAt,
    warmupHoldAt: row.warmupHoldAt,
    mailboxDailyCap: row.mailboxDailyCap,
    mailboxSentToday: row.mailboxSentToday,
    reputationScore: row.reputationScore,
    espAffinity: {},
    warmupDay: row.warmupDay,
    riskPenalty: 0,
    lastSendToRecipientDomainAt: null,
    lastSendAt: row.lastSendAt,
  };
}

/** Remaining caps for the token-bucket claim. Daily remaining, not the ceiling. */
export function capsForCandidate(row: FleetCandidateRow): Omit<BucketInputs, "at" | "esp"> {
  const remaining = Math.max(0, row.mailboxDailyCap - row.mailboxSentToday);
  return {
    mailboxId: row.id,
    domainId: row.domainId,
    ipId: row.ipId,
    mailboxDailyCap: remaining,
    mailboxHourlyCap: Math.max(1, Math.ceil(row.mailboxDailyCap / 8)),
    domainDailyCap: row.domainDailyCap,
    ipHourlyCap: row.ipHourlyCap,
    espQuarterCap: Math.max(1, Math.ceil(row.ipHourlyCap / 4)),
  };
}

export function defaultFilterContext(input: {
  at: Date;
  pool: string;
  mailboxIds: string[] | null;
  esp: FilterContext["esp"];
  recipientDomain: string;
}): FilterContext {
  return {
    at: input.at,
    pool: input.pool,
    mailboxIds: input.mailboxIds && input.mailboxIds.length > 0 ? new Set(input.mailboxIds) : null,
    esp: input.esp,
    recipientDomain: input.recipientDomain,
    allowedDomainIds: null,
    recipientDomainCooldownMs: 72 * 3600_000,
    recipientDomainFanoutCap: 50,
    recipientDomainFanoutUsed: 0,
    intendedVolume: 1,
  };
}
