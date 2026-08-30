-- Pending team invites. One row per outstanding invite (orgId+email unique);
-- accepted invites keep the row with acceptedAt set, revoked invites are deleted.
-- The emailed link carries a stateless HMAC token (packages/core/invites.ts).
CREATE TABLE "Invite" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "role"        "Role" NOT NULL DEFAULT 'developer',
  "invitedById" TEXT,
  "acceptedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_orgId_email_key" ON "Invite" ("orgId", "email");
CREATE INDEX "Invite_orgId_idx" ON "Invite" ("orgId");

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
