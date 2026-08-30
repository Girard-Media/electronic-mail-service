// Billing provider seam (Stripe Connect) — mirrors the MailProvider pattern: one
// interface, a real implementation, and a null implementation that fails closed
// when unconfigured. Payments are OPT-IN: with no STRIPE_SECRET_KEY the product
// runs exactly as before and every billing endpoint reports "not configured".
//
// Scope of this seam (intentionally narrow + safe): it lets an AGENCY connect its
// own Stripe account (Stripe Connect Standard) so it can later charge its clients.
// It performs NO charges or transfers itself — only account-connect, onboarding
// links, and status reads, plus signed-webhook verification. Charging clients is a
// deliberate later step built on top of this.

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

export interface ConnectStatus {
  /** Whether a Connect account id exists for this org. */
  connected: boolean;
  accountId: string | null;
  /** Stripe has enabled charges (onboarding fully complete). */
  chargesEnabled: boolean;
  /** Stripe has all the details it needs (else onboarding must continue). */
  detailsSubmitted: boolean;
}

export interface BillingProvider {
  readonly name: string;
  /** True only when real credentials are present. UI + routes gate on this. */
  readonly configured: boolean;
  /** Create a connected (Standard) account for an agency. Returns its Stripe id.
   * Pass idempotencyKey (e.g. per-org) so concurrent calls return the SAME account. */
  createConnectAccount(input: {
    email?: string;
    orgName?: string;
    idempotencyKey?: string;
  }): Promise<{ accountId: string }>;
  /** A one-time hosted onboarding link the agency completes at Stripe. */
  createOnboardingLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<{ url: string }>;
  /** Current onboarding/charge status for a connected account. */
  getConnectStatus(accountId: string): Promise<ConnectStatus>;
  /** Verify a Stripe webhook signature against the raw body. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
}

class BillingNotConfiguredError extends Error {
  constructor() {
    super("Payments are not configured on this instance (set STRIPE_SECRET_KEY).");
    this.name = "BillingNotConfiguredError";
  }
}

// No-op provider — the default when STRIPE_SECRET_KEY is unset. Reads report
// "not connected"; writes throw a clear, catchable error.
class NullBillingProvider implements BillingProvider {
  readonly name = "null";
  readonly configured = false;
  async createConnectAccount(): Promise<{ accountId: string }> {
    throw new BillingNotConfiguredError();
  }
  async createOnboardingLink(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async getConnectStatus(): Promise<ConnectStatus> {
    return { connected: false, accountId: null, chargesEnabled: false, detailsSubmitted: false };
  }
  verifyWebhook(): boolean {
    return false;
  }
}

// Stripe over its REST API (no SDK dependency — same fetch-based style as the
// Cloudflare/DoH integrations). x-www-form-urlencoded bodies, secret-key auth.
class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe";
  readonly configured = true;
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {}

  private async call(
    method: "GET" | "POST",
    path: string,
    form?: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(json?.error?.message || `Stripe API error (${res.status}).`);
    }
    return json;
  }

  async createConnectAccount(input: {
    email?: string;
    orgName?: string;
    idempotencyKey?: string;
  }): Promise<{ accountId: string }> {
    const form: Record<string, string> = { type: "standard" };
    if (input.email) form.email = input.email;
    if (input.orgName) form["business_profile[name]"] = input.orgName;
    // Idempotency key → concurrent/retried calls return the same account (no orphans).
    const acct = await this.call("POST", "/accounts", form, input.idempotencyKey);
    return { accountId: acct.id as string };
  }

  async createOnboardingLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<{ url: string }> {
    const link = await this.call("POST", "/account_links", {
      account: accountId,
      return_url: urls.returnUrl,
      refresh_url: urls.refreshUrl,
      type: "account_onboarding",
    });
    return { url: link.url as string };
  }

  async getConnectStatus(accountId: string): Promise<ConnectStatus> {
    const acct = await this.call("GET", `/accounts/${encodeURIComponent(accountId)}`);
    return {
      connected: true,
      accountId,
      chargesEnabled: Boolean(acct.charges_enabled),
      detailsSubmitted: Boolean(acct.details_submitted),
    };
  }

  // Stripe-Signature: "t=<ts>,v1=<sig>[,v1=<sig2>…]". v1 = HMAC-SHA256(`${t}.${rawBody}`)
  // with the endpoint's webhook secret. During a webhook-secret rotation Stripe signs
  // with every active secret and emits one v1 per secret — we collect ALL v1 values
  // and accept if ANY matches (constant-time). The timestamp must be within the past
  // 5 minutes (small future skew allowed) to reject replays.
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
    if (!this.webhookSecret || !signatureHeader) return false;
    const pairs = signatureHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const;
    });
    const t = pairs.find(([k]) => k === "t")?.[1];
    const v1s = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!t || v1s.length === 0) return false;
    const ts = Number(t);
    const age = Date.now() / 1000 - ts; // past-only window (reject future-dated t)
    if (!Number.isFinite(ts) || age > 300 || age < -5) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(`${t}.${rawBody}`).digest("hex");
    const expBuf = Buffer.from(expected);
    return v1s.some((v) => {
      if (v.length !== expected.length) return false;
      try {
        return timingSafeEqual(Buffer.from(v), expBuf);
      } catch {
        return false;
      }
    });
  }
}

let cached: BillingProvider | null = null;

/** The active billing provider — Stripe when STRIPE_SECRET_KEY is set, else a no-op.
 * Resolved once per process from env; changing STRIPE_SECRET_KEY requires a restart
 * (env is fixed at boot anyway). Tests should use makeBillingProvider() instead. */
export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  cached = env.STRIPE_SECRET_KEY
    ? new StripeBillingProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
    : new NullBillingProvider();
  return cached;
}

/** Test seam: build a provider explicitly (bypasses the env-driven singleton). */
export function makeBillingProvider(
  secretKey: string | undefined,
  webhookSecret?: string,
): BillingProvider {
  return secretKey ? new StripeBillingProvider(secretKey, webhookSecret) : new NullBillingProvider();
}
