-- White-label tenant subdomain (tenant.electronicmailservices.com → branded surface in apps/web).
-- Nullable + unique; reserved/invalid labels are rejected at assignment + by proxy.ts.
ALTER TABLE "Organization" ADD COLUMN "subdomain" TEXT;
CREATE UNIQUE INDEX "Organization_subdomain_key" ON "Organization"("subdomain");
