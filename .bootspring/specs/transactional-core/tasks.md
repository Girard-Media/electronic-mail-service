# Tasks: Transactional Core (MVP)

**Input**: .bootspring/specs/transactional-core/spec.md and .bootspring/specs/transactional-core/plan.md

Legend: `[P]` = parallelizable · `[USn]` = user story · `(FR-xxx)` = traceability.

## Phase 0 — Foundation spike
- [ ] T001 Scaffold monorepo per plan (apps/dashboard, apps/api, apps/workers, packages/*), TypeScript + lint + typecheck gates.
- [ ] T002 Adapt freeresend (MIT) Resend-compatible request/response shapes + SES send path into `packages/providers`; record provenance, exclude any AGPL code (DECISIONS D1).
- [ ] T003 Provision dedicated AWS SES account; **request production access** (long lead time); create SNS topics + region identities.
- [ ] T004 [P] Provision deploy fabric: Coolify app, Cloudflare zone/edge, Postgres + Redis on fleet, R2 bucket.
- [ ] T005 Define `MailProvider` interface + `SesProvider.send`/`verifyDomain` (FR-043); send ONE authenticated email to a real inbox and ingest ONE SNS event. **Exit gate for Phase 0.**

## Phase 1a — Tenant spine (US3)
- [ ] T010 [US3] Prisma schema: organizations, memberships(roles), projects + migrations (FR-002).
- [ ] T011 [US3] Auth.js sign-up/sign-in (credentials + 1 OAuth) (FR-001).
- [ ] T012 [US3] Tenant-isolation guard in data-access layer + tRPC middleware (FR-003).
- [ ] T013 [US3] API keys: create/show-once/hash/revoke + auth + rate-limit middleware (FR-020, FR-021).
- [ ] T014 [P][US3] Tests: isolation (no cross-project access, SC-004), key lifecycle, RBAC denials.

## Phase 1b — Domains & sender auth (US2)
- [ ] T020 [US2] Prisma: domains (dkim keys, status, tracking domain, region); DKIM keypair generation (FR-010).
- [ ] T021 [US2] Derive SPF/DKIM/DMARC (+ MAIL FROM, tracking CNAME) records via SES (FR-010).
- [ ] T022 [US2] Cloudflare one-click DNS publish + copy-paste fallback (FR-011).
- [ ] T023 [US2] Verification job + status (pending/verified/failed) with per-record diagnostics + re-check (FR-012).
- [ ] T024 [P][US2] Tests: record derivation, verify flow, failure diagnostics.

## Phase 1c — Resend-compatible send path (US1, US8)
- [ ] T030 [US1] Hono `POST /emails` with full Resend payload + Resend-compatible response (FR-030).
- [ ] T031 [US1] Validation + actionable Resend-compatible errors; pre-dispatch suppression check (FR-032).
- [ ] T032 [US1] Durable enqueue (BullMQ) → send worker → `SesProvider` dispatch; no-loss guarantee (FR-040, NFR-002).
- [ ] T033 [US8] `POST /emails/batch`, `GET /emails/:id`, `Idempotency-Key`, scheduled_at + cancel (FR-031).
- [ ] T034 [P][US1] Contract tests vs documented Resend payloads/responses; p99 send-accept < 300ms (NFR-002).

## Phase 1d — Events, suppression, logs, deliverability basics (US4, US6)
- [ ] T040 [US6] SNS event ingestor: delivery/bounce/complaint/reject/open/click → persist (FR-041).
- [ ] T041 [US6] Auto-suppression on hard bounce/complaint + transient-retry policy (FR-042).
- [ ] T042 [US6] Abuse screening (disposable domains, anomalies) + expandable per-tenant caps + kill-switch (FR-071).
- [ ] T043 [US4] Email logs: searchable (status/domain/tag/date/recipient) on analytics store; per-message timeline + rendered content + failure reason (FR-050, FR-051).
- [ ] T044 [US6] Analytics: sends/delivered/bounced/complained/opened/clicked + per-domain rates + threshold alerts (FR-070).
- [ ] T045 [P][US6] Tests: SES-simulator bounce/complaint → suppression + analytics (SC-003).

## Phase 1e — Webhooks (US5)
- [ ] T050 [US5] Endpoint registration + event-type subscriptions (FR-060).
- [ ] T051 [US5] HMAC-signed dispatch via BullMQ with retries+backoff, attempt log, dead-letter (FR-061, NFR-003).
- [ ] T052 [US5] Manual replay from dashboard (FR-061).
- [ ] T053 [P][US5] Tests: signature verification, retry on 5xx/timeout, replay.

## Phase 1f — White-label foundations (US7)
- [ ] T060 [US7] Per-org branding: custom dashboard domain, logo, colors, powered-by toggle; custom sending/tracking domains (FR-080).
- [ ] T061 [US7] Reseller sub-tenant usage rollup + billing-ready export (FR-081).
- [ ] T062 [P][US7] Tests: branding application, usage rollup correctness.

## Phase 1g — SDK & migration
- [ ] T070 [P] Official `ems` SDK + documented `resend` drop-in (base-URL swap) + migration guide (US1).
- [ ] T071 [P] Compliance scaffolding: List-Unsubscribe/RFC-8058 hook, GDPR export/delete stubs (NFR-005).

## Phase 2 — Verification (launch gate)
- [ ] T080 E2E "definition of trust" (SC-001): signup → verify domain (Cloudflare) → key → send via resend SDK → delivered in logs → signed webhook received.
- [ ] T081 Run quality gates (lint, typecheck, tests); record evidence (NFR-001).
- [ ] T082 Write run/setup docs (SES, env, deploy) + release notes.

## Dependencies & Parallelism
- Phase 0 (T001–T005) blocks everything; T005 is the spike exit gate.
- T002 (freeresend adapt) feeds T030/T032; T003 (SES access) blocks T005, T032, T040.
- 1a (tenant spine) blocks 1b–1f (all scoped to project).
- 1c blocks 1d/1e (need real sends + events).
- White-label (1f) depends only on 1a; can run parallel to 1d/1e.
- `[P]` test tasks run parallel to their siblings if file ownership differs.
- T080 runs only after 1a–1e complete.
