-- Guarantee that deleting a sending domain never fails on referencing emails.
-- The send log keeps its rows; the domain link is nulled (history is preserved).
-- Idempotent + defensive: brings any drifted prod constraint to the intended
-- ON DELETE SET NULL state regardless of what it is now.
ALTER TABLE "Email" DROP CONSTRAINT IF EXISTS "Email_domainId_fkey";
ALTER TABLE "Email" ADD CONSTRAINT "Email_domainId_fkey"
  FOREIGN KEY ("domainId") REFERENCES "Domain"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
