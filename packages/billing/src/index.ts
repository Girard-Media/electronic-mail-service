/**
 * @ems/billing — the BillingProvider seam.
 *
 * Payments legally require a licensed processor, which makes Stripe the one
 * unavoidable third party. It is isolated here so a swap is one adapter, and a
 * CI rule (E19-005) fails the build if a Stripe symbol is imported elsewhere.
 */

export type MeteredDimension = "sends" | "verifications" | "ai_tokens" | "mailboxes" | "domains" | "seats";

export interface UsageEvent {
  orgId: string;
  dimension: MeteredDimension;
  quantity: number;
  /** Idempotency key — a retry must never double-bill (E19-022). */
  idempotencyKey: string;
  at: Date;
}

export interface BillingProvider {
  readonly id: string;
  ensureCustomer(orgId: string, email: string): Promise<{ customerId: string }>;
  createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string }>;
  changePlan(subscriptionId: string, planId: string): Promise<void>;
  cancel(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  recordUsage(events: UsageEvent[]): Promise<void>;
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  verifyWebhook(payload: string, signature: string): Promise<{ type: string; id: string; data: unknown }>;
}

/**
 * Traffic classes that are deliberately NOT billable but ARE counted toward
 * reputation, because receivers see them (E06-032, E10-023, E19-023).
 */
export const NON_BILLABLE_SEND_KINDS = ["peer_warmup", "placement_probe", "canary"] as const;
export type NonBillableSendKind = (typeof NON_BILLABLE_SEND_KINDS)[number];

export function isBillableSend(kind: string): boolean {
  return !(NON_BILLABLE_SEND_KINDS as readonly string[]).includes(kind);
}
