-- API key permissions. Existing keys become full_access so nothing breaks; new
-- keys minted for sending should be created as sending_access.
CREATE TYPE "ApiKeyPermission" AS ENUM ('full_access', 'sending_access');

ALTER TABLE "ApiKey"
  ADD COLUMN "permission" "ApiKeyPermission" NOT NULL DEFAULT 'full_access';
