-- Shared-domain agent inboxes (public /inboxes API): a Mailbox on the
-- platform-owned AGENT_INBOX_DOMAIN has no customer Domain row, so the FK
-- becomes nullable. Address uniqueness (global) already prevents collisions.
ALTER TABLE "Mailbox" ALTER COLUMN "domainId" DROP NOT NULL;
