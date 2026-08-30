-- God Mode TOTP (encrypted secret; totpEnabledAt set only after a valid confirm).
ALTER TABLE "PlatformAdmin" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);

-- One verified sending domain per DNS name across the whole control plane.
-- Pending duplicates are allowed; the first to prove DKIM wins.
UPDATE "Domain" AS d
SET status = 'pending', "verifiedAt" = NULL
WHERE d.status = 'verified'
  AND d.id NOT IN (
    SELECT keep.id FROM (
      SELECT DISTINCT ON (name) id
      FROM "Domain"
      WHERE status = 'verified'
      ORDER BY name, "verifiedAt" ASC NULLS LAST, "createdAt" ASC
    ) AS keep
  );

CREATE UNIQUE INDEX "Domain_name_verified_key" ON "Domain" (name) WHERE status = 'verified';
