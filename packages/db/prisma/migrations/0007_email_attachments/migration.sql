-- Persist attachments on the email so they reach the provider at send time
-- (previously the API parsed `attachments` then silently dropped them).
ALTER TABLE "Email" ADD COLUMN IF NOT EXISTS "attachments" JSONB;
