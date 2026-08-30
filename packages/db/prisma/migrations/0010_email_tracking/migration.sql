-- Per-domain open/click tracking toggles (default off — never silently track
-- transactional mail). The send worker injects an open pixel / rewrites links to
-- the signed /t redirect only when the From domain has these enabled.
ALTER TABLE "Domain" ADD COLUMN "openTracking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Domain" ADD COLUMN "clickTracking" BOOLEAN NOT NULL DEFAULT false;
