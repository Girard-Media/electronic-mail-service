# ems — Roadmap

**Generated:** 2026-06-20
**Status:** Draft v1

> Sequenced to **land transactional, prove deliverability, expand to marketing, then scale white-label** — each phase independently valuable. Timeboxes are planning estimates for a small team, not commitments.

## Phase 0 — Foundation & spike (≈ weeks 1–2)
**Goal:** prove the drop-in send path end to end on our infra.
- Stand up repo on the freeresend (MIT) base; Next.js + Postgres/Prisma + Redis + Hono skeleton.
- Provision dedicated AWS SES account; request production access early (lead time!).
- Wire `MailProvider` → `SesProvider`; send one authenticated email; ingest one SES/SNS event.
- Deploy to Coolify; DNS/edge via Cloudflare; R2 bucket for assets.
- **Exit:** an email sent via `POST /emails` lands in a real inbox; event recorded.

## Phase 1 — Transactional Core (MVP) (≈ weeks 3–10)
**Goal:** a developer can fully replace Resend/SES in production and trust it. (Maps to [[PRD]] E1–E9.)
- Auth, orgs, projects, RBAC (multi-tenant spine).
- Domains + DKIM/SPF/DMARC auto-setup + **one-click Cloudflare DNS** + verification.
- API keys (hashed, scoped); **Resend-compatible** `/emails`, `/emails/batch`, `/emails/:id`, scheduling, idempotency.
- Durable send pipeline (BullMQ → SES), event ingestion, automatic suppression.
- Logs & per-message event timeline (ClickHouse-backed); dashboard analytics basics.
- Signed webhooks with retries + replay.
- White-label foundations: custom dashboard domain, branding, reseller sub-tenant rollup.
- Official SDK + documented `resend` drop-in; migration docs.
- **Exit / launch criteria:** the [[PRD]] "definition of trust" passes; free tier live; first external design partners migrated.

## Phase 1.5 — Hosted inbox (the moat, in progress)
**Goal:** `name@theirdomain.com` without Google Workspace, on the same DKIM as transactional send.
- P1 receive + read — **in code** (`/mta/inbound`, webmail).
- P2 first-class Inbox nav, compose, search, catch-all, verified forwarding — **in code**. MX activation + dogfood still required before marketing the card.
- P3 IMAP + SMTP submission — later. Do not start until P2 is receiving in production.

## Phase 1.6 — Agent Track (counter-AgentMail; see `planning/AGENT_EMAIL.md`)
**Goal:** second wedge on the same infra — programmatic inboxes for AI agents. ~80% of AgentMail's core is machinery we already run; the gap is public API exposure + packaging.
- A1 public Inbox API (API-key scoped `inbox:read/write`, instant `@agents.electronicmailservices.com` inboxes, zero DNS).
- A2 threads (In-Reply-To/References grouping) · A3 MCP v2 (inbox-operating tools + **npm publish**).
- A4 drafts + human-in-the-loop approval · A5 realtime (SSE/WebSocket event stream) · A6 labels + search.
- A7 agent-native docs (llms.txt, OpenAPI endpoint, agent guides) · A8 per-inbox pricing axis.
- **Gate:** no "email for agents" marketing until A1+A3 run against a production MX-active inbox (doubles as the Phase 1.5 dogfood driver).

## Phase 2 — Deliverability Suite (≈ weeks 11–18)
**Goal:** make "reaches the inbox" a measurable, paid promise. (Maps to [[DELIVERABILITY]] Phase 2.)
- Dedicated IP pools + **automated warmup**.
- Suppression management UI; address validation.
- **Inbox-placement / seed-list testing**; blocklist monitoring; reputation dashboard.
- DMARC aggregate report ingestion; BIMI support.
- Abuse-prevention hardening (anomaly detection, caps, kill-switch).
- **Exit:** dedicated-IP add-on monetized; placement reporting live; abuse controls proven.

## Phase 3 — Contacts & Marketing / Lifecycle (≈ weeks 19–30)
**Goal:** expand revenue into marketing **on the same event stream** — the CRM/feature-launch use case.
- Contacts & segments; preference center + RFC-8058 unsubscribe.
- Email editor (React Email / block editor) + templates; broadcasts; A/B testing.
- **Automations / journeys** triggered by delivery/engagement **and customer product events** (via API/webhooks) — onboarding, feature-launch announcements, re-engagement.
- Marketing analytics; metered marketing billing.
- **Exit:** existing transactional customers running lifecycle campaigns without a second vendor.

## Phase 4 — Scale, Enterprise & White-label depth (≈ weeks 31+)
**Goal:** durable moat and up-market motion.
- BYO-SES; self-host distribution/licensing.
- Multi-provider routing + reputation-aware routing; own-MTA evaluation.
- SSO/SAML/SCIM, audit logs, regional sending, SOC2 path.
- Usage-based billing integration; **agency/reseller marketplace & program**.
- Cross-tenant reputation ML for routing/warmup.

## Sequencing rationale

1. **Transactional first** — it's the acute pain, the stickiest, and the trust-builder; deliverability there earns the right to sell marketing.
2. **Deliverability second** — converts anxiety into high-margin revenue and is our defensible edge vs Resend.
3. **Marketing third** — lands on an installed base that already trusts our delivery, on infra we already run.
4. **White-label runs through all phases** as a foundational property, then deepens into a channel in Phase 4.

## Immediate next actions

- [x] Foundation/licensing ([[DECISIONS]] D1) — freeresend MIT; own MTA (not SES).
- [x] Deploy fabric — hostssh on `.223` (`git push hostssh main`). Coolify retired.
- [ ] Deploy current tree so `/readyz` and Inbox exist in production.
- [ ] Paste Better Stack monitors (`infra/observability.md`).
- [ ] Hub: bounce MX + mailbox inbound scripts; then one MX-ready dogfood domain.
- [ ] Run `bootspring_spec` for **transactional-core**, then plan → tasks → build.

## Related

See [[VISION]], [[PRD]], [[ARCHITECTURE]], [[DELIVERABILITY]], [[BUSINESS_MODEL]], [[DECISIONS]].
