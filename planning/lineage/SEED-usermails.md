# ems

> Developer-first, white-label application-email platform — a Resend competitor. Transactional today (the acute developer pain point), marketing & lifecycle later on the same event stream.

## Overview

**The Problem:** Every app must send email — password resets, magic links, receipts, OTPs, alerts — and the tooling is bad. Legacy giants (SendGrid, Mailgun) have rotted DX and opaque deliverability; the modern darling (Resend) nailed DX but is a closed box with no self-host, shallow white-label, and pricing that punishes growth; raw AWS SES is cheap infrastructure with no product around it; and nobody hands developers real deliverability tooling (inbox placement, warmup, DMARC/BIMI guidance) or true white-label resale.

**Our Solution:** ems is the platform for application email — a **drop-in Resend-compatible API** (change one base URL), **deliverability as a product** (dedicated IPs + warmup, suppression, inbox-placement, reputation), and **white-label multi-tenancy from day one** so agencies and SaaS platforms resell email under their own brand. Built on AWS SES behind a provider abstraction, with marketing/lifecycle automation on the same event stream as a natural expansion.

Foundation: **freeresend (MIT)** adapted + **usesend (AGPLv3) clean-room inspiration only** (see `.bootspring/context/DECISIONS.md` D1).

---

## Tech Stack

```yaml
stack:
  framework: nextjs        # dashboard (App Router); public API on hono
  language: typescript
  database: postgresql     # control plane (prisma) + clickhouse/tinybird for events
  queue: redis + bullmq
  hosting: coolify         # Hostinger fleet App box .207 (NOT vercel)

frontend:
  uiLibrary: shadcn
  styling: tailwind

backend:
  orm: prisma
  auth: authjs
  api: hono
  email: aws-ses           # behind a MailProvider seam — swappable for SMTP/own-MTA
  analytics: clickhouse     # or tinybird (DECISIONS D10)
  storage: cloudflare-r2    # or shared MinIO on Data box .211
```

---

## Architecture

1. **Public API (Hono)** — Resend-compatible: authn, rate-limit, validation, suppression, enqueue.
2. **Dashboard (Next.js + tRPC + shadcn)** — domains, keys, logs, deliverability, team, branding, marketing (later).
3. **Queue (Redis + BullMQ)** — durable send, scheduling, webhook dispatch, IP warmup.
4. **Send workers** — dispatch through a `MailProvider` (v1 `SesProvider`).
5. **Postgres (control plane)** — orgs/projects/domains/keys/emails/events/suppression/webhooks/usage.
6. **Event ingestor** — SES/SNS → suppression rules → ClickHouse (analytics) + Postgres (state).
7. **Webhook dispatcher** — HMAC-signed, retried, replayable.
8. **Deliverability subsystem** — DKIM/SPF/DMARC/BIMI, dedicated IP pools + warmup, inbox placement, reputation, abuse screening.

Full topology + data model: `.bootspring/context/ARCHITECTURE.md`. Real deploy fabric: `.bootspring/context/INFRA.md`.

---

## Integrations

**Sending:** AWS SES (v1, behind `MailProvider`)
**DNS / edge / storage:** Cloudflare (one-click DNS verify, edge, R2)
**Database:** Postgres 18 + pgvector (Hostinger Data box .211)
**Queue/cache:** Redis/Valkey (Data box .211)
**Analytics:** ClickHouse or Tinybird
**Auth:** Auth.js (credentials + OAuth)
**Compatibility:** Resend SDK (drop-in via base URL), official ems SDK

---

## MVP Features (Phase 1 — Transactional Core)

1. Auth, organizations, projects, RBAC (multi-tenant spine)
2. Sending domains + DKIM/SPF/DMARC auto-setup + one-click Cloudflare DNS verification
3. Scoped, hashed API keys
4. Resend-compatible send API (`/emails`, `/emails/batch`, `GET /emails/:id`, scheduling, idempotency)
5. Durable send pipeline (BullMQ → SES) behind the `MailProvider` seam
6. SES/SNS event ingestion + automatic suppression on bounce/complaint
7. Searchable logs + per-message event timeline
8. HMAC-signed webhooks with retries + replay
9. Deliverability basics (rates + alerts) + abuse screening
10. White-label foundations (custom dashboard domain, branding, reseller usage rollup)

Detail: `.bootspring/context/PRD.md` · spec/plan/tasks: `.bootspring/specs/transactional-core/`.

---

## Implementation Phases

- **Phase 0 — Foundation spike:** prove the drop-in send path end to end on the fleet (one authenticated email → real inbox + one ingested event).
- **Phase 1 — Transactional Core (MVP):** the 10 features above.
- **Phase 2 — Deliverability Suite:** dedicated IPs + warmup, suppression UI, inbox-placement testing, reputation/blocklist/DMARC monitoring, BIMI.
- **Phase 3 — Marketing / Lifecycle:** contacts, segments, broadcasts, editor, automations on the same event stream.
- **Phase 4 — Scale & Enterprise:** BYO-SES, self-host, multi-provider routing, SSO, reseller marketplace.

Detail + sequencing rationale: `.bootspring/context/ROADMAP.md`.

---

*Seed for [Bootspring](https://bootspring.com). Merged context: `planning/SEED.md`. Full context docs: `.bootspring/context/`.*
