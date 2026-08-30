/**
 * Plans, quotas and metering (E19-006..E19-029).
 *
 * The honesty rule that governs this file: a plan may only list what it actually
 * gets. Dedicated IPs and dedicated domains are gated to the plans that really
 * receive them, and `dedicatedIp: false` is stated explicitly on the ones that
 * do not — inherited from the usermails launch audit, where claiming a dedicated
 * IP on a shared pool was the exact defect found.
 *
 * Quotas are enforced at the point of CONSUMPTION, not at billing time. A limit
 * discovered on an invoice is not a limit, it is a surprise.
 */

export type PlanId = "trial" | "starter" | "growth" | "scale" | "enterprise";

export type Metered = "sends" | "verifications" | "aiTokens";
export type Provisioned = "mailboxes" | "domains" | "seats" | "dedicatedIps";

export const UNLIMITED = -1;

export interface Plan {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  /** Provisioned ceilings. UNLIMITED (-1) only where we truly mean it. */
  mailboxes: number;
  domains: number;
  seats: number;
  dedicatedIps: number;
  /** Included metered allowance per period. */
  sends: number;
  verifications: number;
  aiTokens: number;
  /** Overage price per unit once the allowance is used. null = hard stop. */
  overageUsd: Record<Metered, number | null>;
  /** Stated plainly because the alternative is a claim we cannot keep. */
  dedicatedIp: boolean;
  sharedPool: boolean;
  placementTestsPerMonth: number;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial", name: "Trial", monthlyUsd: 0,
    mailboxes: 1, domains: 0, seats: 1, dedicatedIps: 0,
    sends: 200, verifications: 500, aiTokens: 100_000,
    overageUsd: { sends: null, verifications: null, aiTokens: null },
    // A trial runs on a warmed SHARED mailbox. It never gets a dedicated
    // resource, and the plan says so rather than implying otherwise (E19-052).
    dedicatedIp: false, sharedPool: true, placementTestsPerMonth: 2,
  },
  starter: {
    id: "starter", name: "Starter", monthlyUsd: 79,
    mailboxes: 5, domains: 2, seats: 2, dedicatedIps: 0,
    sends: 6_000, verifications: 10_000, aiTokens: 2_000_000,
    overageUsd: { sends: 0.0018, verifications: 0.0009, aiTokens: 0.0000025 },
    dedicatedIp: false, sharedPool: true, placementTestsPerMonth: 20,
  },
  growth: {
    id: "growth", name: "Growth", monthlyUsd: 249,
    mailboxes: 20, domains: 8, seats: 5, dedicatedIps: 0,
    sends: 25_000, verifications: 50_000, aiTokens: 8_000_000,
    overageUsd: { sends: 0.0015, verifications: 0.0008, aiTokens: 0.0000022 },
    dedicatedIp: false, sharedPool: true, placementTestsPerMonth: 60,
  },
  scale: {
    id: "scale", name: "Scale", monthlyUsd: 749,
    mailboxes: 75, domains: 30, seats: 15, dedicatedIps: 1,
    sends: 100_000, verifications: 200_000, aiTokens: 30_000_000,
    overageUsd: { sends: 0.0012, verifications: 0.0006, aiTokens: 0.000002 },
    // The first plan that genuinely receives one.
    dedicatedIp: true, sharedPool: false, placementTestsPerMonth: 200,
  },
  enterprise: {
    id: "enterprise", name: "Enterprise", monthlyUsd: 0, // quoted
    mailboxes: UNLIMITED, domains: UNLIMITED, seats: UNLIMITED, dedicatedIps: UNLIMITED,
    sends: UNLIMITED, verifications: UNLIMITED, aiTokens: UNLIMITED,
    overageUsd: { sends: null, verifications: null, aiTokens: null },
    dedicatedIp: true, sharedPool: false, placementTestsPerMonth: UNLIMITED,
  },
};

export function isUnlimited(n: number): boolean {
  return n === UNLIMITED;
}

export function planLimit(planId: PlanId, key: Metered | Provisioned): number {
  return PLANS[planId][key];
}

// ── Quota enforcement at the point of consumption ────────────────────────────

export type QuotaOutcome =
  | { allowed: true; remaining: number; warn: boolean }
  | { allowed: false; reason: string; limit: number; used: number };

/** Warn at 80%, not only at 100% (E19-019). */
export const WARN_AT = 0.8;

export function checkQuota(
  planId: PlanId,
  key: Metered | Provisioned,
  used: number,
  requested = 1,
): QuotaOutcome {
  const limit = planLimit(planId, key);
  if (isUnlimited(limit)) return { allowed: true, remaining: Infinity, warn: false };

  if (used + requested > limit) {
    return {
      allowed: false,
      reason: `${key} limit reached on the ${PLANS[planId].name} plan`,
      limit, used,
    };
  }
  const remaining = limit - (used + requested);
  return { allowed: true, remaining, warn: remaining <= limit * (1 - WARN_AT) };
}

/**
 * Metered dimensions may run into overage instead of stopping, when the plan
 * prices it. A running campaign is never hard-stopped mid-flight on a boundary
 * without notice (E19-020) — that is what the overage path is for.
 */
