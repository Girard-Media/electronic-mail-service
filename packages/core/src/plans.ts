// One typed source of truth for what each plan includes. The server enforces
// these (the dashboard's checks are UX only). Numeric limits use -1 = unlimited.
// Plan ids match the prices in god.ts (BUSINESS_MODEL): free/pro/scale/
// white-label/enterprise. Tune the numbers as pricing firms up.

export interface PlanLimits {
  sendingDomains: number;
  teamSeats: number;
  monthlySends: number;
  webhookEndpoints: number;
  // Hosted inboxes (shared agent-domain + custom-domain mailboxes), org-wide.
  // The Workspace-replacement + agent wedge — capped so shared-domain address
  // squatting can't run away on the free tier.
  mailboxes: number;
  customDomain: boolean;
  customBranding: boolean;
  dedicatedIp: boolean;
  // Agency / reseller sub-accounts (child orgs under parentOrgId) — the white-label tier.
  subAccounts: boolean;
}

export const UNLIMITED = -1;

/** Plan granted to orgs owned by God Mode platform admins — unlimited everything. */
export const OPERATOR_PLAN = "enterprise";

const FREE: PlanLimits = {
  sendingDomains: 1, teamSeats: 1, monthlySends: 3_000, webhookEndpoints: 1, mailboxes: 3,
  customDomain: false, customBranding: false, dedicatedIp: false, subAccounts: false,
};

export const PLANS: Record<string, PlanLimits> = {
  free: FREE,
  pro: {
    sendingDomains: 10, teamSeats: 3, monthlySends: 50_000, webhookEndpoints: 10,
    mailboxes: 25,
    customDomain: false, customBranding: false, dedicatedIp: false, subAccounts: false,
  },
  scale: {
    sendingDomains: 50, teamSeats: 10, monthlySends: 500_000, webhookEndpoints: 50,
    mailboxes: 250,
    customDomain: true, customBranding: true, dedicatedIp: false, subAccounts: false,
  },
  "white-label": {
    sendingDomains: UNLIMITED, teamSeats: UNLIMITED, monthlySends: 5_000_000,
    webhookEndpoints: UNLIMITED, mailboxes: UNLIMITED, customDomain: true,
    customBranding: true, dedicatedIp: false, subAccounts: true,
  },
  enterprise: {
    sendingDomains: UNLIMITED, teamSeats: UNLIMITED, monthlySends: UNLIMITED,
    webhookEndpoints: UNLIMITED, mailboxes: UNLIMITED, customDomain: true,
    customBranding: true, dedicatedIp: false, subAccounts: true,
  },
};

export const PLAN_IDS = Object.keys(PLANS);

/** Canonical plan id: case-insensitive, "whitelabel" → "white-label", unknown → "free". */
export function normalizePlanId(plan: string | null | undefined): string {
  const key = (plan ?? "free").toLowerCase().trim();
  const normalized = key === "whitelabel" ? "white-label" : key;
  return Object.prototype.hasOwnProperty.call(PLANS, normalized) ? normalized : "free";
}

/** True when this org is a God Mode operator's own top-level workspace. */
export function isOperatorWorkspace(
  parentOrgId: string | null | undefined,
  ownerIsPlatformAdmin: boolean,
): boolean {
  return parentOrgId == null && ownerIsPlatformAdmin;
}

/**
 * Plan id this org should run under. Operator-owned top-level workspaces are
 * always enterprise — even if the stored row is still the signup default (free).
 * Sub-accounts keep whatever plan they were given.
 */
export function effectivePlanId(
  storedPlan: string | null | undefined,
  opts: { parentOrgId?: string | null; ownerIsPlatformAdmin?: boolean } = {},
): string {
  if (isOperatorWorkspace(opts.parentOrgId, Boolean(opts.ownerIsPlatformAdmin))) {
    return OPERATOR_PLAN;
  }
  return normalizePlanId(storedPlan);
}

/** Resolve a plan id to its limits; unknown → free. */
export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[normalizePlanId(plan)] ?? FREE;
}

export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

/** True if one more unit is allowed given the current count. */
export function withinLimit(current: number, limit: number): boolean {
  return isUnlimited(limit) || current < limit;
}

// ---------- Pricing (list price + metered overage) — single source of truth ----------
// From BUSINESS_MODEL.md. Both the agency billing rollup and the God-Mode
// profitability view read these. Charging itself (Stripe) isn't wired yet; this is
// the math invoices are built on. Included sends = the plan's ENFORCED monthly cap
// (planLimits.monthlySends), so a bill can never diverge from what the server meters.
// NOTE: these enforced caps are authoritative for billing; BUSINESS_MODEL.md's
// advertised volumes currently differ (free 5k/pro 60k/scale 150k + a scale 1M+
// tier) — reconcile the spec to these numbers (or vice versa) before going live.

export interface PlanPricing {
  /** Base monthly list price (USD). */
  monthlyUsd: number;
  /** Metered overage beyond included sends (USD per 1,000). 0 = none: hard-capped (free), unlimited, or custom. */
  overagePer1kUsd: number;
  /** Enterprise = quote/contract, not list-priced. */
  custom: boolean;
}

const PLAN_PRICING_MAP: Record<string, PlanPricing> = {
  free: { monthlyUsd: 0, overagePer1kUsd: 0, custom: false },
  pro: { monthlyUsd: 18, overagePer1kUsd: 0.7, custom: false },
  scale: { monthlyUsd: 80, overagePer1kUsd: 0.55, custom: false },
  "white-label": { monthlyUsd: 400, overagePer1kUsd: 0.3, custom: false },
  enterprise: { monthlyUsd: 0, overagePer1kUsd: 0, custom: true },
};

/** Dedicated-IP add-on (USD per month). */
export const DEDICATED_IP_USD = 20;

/** Resolve a plan id to its pricing (same normalization as planLimits); unknown → free. */
export function planPricing(plan: string | null | undefined): PlanPricing {
  return PLAN_PRICING_MAP[normalizePlanId(plan)] ?? PLAN_PRICING_MAP.free!;
}

export interface BillLine {
  plan: string;
  custom: boolean;
  monthlyUsd: number;
  includedSends: number; // -1 = unlimited
  usedSends: number;
  overageSends: number;
  overageUsd: number;
  totalUsd: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * One period's bill for a plan given its metered send count. Free (hard cap),
 * unlimited, and custom (enterprise) plans accrue no metered overage. Money values
 * are rounded to cents.
 */
export function computeBill(plan: string | null | undefined, usedSends: number): BillLine {
  const id = normalizePlanId(plan);
  const pricing = planPricing(id);
  const included = planLimits(id).monthlySends;
  // Clamp garbage/negative/non-finite input to 0 so a bad caller yields a $0 line,
  // never a NaN/Infinity that JSON.stringify would silently emit as null.
  const sends = Number.isFinite(usedSends) ? Math.max(0, Math.floor(usedSends)) : 0;
  const noOverage = isUnlimited(included) || pricing.overagePer1kUsd <= 0;
  const overageSends = noOverage ? 0 : Math.max(0, sends - included);
  const overageUsd = round2((overageSends / 1000) * pricing.overagePer1kUsd);
  return {
    plan: id,
    custom: pricing.custom,
    monthlyUsd: pricing.monthlyUsd,
    includedSends: included,
    usedSends: sends,
    overageSends,
    overageUsd,
    totalUsd: round2(pricing.monthlyUsd + overageUsd),
  };
}
