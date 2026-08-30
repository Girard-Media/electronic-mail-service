-- Org-scoped audit log (reseller compliance, FR-081). One row per privileged
-- action an agency member takes on a client sub-account — opening (switching into)
-- a child org, or creating one. Scoped to the agency "orgId"; "targetId" is the
-- child org. Distinct from "PlatformAuditLog", which is platform-admin scoped.
CREATE TABLE "OrgAuditLog" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrgAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgAuditLog_orgId_createdAt_idx" ON "OrgAuditLog" ("orgId", "createdAt");

ALTER TABLE "OrgAuditLog"
  ADD CONSTRAINT "OrgAuditLog_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
