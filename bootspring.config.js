/**
 * Bootspring Configuration
 * https://bootspring.com/docs/configuration
 */

module.exports = {
  project: {
    name: "ems",
    description:
      "Developer-first, white-label application-email platform — Resend-compatible transactional API + deliverability suite, marketing/lifecycle later. See .bootspring/context.",
    version: "0.1.0",
    status: "development",
  },
  stack: {
    framework: "nextjs", // dashboard; public API on hono
    language: "typescript",
    database: "postgresql",
    hosting: "coolify", // Hostinger fleet App box .207 (NOT vercel)
  },
  frontend: {
    uiLibrary: "shadcn",
    styling: "tailwind",
  },
  backend: {
    orm: "prisma",
    auth: "authjs",
    api: "hono",
    queue: "bullmq", // redis/valkey on Data box .211
    email: "aws-ses", // behind a MailProvider abstraction (DECISIONS D2)
    analytics: "clickhouse", // or tinybird (DECISIONS D10)
    storage: "cloudflare-r2", // or shared MinIO on .211
  },
};
