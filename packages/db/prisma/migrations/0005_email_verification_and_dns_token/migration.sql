-- Email-ownership verification on User + per-project BYO managed-DNS token.

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "verifyToken" TEXT;

ALTER TABLE "Project" ADD COLUMN "dnsToken" TEXT;
