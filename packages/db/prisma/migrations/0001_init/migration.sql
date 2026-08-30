-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'developer', 'viewer');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('queued', 'scheduled', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained', 'rejected', 'opened', 'clicked', 'delivery_delayed');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('hard_bounce', 'complaint', 'manual', 'invalid');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'succeeded', 'failed', 'dead_letter');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "customDomain" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "poweredBy" BOOLEAN NOT NULL DEFAULT true,
    "parentOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'developer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "status" "DomainStatus" NOT NULL DEFAULT 'pending',
    "dkimSelector" TEXT,
    "dkimPublicKey" TEXT,
    "dkimPrivateKey" TEXT,
    "trackingDomain" TEXT,
    "dnsRecords" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "rateLimitRps" INTEGER NOT NULL DEFAULT 10,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domainId" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "bcc" TEXT[],
    "replyTo" TEXT[],
    "subject" TEXT NOT NULL,
    "html" TEXT,
    "text" TEXT,
    "headers" JSONB,
    "tags" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "period" TEXT NOT NULL,
    "sends" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "bounced" INTEGER NOT NULL DEFAULT 0,
    "complained" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_customDomain_key" ON "Organization"("customDomain");

-- CreateIndex
CREATE INDEX "Organization_parentOrgId_idx" ON "Organization"("parentOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_slug_key" ON "Project"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_projectId_name_key" ON "Domain"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_projectId_idx" ON "ApiKey"("projectId");

-- CreateIndex
CREATE INDEX "Email_projectId_status_createdAt_idx" ON "Email"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Email_providerMessageId_idx" ON "Email"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_projectId_idempotencyKey_key" ON "Email"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailEvent_emailId_occurredAt_idx" ON "EmailEvent"("emailId", "occurredAt");

-- CreateIndex
CREATE INDEX "Suppression_projectId_idx" ON "Suppression"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_projectId_address_key" ON "Suppression"("projectId", "address");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_projectId_idx" ON "WebhookEndpoint"("projectId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_status_idx" ON "WebhookDelivery"("endpointId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_orgId_projectId_period_key" ON "UsageRecord"("orgId", "projectId", "period");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