export function checkMetered(
  planId: PlanId,
  key: Metered,
  used: number,
  requested = 1,
  spendCapUsd: number | null = null,
  overageSpentUsd = 0,
): QuotaOutcome & { overage?: { units: number; costUsd: number } } {
  const base = checkQuota(planId, key, used, requested);
  if (base.allowed) return base;

  const price = PLANS[planId].overageUsd[key];
  if (price === null) return base;

  const overUnits = used + requested - planLimit(planId, key);
  const cost = overUnits * price;

  if (spendCapUsd !== null && overageSpentUsd + cost > spendCapUsd) {
    return {
      allowed: false,
      reason: `your spend cap of $${spendCapUsd.toFixed(2)} would be exceeded`,
      limit: planLimit(planId, key), used,
    };
  }
  return { allowed: true, remaining: 0, warn: true, overage: { units: overUnits, costUsd: cost } };
}

// ── What is and is not billable ──────────────────────────────────────────────

/**
 * Traffic we generate for our own operational reasons is NOT billed, but IS
 * counted toward reputation, because receivers see it either way
 * (E06-032, E10-023, E19-023). Getting this backwards would either overcharge
 * customers or blind the reputation model.
 */
export const NON_BILLABLE_SEND_KINDS = [
  "peer_warmup", "placement_probe", "canary", "seed_test", "internal_test",
] as const;
export type SendKind = "campaign" | "reply" | (typeof NON_BILLABLE_SEND_KINDS)[number];

export function isBillable(kind: SendKind): boolean {
  return !(NON_BILLABLE_SEND_KINDS as readonly string[]).includes(kind);
}

/**
 * The parameter is deliberately unused: there is no send kind that a receiver
 * sees but reputation ignores. It stays in the signature so every call site
 * states which kind it is asking about, and so the day an exception is proposed
 * it has to be argued for here rather than added silently at a call site.
 */
export function countsTowardReputation(_kind: SendKind): boolean {
  return true;
}

// ── Usage recording ──────────────────────────────────────────────────────────

export interface UsageEvent {
  orgId: string;
  dimension: Metered;
  quantity: number;
  /** A retry must never double-bill (E19-022). */
  idempotencyKey: string;
  at: Date;
}

export interface UsageLedger {
  /** Returns the events actually recorded — duplicates are dropped, not thrown. */
  record(events: UsageEvent[]): { recorded: UsageEvent[]; duplicates: string[] };
  total(orgId: string, dimension: Metered): number;
}

export function createLedger(): UsageLedger {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  const key = (o: string, d: Metered) => `${o}:${d}`;

  return {
    record(events) {
      const recorded: UsageEvent[] = [];
      const duplicates: string[] = [];
      for (const e of events) {
        if (seen.has(e.idempotencyKey)) { duplicates.push(e.idempotencyKey); continue; }
        seen.add(e.idempotencyKey);
        totals.set(key(e.orgId, e.dimension), (totals.get(key(e.orgId, e.dimension)) ?? 0) + e.quantity);
        recorded.push(e);
      }
      return { recorded, duplicates };
    },
    total(orgId, dimension) {
      return totals.get(key(orgId, dimension)) ?? 0;
    },
  };
}

// ── Plan changes ─────────────────────────────────────────────────────────────

export interface DowngradeImpact {
  allowed: boolean;
  /** Resources that exceed the target plan and need an explicit decision. */
  conflicts: Array<{ resource: Provisioned; current: number; target: number; excess: number }>;
}

/**
 * A downgrade never silently deletes resources (E19-032). It reports what would
 * conflict and requires the customer to choose which mailboxes or domains to
 * release — deleting them for someone would destroy warmed reputation they
 * spent weeks building.
 */
export function assessDowngrade(
  from: PlanId, to: PlanId,
  current: Record<Provisioned, number>,
): DowngradeImpact {
  const conflicts: DowngradeImpact["conflicts"] = [];
  for (const key of ["mailboxes", "domains", "seats", "dedicatedIps"] as const) {
    const target = planLimit(to, key);
    if (isUnlimited(target)) continue;
    const have = current[key];
    if (have > target) conflicts.push({ resource: key, current: have, target, excess: have - target });
  }
  return { allowed: conflicts.length === 0, conflicts };
}

/** Recommend the plan that matches actual usage, including downward (E19-104). */
export function recommendPlan(usage: {
  mailboxes: number; domains: number; seats: number; sends: number;
}): PlanId {
  const order: PlanId[] = ["starter", "growth", "scale"];
  for (const id of order) {
    const p = PLANS[id];
    if (usage.mailboxes <= p.mailboxes && usage.domains <= p.domains &&
        usage.seats <= p.seats && usage.sends <= p.sends) {
      return id;
    }
  }
  return "enterprise";
}

// ── Cost model ───────────────────────────────────────────────────────────────

/**
 * Cost per positive reply is the headline commercial metric (E19-046). It is
 * shown to the customer broken into its parts, because an aggregate they cannot
 * decompose is the same sin as an undecomposable deliverability score.
 */
export interface CostBreakdown {
  infrastructureUsd: number;
  verificationUsd: number;
  aiUsd: number;
  totalUsd: number;
  positiveReplies: number;
  costPerPositiveReply: number | null;
}

export function costPerPositiveReply(input: {
  infrastructureUsd: number; verificationUsd: number; aiUsd: number; positiveReplies: number;
}): CostBreakdown {
  const totalUsd = input.infrastructureUsd + input.verificationUsd + input.aiUsd;
  return {
    ...input,
    totalUsd,
    // Zero replies is not an infinite cost, it is an undefined one. Returning
    // null makes the UI say "not yet" rather than printing a fabricated number.
    costPerPositiveReply: input.positiveReplies > 0 ? totalUsd / input.positiveReplies : null,
  };
}
