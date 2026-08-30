-- Native mailboxes (P1 foundation). See planning/NATIVE_MAILBOXES.md.

-- CreateEnum
CREATE TYPE "MailboxStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT,
    "quotaBytes" BIGINT NOT NULL DEFAULT 1073741824,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "status" "MailboxStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "threadId" TEXT,
    "fromAddr" TEXT NOT NULL,
    "toAddrs" TEXT[],
    "subject" TEXT,
    "snippet" TEXT,
    "rawKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "folder" TEXT NOT NULL DEFAULT 'inbox',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");
CREATE INDEX "Mailbox_projectId_idx" ON "Mailbox"("projectId");
CREATE INDEX "Message_mailboxId_folder_receivedAt_idx" ON "Message"("mailboxId", "folder", "receivedAt");

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
