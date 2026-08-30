---
name: transactional-core
status: draft
created: 2026-06-20T09:37:46.645Z
source: bootspring-spec
---

# Feature Specification: Transactional Core (MVP)

## Overview

The first independently shippable slice of ems: a **white-label, multi-tenant, Resend-compatible transactional email platform**. A developer can sign up, verify a sending domain, create an API key, send production email by changing one base URL in the `resend` SDK, watch it deliver in logs, and receive a signed webhook — with no spam-folder surprise on a properly authenticated domain.

Built on the freeresend (MIT) base + clean-room patterns from usesend (see `.bootspring/context/DECISIONS.md` D1). Sending substrate is AWS SES behind a `MailProvider` abstraction.

## User Stories & Acceptance

Stories are ordered so each delivers visible value and is independently testable. P1 = required for the MVP "definition of trust"; P2 = strongly desired in the slice; P3 = stretch.

### US1 — Drop-in send (Priority: P1)
A developer points the `resend` SDK at ems (base-URL swap) with a ems API key and sends a transactional email that reaches a real inbox.
**Independent Test:** With a verified domain + key, `POST /emails` (Resend payload) returns a message id and the message is delivered and visible in logs.
**Acceptance**
1. Given a verified domain and valid key, when a Resend-shaped `POST /emails` is sent, then it is accepted (<300ms p99), enqueued durably, sent via SES, and reaches the inbox.
2. Given an invalid/oversized/missing-field payload, then it is rejected with an actionable, Resend-compatible error and is not enqueued.
3. Given a recipient on the project suppression list, then the send is blocked pre-dispatch and reported as suppressed.

### US2 — Verify a sending domain (Priority: P1)
A developer adds a domain and gets it authenticated (DKIM/SPF/DMARC) quickly.
**Independent Test:** Add a domain → receive DNS records → (one-click Cloudflare or copy-paste) → status flips to verified on recheck.
**Acceptance**
1. Given a new domain, when added, then DKIM keypair is generated and SPF/DKIM/DMARC (+ optional MAIL FROM, tracking CNAME) records are presented.
2. Given DNS is published via Cloudflare one-click, when verification runs, then status becomes `verified` without manual record entry.
3. Given records are missing/incorrect, then status is `pending`/`failed` with a precise per-record diagnostic.

### US3 — Manage projects, keys & team (Priority: P1)
An org owner organizes work into projects, invites teammates with roles, and manages scoped API keys.
**Independent Test:** Create org/project, invite a member with a role, create + revoke a key; verify isolation and permission enforcement.
**Acceptance**
1. Given an org, when a project is created, then all resources (domains, keys, emails, webhooks) are scoped to it and invisible to other orgs/projects.
2. Given a key is created, then the secret is shown once and stored hashed; revoking it immediately rejects further use.
3. Given a member with role `viewer`, then write actions are denied; `owner/admin/developer` enforce their documented permissions.

### US4 — Observe every message (Priority: P1)
A developer searches logs and sees the full lifecycle of any message to debug delivery.
**Independent Test:** Send several messages, then filter logs and open one to see its event timeline and rendered content.
**Acceptance**
1. Given sent messages, when filtering by status/domain/tag/date/recipient, then matching messages are returned quickly at volume.
2. Given a message, when opened, then its event timeline (queued→sent→delivered/bounced/complained/opened/clicked), headers, and rendered body are shown.
3. Given a failed message, then a human-readable failure reason is surfaced.

### US5 — Receive signed webhooks (Priority: P1)
A developer registers an endpoint and reliably receives signed delivery/engagement events.
**Independent Test:** Register endpoint, send an email, receive HMAC-signed events; force a failure and confirm retry + replay.
**Acceptance**
1. Given a registered endpoint subscribed to event types, when events occur, then HMAC-signed payloads are POSTed; signature verifies with the documented scheme.
2. Given the endpoint returns 5xx/times out, then delivery retries with backoff and the attempt log records each try.
3. Given a past event, when replayed from the dashboard, then it is re-delivered.

### US6 — Trust deliverability basics (Priority: P1)
The platform protects sender reputation automatically and shows basic deliverability health.
**Independent Test:** Trigger a hard bounce and a complaint via SES simulator; verify auto-suppression and that rates surface with alerts.
**Acceptance**
1. Given a hard bounce or complaint event, then the address is auto-added to project suppression and future sends to it are blocked.
2. Given activity over time, then sends/delivered/bounced/complained/opened/clicked and per-domain bounce/complaint rates are shown.
3. Given bounce or complaint rate crosses a threshold, then an alert is raised.

### US7 — White-label foundations (Priority: P2)
An org runs the dashboard under its own brand/domain and a reseller sees per-sub-tenant usage.
**Independent Test:** Set custom domain + logo/colors and a "powered-by" toggle; as a reseller, view a sub-tenant usage rollup and export it.
**Acceptance**
1. Given org branding (custom dashboard domain, logo, colors), then the dashboard renders branded and the "powered by ems" mark can be toggled off.
2. Given a reseller org with sub-tenants, then per-sub-tenant usage (sends, delivered, bounces) rolls up and exports in a billing-ready format.

### US8 — Batch & scheduled send (Priority: P2)
A developer sends batches and schedules future sends with idempotency.
**Acceptance**
1. `POST /emails/batch` accepts multiple messages and reports per-item results.
2. `scheduled_at` queues for future send; a scheduled send can be cancelled before dispatch.
3. A repeated `Idempotency-Key` does not double-send.

## Requirements

### Functional Requirements

