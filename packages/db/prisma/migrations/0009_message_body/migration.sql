-- P1 stores the parsed body in Postgres so reading a message works without
-- object storage; raw RFC822 (rawKey → R2) becomes optional, added later.
ALTER TABLE "Message" ALTER COLUMN "rawKey" DROP NOT NULL;
ALTER TABLE "Message" ADD COLUMN "text" TEXT;
ALTER TABLE "Message" ADD COLUMN "html" TEXT;
