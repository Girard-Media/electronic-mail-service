-- CreateEnum
CREATE TYPE "SendProvider" AS ENUM ('mta', 'google', 'microsoft');

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('active', 'expired', 'revoked', 'error');

-- AlterTable: neutralize the vendor-region default (white-label) + backfill existing rows.
ALTER TABLE "Domain" ALTER COLUMN "region" SET DEFAULT 'primary';
UPDATE "Domain" SET "region" = 'primary' WHERE "region" = 'us-east-1';

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "connectedAccountId" TEXT,
ADD COLUMN     "routedVia" "SendProvider" NOT NULL DEFAULT 'mta';

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "SendProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectedAccount_projectId_idx" ON "ConnectedAccount"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_projectId_email_key" ON "ConnectedAccount"("projectId", "email");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