**Auth, Orgs, Projects (E1)**
- **FR-001**: System MUST support sign-up/sign-in (credentials + at least one OAuth provider) via Auth.js.
- **FR-002**: System MUST model organizations → memberships (roles: owner/admin/developer/viewer) → projects, with all resources scoped to a project.
- **FR-003**: System MUST enforce tenant isolation at the data-access layer (no cross-org/project read or write).

**Domains & Auth (E2)**
- **FR-010**: System MUST generate a DKIM keypair and derive SPF/DKIM/DMARC (+ optional MAIL FROM, tracking CNAME) records for an added domain.
- **FR-011**: System MUST offer one-click DNS publication via Cloudflare and a copy-paste fallback for any registrar.
- **FR-012**: System MUST verify domain authentication and expose status (pending/verified/failed) with per-record diagnostics and manual re-check.

**API Keys (E3)**
- **FR-020**: System MUST create project-scoped API keys, display the secret once, and store only a hash.
- **FR-021**: System MUST authenticate API requests by key, enforce per-key rate limits, and support immediate revocation.

**Send API — Resend-compatible (E4)**
- **FR-030**: System MUST expose `POST /emails` accepting Resend's payload (from, to, cc, bcc, reply_to, subject, html, text, attachments, headers, tags, scheduled_at) and return a Resend-compatible response.
- **FR-031**: System MUST expose `POST /emails/batch`, `GET /emails/:id`, scheduled-send cancellation, and honor an `Idempotency-Key`.
- **FR-032**: System MUST validate payloads and return actionable, Resend-compatible errors; MUST enforce suppression pre-dispatch.

**Delivery Pipeline (E5)**
- **FR-040**: System MUST enqueue accepted sends durably (BullMQ) and dispatch via a `MailProvider` (v1: SES) — no silent send loss.
- **FR-041**: System MUST ingest SES/SNS notifications (delivery, bounce, complaint, reject, open, click) and persist events.
- **FR-042**: System MUST auto-suppress on hard bounce/complaint and retry transient failures per policy.
- **FR-043**: The provider seam MUST allow adding SMTP/multi-provider/own-MTA later without changing the public API.

**Logs & Observability (E6)**
- **FR-050**: System MUST provide searchable email logs (filters: status, domain, tag, date, recipient) backed by an analytics store for high-volume querying.
- **FR-051**: System MUST show per-message event timeline, headers, rendered content, and human-readable failure reason.

**Webhooks (E7)**
- **FR-060**: System MUST let projects register endpoints and subscribe to event types.
- **FR-061**: System MUST deliver HMAC-signed payloads with retries+backoff, an attempt log, and manual replay.

**Deliverability basics (E8) & White-label (E9)**
- **FR-070**: System MUST surface sends/delivered/bounced/complained/opened/clicked and per-domain bounce/complaint rates with threshold alerts.
- **FR-071**: System MUST screen signups/sends for abuse (disposable domains, anomalies) and apply expandable per-tenant sending caps.
- **FR-080**: System MUST support per-org branding (custom dashboard domain, logo, colors, powered-by toggle) and custom sending/tracking domains.
- **FR-081**: System MUST roll up per-sub-tenant usage for resellers and export it in a billing-ready format.

### Non-Functional Requirements
- **NFR-001**: Implementation MUST pass project quality gates (lint, typecheck, focused tests) before release.
- **NFR-002**: Send-accept latency p99 < 300ms; enqueue is durable (survives worker restart).
- **NFR-003**: Webhooks are at-least-once with idempotent, signed payloads.
- **NFR-004**: Secrets (API keys) hashed at rest; sensitive payload fields encrypted at rest; tenant isolation enforced.
- **NFR-005**: Compliance-ready: `List-Unsubscribe`/RFC-8058 for any non-transactional stream, GDPR export/delete, Google/Yahoo bulk-sender alignment.

## Data Model

Postgres (control plane): `organizations`, `memberships`, `projects`, `domains` (dkim keys, dns/verification status, tracking domain, region), `api_keys` (hashed, scoped), `emails` (message record + idempotency_key + scheduled_at), `email_events`, `suppressions`, `webhook_endpoints`, `webhook_deliveries`, `usage_records`. High-volume `email_events`/logs mirrored to ClickHouse/Tinybird for analytics. (Full model in `.bootspring/context/ARCHITECTURE.md`.)

## Edge Cases
- Send to suppressed/invalid/disposable address → blocked with clear reason, not silently dropped.
- Domain unverified or DKIM misaligned → send warned/blocked per policy; never silently spam-foldered.
- Duplicate `Idempotency-Key` → single send.
- SES throttling / transient 4xx → ret/backoff without losing the message.
- Webhook endpoint down → retries, then dead-letter + replay; never blocks sending.
- Cross-tenant access attempt → denied and audited.
- Abusive send pattern → capped/kill-switched without harming other tenants' shared-IP reputation.

## Success Criteria
- **SC-001**: From a fresh checkout, a reviewer can run documented commands to sign up, verify a domain (Cloudflare one-click), create a key, send via the `resend` SDK (base-URL swap), see delivery in logs, and receive a signed webhook.
- **SC-002**: Required tests pass in the repo's standard runner; quality gates green.
- **SC-003**: A hard bounce/complaint (SES simulator) auto-suppresses and surfaces in analytics.
- **SC-004**: Tenant isolation verified by test (no cross-project data access).

## Assumptions
- A dedicated AWS SES account with production access (out of sandbox) is available; SNS topics wired to the event ingestor.
- Deployment on Coolify + Cloudflare (DNS/edge/R2), Postgres + Redis on the fleet, per `.bootspring/context/ARCHITECTURE.md`.
- Foundation/licensing per DECISIONS D1 (freeresend MIT base; usesend clean-room only).
- Marketing/automation, dedicated IPs/warmup, inbox-placement testing, and BYO-SES are **out of scope** for this slice (Phases 2–4).
