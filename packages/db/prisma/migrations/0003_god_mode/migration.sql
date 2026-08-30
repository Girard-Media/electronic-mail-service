-- God Mode: platform-level admin (orthogonal to tenant org roles) + audit log.

CREATE TYPE "PlatformRole" AS ENUM ('superadmin', 'admin');

CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'admin',
    "scopes" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");

ALTER TABLE "PlatformAdmin"
    ADD CONSTRAINT "PlatformAdmin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX "PlatformAuditLog_actorUserId_idx" ON "PlatformAuditLog"("actorUserId");
