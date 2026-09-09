-- CampaignMailbox: explicit sending pool per campaign (ListKit-style attach).
-- InboxThread.campaignId index so unified-inbox campaign filters are not seq scans.

CREATE TABLE "CampaignMailbox" (
    "campaignId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMailbox_pkey" PRIMARY KEY ("campaignId","mailboxId")
);

CREATE INDEX "CampaignMailbox_mailboxId_idx" ON "CampaignMailbox"("mailboxId");

ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_mailboxId_fkey"
  FOREIGN KEY ("mailboxId") REFERENCES "FleetMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "InboxThread_campaignId_idx" ON "InboxThread"("campaignId");
