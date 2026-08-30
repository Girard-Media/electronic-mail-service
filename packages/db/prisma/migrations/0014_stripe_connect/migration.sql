-- Stripe Connect: an agency's connected (Standard) account id, used to charge its
-- clients. Null until the agency completes Connect onboarding. See packages/core/billing.ts.
ALTER TABLE "Organization" ADD COLUMN "stripeConnectAccountId" TEXT;
