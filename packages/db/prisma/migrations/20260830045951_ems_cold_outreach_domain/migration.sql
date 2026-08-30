-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('PROVISIONING', 'VERIFYING', 'ACTIVE', 'DRAINING', 'QUARANTINED', 'RETIRED');

-- CreateEnum
CREATE TYPE "NodeRole" AS ENUM ('CAMPAIGN', 'VERIFY', 'WARMUP', 'INBOUND');

-- CreateEnum
CREATE TYPE "IpStatus" AS ENUM ('NEW', 'WARMING', 'ACTIVE', 'THROTTLED', 'QUARANTINED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FleetDomainStatus" AS ENUM ('REGISTERED', 'DNS_PENDING', 'AGING', 'WARMING', 'ACTIVE', 'PAUSED', 'RETIRING', 'RETIRED', 'BURNED');

-- CreateEnum
CREATE TYPE "DmarcPolicy" AS ENUM ('none', 'quarantine', 'reject');

-- CreateEnum
CREATE TYPE "FleetMailboxStatus" AS ENUM ('CREATED', 'WARMING', 'ACTIVE', 'PAUSED', 'DRAINING', 'RETIRED', 'BURNED');

-- CreateEnum
CREATE TYPE "ReputationSubject" AS ENUM ('IP', 'DOMAIN', 'MAILBOX', 'CONTENT', 'ENGAGEMENT');

-- CreateEnum
CREATE TYPE "BounceClass" AS ENUM ('HARD', 'SOFT', 'BLOCK_REPUTATION', 'BLOCK_CONTENT', 'BLOCK_RATE', 'MAILBOX_FULL', 'POLICY', 'AUTH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SeedProvider" AS ENUM ('GMAIL', 'OUTLOOK', 'YAHOO', 'ZOHO', 'PROTON', 'ICLOUD', 'AOL', 'GMX', 'CORPORATE');

-- CreateEnum
CREATE TYPE "PlacementFolder" AS ENUM ('PRIMARY', 'PROMOTIONS', 'UPDATES', 'SOCIAL', 'SPAM', 'MISSING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'VERIFIED', 'RISKY', 'INVALID', 'ENROLLED', 'CONTACTED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadListStatus" AS ENUM ('IMPORTING', 'NEEDS_REVIEW', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerifyStatus" AS ENUM ('VALID', 'INVALID', 'CATCH_ALL', 'ROLE', 'DISPOSABLE', 'TRAP_SUSPECT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConsentBasis" AS ENUM ('LEGITIMATE_INTEREST', 'IMPLIED_B2B', 'EXPRESS_OPT_IN', 'PUBLISHED_ADDRESS', 'EXISTING_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'ALLOW_WITH_BASIS', 'BLOCK');

-- CreateEnum
CREATE TYPE "GlobalSuppressionReason" AS ENUM ('COMPLAINT', 'SPAM_TRAP', 'ABUSE_REPORT', 'LEGAL_DEMAND', 'INTERNAL', 'GOV_MIL', 'COMPETITOR', 'HARD_BOUNCE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'RUNNING', 'PAUSED', 'AUTO_PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentState" AS ENUM ('PENDING', 'ACTIVE', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'COMPLETED', 'STOPPED', 'BLOCKED_BY_POLICY');

-- CreateEnum
CREATE TYPE "IntentState" AS ENUM ('PENDING', 'BLOCKED', 'DEFERRED', 'ROUTED', 'SUBMITTED', 'DELIVERED', 'BOUNCED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ThreadState" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'REFERRAL', 'UNSUBSCRIBE', 'AUTO_REPLY', 'BOUNCE', 'OTHER');

-- CreateTable
CREATE TABLE "BlastNode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "privateIp" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'hostinger',
    "region" TEXT,
    "role" "NodeRole" NOT NULL DEFAULT 'CAMPAIGN',
    "status" "NodeStatus" NOT NULL DEFAULT 'PROVISIONING',
    "maxHourly" INTEGER NOT NULL DEFAULT 500,
    "agentVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "healthJson" JSONB,
    "relayTestOk" BOOLEAN NOT NULL DEFAULT false,
    "dkimTestOk" BOOLEAN NOT NULL DEFAULT false,
    "egress25Ok" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "drainedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlastNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingIp" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ptr" TEXT,
    "ptrConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "IpStatus" NOT NULL DEFAULT 'NEW',
    "pool" TEXT NOT NULL DEFAULT 'default',
    "warmupDay" INTEGER NOT NULL DEFAULT 0,
    "hourlyCap" INTEGER NOT NULL DEFAULT 50,
    "diligenceJson" JSONB,
    "firstSendAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "quarantineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingIp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDomain" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "ipId" TEXT,
    "name" TEXT NOT NULL,
    "status" "FleetDomainStatus" NOT NULL DEFAULT 'REGISTERED',
    "registrar" TEXT,
    "registeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "ageReadyAt" TIMESTAMP(3),
    "retireAfter" TIMESTAMP(3),
    "dkimSelector" TEXT NOT NULL DEFAULT 'ems',
    "dkimPublicKey" TEXT,
    "dkimPrivateEnc" TEXT,
    "spfOk" BOOLEAN NOT NULL DEFAULT false,
    "dkimOk" BOOLEAN NOT NULL DEFAULT false,
    "dmarcOk" BOOLEAN NOT NULL DEFAULT false,
    "dmarcPolicy" "DmarcPolicy" NOT NULL DEFAULT 'none',
    "tlsRptOk" BOOLEAN NOT NULL DEFAULT false,
    "mxOk" BOOLEAN NOT NULL DEFAULT false,
    "lastDnsCheckAt" TIMESTAMP(3),
    "dnsIssues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "siteUrl" TEXT,
    "siteLiveOk" BOOLEAN NOT NULL DEFAULT false,
    "postalAddress" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "companyName" TEXT NOT NULL,
    "postalAddress" TEXT NOT NULL,
    "signatureHtml" TEXT,
    "signatureText" TEXT,
    "linkedinUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetMailbox" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "domainId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "personaId" TEXT,
    "localPart" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "FleetMailboxStatus" NOT NULL DEFAULT 'CREATED',
    "warmupPlanId" TEXT,
    "warmupDay" INTEGER NOT NULL DEFAULT 0,
    "warmupHoldAt" TIMESTAMP(3),
    "dailyCap" INTEGER NOT NULL DEFAULT 5,
    "hardCap" INTEGER NOT NULL DEFAULT 50,
    "hourlyCap" INTEGER NOT NULL DEFAULT 3,
    "peerWarmup" BOOLEAN NOT NULL DEFAULT true,
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sent7d" INTEGER NOT NULL DEFAULT 0,
    "bounced7d" INTEGER NOT NULL DEFAULT 0,
    "deferred7d" INTEGER NOT NULL DEFAULT 0,
    "complaints7d" INTEGER NOT NULL DEFAULT 0,
    "replies7d" INTEGER NOT NULL DEFAULT 0,
    "lastSendAt" TIMESTAMP(3),
    "drainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startPerDay" INTEGER NOT NULL DEFAULT 5,
    "incrementWeek" INTEGER NOT NULL DEFAULT 5,
    "plateau" INTEGER NOT NULL DEFAULT 40,
    "minDomainAgeDays" INTEGER NOT NULL DEFAULT 14,
    "maxBounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "maxDeferRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "maxComplaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0.001,
    "weekdayOnly" BOOLEAN NOT NULL DEFAULT true,
    "jitterPct" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReputationSnapshot" (
    "id" TEXT NOT NULL,
    "subject" "ReputationSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReputationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistCheck" (
    "id" TEXT NOT NULL,
    "ipId" TEXT,
    "domainId" TEXT,
    "provider" TEXT NOT NULL,
    "listed" BOOLEAN NOT NULL,
    "responseIp" TEXT,
    "reason" TEXT,
    "delistUrl" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "BlacklistCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BounceRule" (
    "id" TEXT NOT NULL,
    "espFamily" TEXT NOT NULL,
    "smtpCode" INTEGER,
    "enhancedCode" TEXT,
    "matchSubstr" TEXT,
    "classify" "BounceClass" NOT NULL,
    "suppress" BOOLEAN NOT NULL DEFAULT false,
    "backoffMin" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BounceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmarcReport" (
    "id" TEXT NOT NULL,
    "domainId" TEXT,
    "orgName" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "dateBegin" TIMESTAMP(3) NOT NULL,
    "dateEnd" TIMESTAMP(3) NOT NULL,
    "rawObjectKey" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmarcReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TlsRptReport" (
    "id" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "dateBegin" TIMESTAMP(3) NOT NULL,
    "dateEnd" TIMESTAMP(3) NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "failureDetails" JSONB,
    "rawObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TlsRptReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedAccount" (
    "id" TEXT NOT NULL,
    "provider" "SeedProvider" NOT NULL,
    "address" TEXT NOT NULL,
    "credsEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementTest" (
    "id" TEXT NOT NULL,
    "domainId" TEXT,
    "campaignId" TEXT,
    "subject" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementResult" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "seedAccountId" TEXT NOT NULL,
    "folder" "PlacementFolder" NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "headersJson" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "linkedinUrl" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "countrySource" TEXT,
    "countryConfidence" DOUBLE PRECISION,
    "timezone" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "verifyResultId" TEXT,
    "fitScore" DOUBLE PRECISION,
    "fitReason" TEXT,
    "customFields" JSONB,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LeadListStatus" NOT NULL DEFAULT 'IMPORTING',
    "sourceType" TEXT,
    "sourceDetail" TEXT,
    "attestedByUserId" TEXT,
    "attestedAt" TIMESTAMP(3),
    "attestationIp" TEXT,
    "complianceReportKey" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sendableCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadListMembership" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadListMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "VerifyStatus" NOT NULL,
    "syntaxOk" BOOLEAN NOT NULL DEFAULT false,
    "domainOk" BOOLEAN NOT NULL DEFAULT false,
    "mxOk" BOOLEAN NOT NULL DEFAULT false,
    "smtpOk" BOOLEAN,
    "catchAll" BOOLEAN NOT NULL DEFAULT false,
    "disposable" BOOLEAN NOT NULL DEFAULT false,
    "role" BOOLEAN NOT NULL DEFAULT false,
    "trapScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "smtpResponse" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "basis" "ConsentBasis" NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceKey" TEXT,
    "liaJson" JSONB,
    "attestedByUserId" TEXT,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attestationIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionPolicy" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "outcome" "PolicyOutcome" NOT NULL,
    "allowedBases" "ConsentBasis"[],
    "citation" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "JurisdictionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "intentId" TEXT,
    "leadId" TEXT,
    "campaignId" TEXT,
    "jurisdiction" TEXT,
    "jurisdictionSource" TEXT,
    "jurisdictionConfidence" DOUBLE PRECISION,
    "consentBasis" "ConsentBasis",
    "consentRecordId" TEXT,
    "suppressionChecks" JSONB,
    "contentScore" DOUBLE PRECISION,
    "policyVersion" INTEGER,
    "decision" "PolicyOutcome" NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalSuppression" (
    "id" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "address" TEXT,
    "domain" TEXT,
    "reason" "GlobalSuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sendWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "sendWindowEnd" TEXT NOT NULL DEFAULT '17:00',
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "respectHolidays" BOOLEAN NOT NULL DEFAULT true,
    "timezoneMode" TEXT NOT NULL DEFAULT 'lead',
    "fixedTimezone" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 200,
    "domainPool" TEXT NOT NULL DEFAULT 'default',
    "trackOpens" BOOLEAN NOT NULL DEFAULT false,
    "trackClicks" BOOLEAN NOT NULL DEFAULT false,
    "maxBounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "maxComplaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0.001,
    "autoPausedAt" TIMESTAMP(3),
    "autoPauseReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB,
    "isFirstTouch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepVariant" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'A',
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "aiTaskId" TEXT,
    "aiPromptVersion" TEXT,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "state" "EnrollmentState" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextDueAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendIntent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "variantId" TEXT,
    "leadId" TEXT NOT NULL,
    "state" "IntentState" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "mailboxId" TEXT,
    "routedAt" TIMESTAMP(3),
    "routeScore" DOUBLE PRECISION,
    "routeTrace" JSONB,
    "deferUntil" TIMESTAMP(3),
    "deferReason" TEXT,
    "deferCount" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "smtpResponse" TEXT,
    "bounceClass" "BounceClass",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "leadId" TEXT,
    "campaignId" TEXT,
    "subject" TEXT NOT NULL,
    "state" "ThreadState" NOT NULL DEFAULT 'OPEN',
    "intent" "ReplyIntent",
    "intentConfidence" DOUBLE PRECISION,
    "intentCorrectedTo" "ReplyIntent",
    "assignedToUserId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "rawObjectKey" TEXT,
    "headersJson" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'usermails',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "response" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoffEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskConfig" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "fallbackChain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 1024,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "promptVersion" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cacheTtlSec" INTEGER NOT NULL DEFAULT 86400,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "taskId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "schemaValid" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlastNode_name_key" ON "BlastNode"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BlastNode_hostname_key" ON "BlastNode"("hostname");

-- CreateIndex
CREATE INDEX "BlastNode_status_role_idx" ON "BlastNode"("status", "role");

-- CreateIndex
CREATE INDEX "BlastNode_orgId_idx" ON "BlastNode"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingIp_address_key" ON "SendingIp"("address");

-- CreateIndex
CREATE INDEX "SendingIp_status_pool_idx" ON "SendingIp"("status", "pool");

-- CreateIndex
CREATE INDEX "SendingIp_nodeId_idx" ON "SendingIp"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetDomain_name_key" ON "FleetDomain"("name");

-- CreateIndex
CREATE INDEX "FleetDomain_status_idx" ON "FleetDomain"("status");

-- CreateIndex
CREATE INDEX "FleetDomain_orgId_idx" ON "FleetDomain"("orgId");

-- CreateIndex
CREATE INDEX "FleetDomain_ipId_idx" ON "FleetDomain"("ipId");

-- CreateIndex
CREATE INDEX "Persona_orgId_idx" ON "Persona"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetMailbox_address_key" ON "FleetMailbox"("address");

-- CreateIndex
CREATE INDEX "FleetMailbox_status_healthScore_idx" ON "FleetMailbox"("status", "healthScore");

-- CreateIndex
CREATE INDEX "FleetMailbox_domainId_idx" ON "FleetMailbox"("domainId");

-- CreateIndex
CREATE INDEX "FleetMailbox_nodeId_idx" ON "FleetMailbox"("nodeId");

-- CreateIndex
CREATE INDEX "FleetMailbox_orgId_idx" ON "FleetMailbox"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "WarmupPlan_name_key" ON "WarmupPlan"("name");

-- CreateIndex
CREATE INDEX "ReputationSnapshot_subject_subjectId_windowEnd_idx" ON "ReputationSnapshot"("subject", "subjectId", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ReputationSnapshot_subject_subjectId_windowEnd_key" ON "ReputationSnapshot"("subject", "subjectId", "windowEnd");

-- CreateIndex
CREATE INDEX "BlacklistCheck_ipId_provider_checkedAt_idx" ON "BlacklistCheck"("ipId", "provider", "checkedAt");

-- CreateIndex
CREATE INDEX "BlacklistCheck_domainId_provider_checkedAt_idx" ON "BlacklistCheck"("domainId", "provider", "checkedAt");

-- CreateIndex
CREATE INDEX "BlacklistCheck_listed_checkedAt_idx" ON "BlacklistCheck"("listed", "checkedAt");

-- CreateIndex
CREATE INDEX "BounceRule_espFamily_smtpCode_priority_idx" ON "BounceRule"("espFamily", "smtpCode", "priority");

-- CreateIndex
CREATE INDEX "DmarcReport_domainId_dateBegin_idx" ON "DmarcReport"("domainId", "dateBegin");

-- CreateIndex
CREATE UNIQUE INDEX "DmarcReport_orgName_reportId_key" ON "DmarcReport"("orgName", "reportId");

-- CreateIndex
CREATE INDEX "TlsRptReport_domainName_dateBegin_idx" ON "TlsRptReport"("domainName", "dateBegin");

-- CreateIndex
CREATE UNIQUE INDEX "TlsRptReport_orgName_reportId_key" ON "TlsRptReport"("orgName", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "SeedAccount_address_key" ON "SeedAccount"("address");

-- CreateIndex
CREATE INDEX "SeedAccount_provider_active_idx" ON "SeedAccount"("provider", "active");

-- CreateIndex
CREATE INDEX "PlacementTest_domainId_startedAt_idx" ON "PlacementTest"("domainId", "startedAt");

-- CreateIndex
CREATE INDEX "PlacementTest_campaignId_idx" ON "PlacementTest"("campaignId");

-- CreateIndex
CREATE INDEX "PlacementResult_folder_observedAt_idx" ON "PlacementResult"("folder", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementResult_testId_seedAccountId_key" ON "PlacementResult"("testId", "seedAccountId");

-- CreateIndex
CREATE INDEX "Lead_orgId_status_idx" ON "Lead"("orgId", "status");

-- CreateIndex
CREATE INDEX "Lead_companyDomain_idx" ON "Lead"("companyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_orgId_email_key" ON "Lead"("orgId", "email");

-- CreateIndex
CREATE INDEX "LeadList_orgId_status_idx" ON "LeadList"("orgId", "status");

-- CreateIndex
CREATE INDEX "LeadListMembership_leadId_idx" ON "LeadListMembership"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadListMembership_listId_leadId_key" ON "LeadListMembership"("listId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationResult_email_key" ON "VerificationResult"("email");

-- CreateIndex
CREATE INDEX "VerificationResult_status_expiresAt_idx" ON "VerificationResult"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_leadId_revokedAt_idx" ON "ConsentRecord"("leadId", "revokedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_orgId_idx" ON "ConsentRecord"("orgId");

-- CreateIndex
CREATE INDEX "JurisdictionPolicy_countryCode_effectiveFrom_idx" ON "JurisdictionPolicy"("countryCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionPolicy_countryCode_version_key" ON "JurisdictionPolicy"("countryCode", "version");

-- CreateIndex
CREATE INDEX "PolicyDecision_orgId_createdAt_idx" ON "PolicyDecision"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_intentId_idx" ON "PolicyDecision"("intentId");

-- CreateIndex
CREATE INDEX "PolicyDecision_decision_createdAt_idx" ON "PolicyDecision"("decision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalSuppression_addressHash_key" ON "GlobalSuppression"("addressHash");

-- CreateIndex
CREATE INDEX "GlobalSuppression_domain_idx" ON "GlobalSuppression"("domain");

-- CreateIndex
CREATE INDEX "GlobalSuppression_reason_createdAt_idx" ON "GlobalSuppression"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_orgId_status_idx" ON "Campaign"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_campaignId_position_key" ON "SequenceStep"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StepVariant_stepId_label_key" ON "StepVariant"("stepId", "label");

-- CreateIndex
CREATE INDEX "CampaignLead_state_nextDueAt_idx" ON "CampaignLead"("state", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "SendIntent_messageId_key" ON "SendIntent"("messageId");

-- CreateIndex
CREATE INDEX "SendIntent_state_dueAt_idx" ON "SendIntent"("state", "dueAt");

-- CreateIndex
CREATE INDEX "SendIntent_campaignId_state_idx" ON "SendIntent"("campaignId", "state");

-- CreateIndex
CREATE INDEX "SendIntent_mailboxId_submittedAt_idx" ON "SendIntent"("mailboxId", "submittedAt");

-- CreateIndex
CREATE INDEX "SendIntent_orgId_createdAt_idx" ON "SendIntent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxThread_orgId_state_lastMessageAt_idx" ON "InboxThread"("orgId", "state", "lastMessageAt");

-- CreateIndex
CREATE INDEX "InboxThread_mailboxId_idx" ON "InboxThread"("mailboxId");

-- CreateIndex
CREATE INDEX "InboxThread_intent_idx" ON "InboxThread"("intent");

-- CreateIndex
CREATE INDEX "InboxMessage_threadId_receivedAt_idx" ON "InboxMessage"("threadId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboxMessage_messageId_idx" ON "InboxMessage"("messageId");

-- CreateIndex
CREATE INDEX "HandoffEvent_orgId_status_idx" ON "HandoffEvent"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskConfig_taskId_key" ON "AiTaskConfig"("taskId");

-- CreateIndex
CREATE INDEX "AiCall_taskId_createdAt_idx" ON "AiCall"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_orgId_createdAt_idx" ON "AiCall"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Domain_name_idx" ON "Domain"("name");

-- AddForeignKey
ALTER TABLE "BlastNode" ADD CONSTRAINT "BlastNode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingIp" ADD CONSTRAINT "SendingIp_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "BlastNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDomain" ADD CONSTRAINT "FleetDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDomain" ADD CONSTRAINT "FleetDomain_ipId_fkey" FOREIGN KEY ("ipId") REFERENCES "SendingIp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMailbox" ADD CONSTRAINT "FleetMailbox_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMailbox" ADD CONSTRAINT "FleetMailbox_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "FleetDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMailbox" ADD CONSTRAINT "FleetMailbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "BlastNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMailbox" ADD CONSTRAINT "FleetMailbox_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMailbox" ADD CONSTRAINT "FleetMailbox_warmupPlanId_fkey" FOREIGN KEY ("warmupPlanId") REFERENCES "WarmupPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlacklistCheck" ADD CONSTRAINT "BlacklistCheck_ipId_fkey" FOREIGN KEY ("ipId") REFERENCES "SendingIp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlacklistCheck" ADD CONSTRAINT "BlacklistCheck_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "FleetDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmarcReport" ADD CONSTRAINT "DmarcReport_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "FleetDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementTest" ADD CONSTRAINT "PlacementTest_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "FleetDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementTest" ADD CONSTRAINT "PlacementTest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResult" ADD CONSTRAINT "PlacementResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "PlacementTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResult" ADD CONSTRAINT "PlacementResult_seedAccountId_fkey" FOREIGN KEY ("seedAccountId") REFERENCES "SeedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_verifyResultId_fkey" FOREIGN KEY ("verifyResultId") REFERENCES "VerificationResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadList" ADD CONSTRAINT "LeadList_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMembership" ADD CONSTRAINT "LeadListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "LeadList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMembership" ADD CONSTRAINT "LeadListMembership_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepVariant" ADD CONSTRAINT "StepVariant_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "StepVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendIntent" ADD CONSTRAINT "SendIntent_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "FleetMailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "FleetMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffEvent" ADD CONSTRAINT "HandoffEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
