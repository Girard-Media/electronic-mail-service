-- Native mailbox forwarding + catch-all (hosted inbox product).

ALTER TABLE "Mailbox" ADD COLUMN "keepCopy" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Mailbox" ADD COLUMN "catchAll" BOOLEAN NOT NULL DEFAULT false;

-- At most one catch-all mailbox per domain.
CREATE UNIQUE INDEX "Mailbox_one_catchall_per_domain" ON "Mailbox" ("domainId") WHERE "catchAll" = true;

CREATE TABLE "MailForward" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifyToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailForward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailForward_verifyToken_key" ON "MailForward"("verifyToken");
CREATE UNIQUE INDEX "MailForward_mailboxId_destination_key" ON "MailForward"("mailboxId", "destination");
CREATE INDEX "MailForward_mailboxId_idx" ON "MailForward"("mailboxId");

ALTER TABLE "MailForward" ADD CONSTRAINT "MailForward_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
