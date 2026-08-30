# ems — PRD

**Generated:** 2026-06-20
**Status:** Draft v1

## Product summary

A white-label, multi-tenant **application-email platform**: a Resend-compatible sending API + a full dashboard for sending, deliverability, logs, webhooks, and (later) contacts & automations — built on AWS SES behind a provider abstraction.

## Product surfaces

1. **Public Email API** (Resend-compatible) — what developers integrate against.
2. **Dashboard** (Next.js) — humans manage domains, keys, logs, deliverability, team, branding, and later marketing.
3. **SDKs** — official `ems` SDKs + documented `resend` SDK drop-in via base-URL override.
4. **Webhooks** — signed event delivery to customer systems.
5. **Admin / white-label control** — org & sub-tenant management, branding, usage/billing rollups.

## MVP scope (Phase 1 — Transactional Core)

The first independently shippable slice. Everything here is required for a developer to migrate off Resend/SES and trust us in production.

### Epics & key requirements

**E1 — Auth, Orgs & Projects (multi-tenant spine)**
- FR: Email/password + OAuth sign-in; organizations contain projects; projects scope all resources.
- FR: Role-based access (owner/admin/developer/viewer) per org.
- FR: Multi-tenancy isolation enforced at the data layer from day one (no retrofit).

**E2 — Domains & Sender Authentication**
- FR: Add a sending domain; system generates DKIM keys + required DNS records (SPF/DKIM/DMARC, optional MAIL FROM, tracking CNAME).
- FR: One-click DNS via supported providers (Cloudflare first, given our fleet); copy-paste fallback for any registrar.
- FR: Live verification + status (pending/verified/failed) with re-check.

**E3 — API Keys**
- FR: Create/revoke scoped API keys per project; keys shown once, stored hashed.
- FR: Resend-compatible key usage; rate limits + per-key usage visible.

**E4 — Send Email API (Resend-compatible)**
- FR: `POST /emails` accepting Resend's payload (from, to, cc, bcc, reply_to, subject, html, text, attachments, headers, tags, scheduled_at).
- FR: `POST /emails/batch`, `GET /emails/:id`, cancel scheduled, idempotency keys.
- FR: Validation with actionable errors; suppression-list enforcement pre-send.
- NFR: Send-accept p99 < 300ms; durable enqueue (no lost sends).

**E5 — Delivery Pipeline (queue + SES + events)**
- FR: Durable queue → SES send → ingest SES/SNS notifications (delivery, bounce, complaint, reject, open, click).
- FR: Automatic suppression on hard bounce / complaint; retry policy for transient failures.
- FR: Provider abstraction so SES is swappable/extensible (SMTP relay, multi-provider, own MTA).

**E6 — Logs & Email Observability**
- FR: Searchable email log (status, recipient, subject, tags, timestamps) with full event timeline per message.
- FR: Filter by status/domain/tag/date; view rendered content & headers; explain *why* it failed.
- NFR: Logs queryable at high volume (analytics store).

**E7 — Webhooks**
- FR: Register endpoints per project; subscribe to event types; HMAC-signed payloads; retries w/ backoff; delivery log + manual replay.

**E8 — Dashboard analytics (deliverability basics)**
- FR: Sends/delivered/bounced/complained/opened/clicked over time; per-domain reputation summary; bounce/complaint rate alerts.

**E9 — White-label foundations**
- FR: Custom dashboard domain + logo/colors per org; custom tracking/sending domains; "powered by" toggle.
- FR: Reseller view: list sub-tenants, per-tenant usage rollup (billing-ready export).

### MVP acceptance (the "definition of trust")
- A developer can: sign up → add & verify a domain via Cloudflare in minutes → create a key → send via the `resend` SDK by changing one base URL → see it delivered in logs → receive a signed webhook. With no spam-folder surprise on a properly authenticated domain.

## Phase 2 — Deliverability Suite (see [[DELIVERABILITY]])
Dedicated IP pools, automated warmup, suppression management UI, inbox-placement/seed testing, blocklist & reputation monitoring, DMARC report ingestion, BIMI support.

## Phase 3 — Contacts & Marketing/Lifecycle
Contacts & segments, broadcasts, email editor (React Email / block editor), templates, A/B, unsubscribe & preference center, automations/journeys triggered by **the same event stream** (and product events via API/webhooks).

## Phase 4 — Scale, Enterprise & White-label depth
BYO-SES, self-host distribution, multi-provider routing, SSO/SAML/SCIM, audit logs, regional sending, usage-based billing integration, marketplace/agency program.

## Out of scope (explicitly, for now)
- Cold/outbound sales sequencing; full CRM; SMS/push (possible later via same automation engine).
- IMAP / Apple Mail / Outlook clients (hosted webmail + forwarding ships first; IMAP is inbox Wave 3).
- From-preserving alias forwarding (needs ARC). v1 forwards a DKIM-aligned copy from the mailbox.

## In scope now (was Phase 2+ inbound)
Hosted mailboxes: receive at `name@verified-domain`, dashboard Inbox, catch-all, verified store-and-forward, `email.inbound` webhook. MX must point at `mail.electronicmailservices.com`; never steal a live Google/Microsoft apex MX.

## Non-functional requirements
- **Deliverability first:** authenticated-domain sends should reliably reach inbox; suppression enforced; abuse screening on signup & send.
- **Reliability:** durable queue, at-least-once webhook delivery, no silent send loss.
- **Security:** keys hashed, payload encryption at rest for sensitive fields, tenant isolation, signed webhooks, audit trail.
- **Compliance-ready:** one-click unsubscribe (RFC 8058) for marketing, list-unsubscribe headers, GDPR data export/delete, Google/Yahoo bulk-sender alignment.
- **Performance:** fast send-accept, high-volume log/event querying.

## Related

See [[VISION]], [[ARCHITECTURE]], [[DELIVERABILITY]], [[ROADMAP]], [[AUDIENCE]], [[DECISIONS]].
