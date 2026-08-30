/**
 * Bootspring Configuration
 * https://bootspring.com/docs/configuration
 */

module.exports = {
  project: {
    name: "electronic-mail-service",
    description:
      "Cold B2B outreach infrastructure we own end to end — our metal, our IPs, our MTA, our mail log. Fleet control plane, warmup engine, send router, deliverability observability, policy gate, AI layer. See planning/INDEX.md.",
    version: "0.1.0",
    status: "development",
  },
  stack: {
    framework: "nextjs", // apps/web cockpits; public API on hono
    language: "typescript",
    database: "postgresql", // control plane on .211; ClickHouse for observations
    hosting: "hostssh", // Hostinger fleet hub .223 — NOT vercel, NOT coolify
  },
  frontend: {
    uiLibrary: "shadcn",
    styling: "tailwind",
  },
  backend: {
    orm: "prisma",
    auth: "authjs",
    api: "hono",
    queue: "bullmq", // Valkey on Data box .211
    email: "self-hosted-postfix", // our own blast nodes behind MailProvider — never SES
    analytics: "clickhouse",
    storage: "cloudflare-r2",
    inference: "openrouter", // the single sanctioned inference dependency
  },
};
