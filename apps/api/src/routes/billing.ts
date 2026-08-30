import { Hono } from "hono";
import { prisma } from "@ems/db";
import { env, errors, ApiError, can, getBillingProvider, isOrgRole, type OrgRole } from "@ems/core";
import { sessionAuth, type SessionVars } from "../middleware/session.js";

// Billing routes (Stripe Connect). Two surfaces:
//  - `billing` (session-authed, mounted at /app/billing): an agency reads its
//    Connect status and starts onboarding to charge its clients.
//  - `billingHooks` (public, mounted at /billing): Stripe's signed webhook.
// Everything fails closed when STRIPE_SECRET_KEY is unset (provider.configured=false).

async function actorRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const m = await prisma.membership.findFirst({ where: { orgId, userId }, select: { role: true } });
  return m && isOrgRole(m.role) ? m.role : null;
}

export const billing = new Hono<{ Variables: SessionVars }>();
billing.use("*", sessionAuth);

// GET /app/billing/connect — the active org's payment-connection status.
billing.get("/connect", async (c) => {
  const orgId = c.get("orgId");
  const role = await actorRole(orgId, c.get("userId"));
  if (!can(role, "subaccount:manage")) {
    throw errors.forbidden("Only an owner or admin can view billing settings.");
  }
  // Only an owner may actually connect a payout account (billing:write).
  const canManage = can(role, "billing:write");
  const provider = getBillingProvider();
  if (!provider.configured) {
    return c.json({ configured: false, connected: false, canManage });
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeConnectAccountId: true },
  });
  if (!org?.stripeConnectAccountId) {
    return c.json({ configured: true, connected: false, accountId: null, chargesEnabled: false, detailsSubmitted: false, canManage });
  }
  const status = await provider.getConnectStatus(org.stripeConnectAccountId).catch(() => null);
  if (!status) {
    return c.json({
      configured: true,
      connected: true,
      accountId: org.stripeConnectAccountId,
      chargesEnabled: false,
      detailsSubmitted: false,
      error: "Could not reach Stripe.",
      canManage,
    });
  }
  return c.json({ configured: true, ...status, canManage });
});

// POST /app/billing/connect — begin (or resume) Connect onboarding. Owner-only,
// since connecting a payout account is a billing action. Returns a hosted URL the
// agency completes at Stripe; no charge or transfer happens here.
billing.post("/connect", async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Payment connection isn't available during an impersonation session.");
  }
  const orgId = c.get("orgId");
  const role = await actorRole(orgId, c.get("userId"));
  if (!can(role, "billing:write")) {
    throw errors.forbidden("Only an owner can connect a payment account.");
  }
  const provider = getBillingProvider();
  if (!provider.configured) {
    throw errors.validation("Payments aren't configured on this instance yet.");
  }
  const [org, user] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, stripeConnectAccountId: true } }),
    prisma.user.findUnique({ where: { id: c.get("userId") }, select: { email: true } }),
  ]);
  // Redirect targets must come from our OWN configured origin, never the inbound
  // Host header — otherwise a spoofed Host could send the owner to a phishing page
  // mid-payout-setup. The dashboard is served by this API, so API_URL is the origin.
  const origin = new URL(env.API_URL).origin;
  try {
    let accountId = org?.stripeConnectAccountId ?? null;
    if (!accountId) {
      // Per-org idempotency key → a concurrent/retried connect returns the SAME
      // Stripe account (no orphaned duplicates from a TOCTOU race).
      const created = await provider.createConnectAccount({
        email: user?.email ?? undefined,
        orgName: org?.name ?? undefined,
        idempotencyKey: `connect-acct-${orgId}`,
      });
      accountId = created.accountId;
      // Persist only if still empty; if a concurrent request won, keep the stored id
      // (idempotency guarantees it's the same account).
      await prisma.organization.updateMany({
        where: { id: orgId, stripeConnectAccountId: null },
        data: { stripeConnectAccountId: accountId },
      });
      const fresh = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeConnectAccountId: true },
      });
      accountId = fresh?.stripeConnectAccountId ?? accountId;
    }
    const link = await provider.createOnboardingLink(accountId, {
      returnUrl: `${origin}/dashboard?billing=connected`,
      refreshUrl: `${origin}/dashboard?billing=refresh`,
    });
    return c.json({ url: link.url });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Don't leak Stripe/internal detail (or the key) — surface a clean 502.
    throw new ApiError(502, "billing_provider_error", "Couldn't set up payments with Stripe — please try again.");
  }
});

// Public Stripe webhook. Verifies the signature against the RAW body before doing
// anything; an unverified or unconfigured call is rejected. Status is read live on
// demand, so handling is minimal today (ack + a hook point for future events).
export const billingHooks = new Hono();
billingHooks.post("/webhook", async (c) => {
  const provider = getBillingProvider();
  const raw = await c.req.text();
  const sig = c.req.header("stripe-signature") ?? null;
  if (!provider.verifyWebhook(raw, sig)) {
    return c.json({ error: "invalid_signature" }, 400);
  }
  let event: { type?: string; data?: { object?: { id?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_payload" }, 400);
  }
  // Future: react to account.updated / payout / charge events here. Connect status
  // is fetched live on read, so no action is required to stay correct today.
  void event.type;
  return c.json({ received: true });
});
