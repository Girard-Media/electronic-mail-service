-- Session revocation: bumpable token version per user (logout-everywhere / invalidate on compromise)
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
