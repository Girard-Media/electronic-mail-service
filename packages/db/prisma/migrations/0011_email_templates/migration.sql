-- Block-based email templates. content holds { blocks, settings } JSON rendered
-- by packages/core/email-template.ts; enqueueEmail can send by templateId.
CREATE TABLE "EmailTemplate" (
  "id"         TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "subject"    TEXT NOT NULL DEFAULT '',
  "content"    JSONB NOT NULL,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailTemplate_projectId_updatedAt_idx" ON "EmailTemplate" ("projectId", "updatedAt");

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
