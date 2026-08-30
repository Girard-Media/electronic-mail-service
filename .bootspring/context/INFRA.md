# ems — Infrastructure & Deployment

**Generated:** 2026-06-20
**Status:** Draft v1 — grounded in the real Girard Media fleet (DEV OPS / HOSTINGER/FLEET-REGISTRY.md)

> ems deploys onto the **existing self-hosted Hostinger + Coolify fleet**, not Vercel. This doc is the concrete deploy target; pairs with [[ARCHITECTURE]] (logical design) and the `hostinger-fleet` / `cloudflare` skills (operations).

## The fleet (all KVM 8: 8 vCPU / 32 GB / 400 GB NVMe / 32 TB BW · DC17 · 3-yr term)

| Box | IP | Role | Use for ems |
|---|---|---|---|
| **App** `srv726461` | `31.220.104.207` | Coolify — all web apps + n8n | **Deploy api + dashboard + workers here** (Coolify project `girard-media-apps` or new `ems`) |
| **Data** `srv726490` | `31.220.104.211` | Coolify — Postgres 18 + pgvector, restic→R2 hub, shared Valkey + MinIO | **Postgres DB, Redis/BullMQ, optional MinIO** |
| **MCP** `srv726473` | `31.220.104.208` | Bootspring | leave untouched |
| **Playground** `srv726571` | `31.220.104.223` | idle | spare / staging if needed |

## Live deployment (Phase 0 — 2026-06-20)

**LIVE:** `http://s4kupmnkqfqajm2he0byepdc.31.220.104.207.sslip.io` (dashboard prototype at `/`, `/health` 200, Resend-compatible `POST /emails`).

| Resource | Coolify uuid / id |
|---|---|
| API app (Hono) | `s4kupmnkqfqajm2he0byepdc` · port 8787 · railpack + tsx |
| Workers app (BullMQ) | `hslc2wj7tqzgjkzmdy542gnq` · no HTTP · healthcheck off |
| Redis (queue) | `u8udsms97ttvr322f9kwaafi` — **dedicated Coolify Redis** (shared `gm-valkey` not yet live; consolidate later) |
| Postgres DB | `ems` on .211 (PG18, empty — Phase 1a migrations pending) |
| R2 bucket | `ems-assets` |

Project `girard-media-apps` (`ahbq42smvjvbreqnefqc92uw`), server `g13q39quhs6hr49n0bb1b3rw`, GitHub App `ybi7ksxishfgns1z1lzcg0y5`. **End-to-end verified:** public send → BullMQ → worker `[send] completed`. **Open:** real SES dispatch stubbed (no AWS creds); built on Node 20 (set `RAILPACK_NODE_VERSION=22` build var); no custom domain (electronicmailservices.com not on Cloudflare); enqueue uses the dedicated Redis. Coolify env gotcha: omit `is_build_time` in `POST /envs`.

## Where each ems component runs

- **Postgres (control plane):** new DB `ems` on **.211**. App reaches it over the WireGuard link at `10.10.0.2:5432` (direct/migrator) and `10.10.0.2:6432` (PgBouncer, app role). Pattern proven by pyrosync/corereflex. Create a dedicated role `ems_app` (+ readonly).
- **Redis / BullMQ:** shared **`gm-valkey`** at `10.10.0.2:6379` (AOF, ACL users) on .211. Add a `ems` ACL user. This is our queue — no new infra needed.
- **Object storage (attachments, assets, DMARC reports):** **Cloudflare R2** (preferred, per fleet pattern) bucket **`ems-assets`** ✅ *created 2026-06-20 on the Admin@girardmedia account (ENAM)*, or the shared MinIO at `10.10.0.2:9000`.
- **Analytics events (ClickHouse/Tinybird):** start with **Tinybird** (managed) to avoid standing up ClickHouse on the fleet early (DECISIONS D10); revisit self-hosting at scale.
- **Sending substrate (SES):** **no standing AWS infra exists** — provision via the **AWS API MCP** (`call_aws` / `suggest_aws_commands`, confirm-first on create/modify). Steps: create SES identity for sending domains, enable Easy DKIM, create configuration set `ems-events`, wire an **SNS topic** → our event ingestor, and **request production access (out of sandbox) early — longest lead time.**

## Deploy recipe (Coolify, from the fleet runbook)

1. **Create app:** `POST /api/v1/applications/private-github-app` `{ github_app_uuid, git_repository:"Girard-Media/ems", git_branch:"main", build_pack:"railpack", ports_exposes }`.
   - Build pack **railpack** + `RAILPACK_NODE_VERSION=22` (the fleet standard — solves Prisma 7.x Node-version blocker; Nixpacks is retired here).
2. **Monorepo start commands** (railpack can't infer Turborepo/pnpm-workspace starts — set explicitly via `PATCH /applications/{uuid}` then force redeploy `/deploy?uuid=&force=true`):
   - api: `cd /app/apps/api && node dist/index.js` (or `pnpm --filter @ems/api start`), `ports_exposes=8787`.
   - dashboard: `cd /app/apps/dashboard && ./node_modules/.bin/next start -H 0.0.0.0 -p 3000`, `ports_exposes=3000`.
   - workers: long-running process, no port.
3. **Env:** `DATABASE_URL`/`DIRECT_URL` → `10.10.0.2:6432`/`:5432`; `REDIS_URL` → `10.10.0.2:6379`; AWS SES creds + `SES_CONFIGURATION_SET`; Cloudflare token; R2/MinIO creds. (See `.env.example`.)
4. **Backups:** the .211 restic hub (`gm-backup.sh`) dumps **all** DBs dynamically → R2, so the `ems` DB is picked up automatically once created.

## DNS & domains (Cloudflare)

- **App domains** (dashboard.electronicmailservices.com, api.electronicmailservices.com, app apex/www): add `electronicmailservices.com` as a Cloudflare zone; point records → **.207**, DNS-only (grey cloud) + Let's Encrypt cert first (proxying needs SSL=Full set, which the DNS-scoped token can't do). Use the `Zone:DNS:Edit` token (note: CF now prefixes tokens `cfut_`/`cfat_`). Leave any email MX/TXT untouched.
- **Customer sending-domain auth** is a *separate, in-product* flow: the dashboard generates DKIM CNAMEs + SPF/DMARC/MAIL FROM via SES (`SesProvider.setupDomainAuth`) and offers one-click Cloudflare publish for customers whose DNS is on Cloudflare, copy-paste otherwise (FR-010..012, see [[DELIVERABILITY]]).

## Dogfooding note

Fleet apps currently use **Resend** (`RESEND_API_KEY` in pyrosync etc.). Once ems is live, migrate the fleet's own transactional email to ems (one base-URL change) — the first real-world drop-in migration and an internal deliverability proving ground.

## Related

See [[ARCHITECTURE]], [[DELIVERABILITY]], [[ROADMAP]], [[DECISIONS]] (D2/D4/D10).
