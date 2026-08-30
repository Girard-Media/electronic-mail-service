/**
 * @ems/billing — the BillingProvider seam.
 *
 * Payments legally require a licensed processor, which makes Stripe the one
 * unavoidable third party. It is isolated here so a swap is one adapter, and a
 * CI rule (E19-005) fails the build if a Stripe symbol is imported elsewhere.
 */

export interface BillingProvider {
  readonly id: string;
  ensureCustomer(orgId: string, email: string): Promise<{ customerId: string }>;
  createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string }>;
  changePlan(subscriptionId: string, planId: string): Promise<void>;
  cancel(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  recordUsage(events: import("./plans.js").UsageEvent[]): Promise<void>;
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  verifyWebhook(payload: string, signature: string): Promise<{ type: string; id: string; data: unknown }>;
}

/**
 * Traffic classes that are deliberately NOT billable but ARE counted toward
 * reputation, because receivers see them (E06-032, E10-023, E19-023).
 */

export * from "./plans.js";
