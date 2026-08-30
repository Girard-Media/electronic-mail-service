# Implementation Plan: Transactional Core (MVP)

**Spec**: .bootspring/specs/transactional-core/spec.md
**Created**: 2026-06-20

## Summary

Stand up the white-label, multi-tenant, Resend-compatible transactional platform end to end. Strategy: build the **multi-tenant spine + one vertical send slice first** (US1 + the minimum of US2/US3 it needs), get a real email to a real inbox on our infra, then widen to logs, webhooks, deliverability basics, and white-label foundations. Foundation = freeresend (MIT) adapted; usesend (AGPLv3) clean-room only (DECISIONS D1).

## Technical Context

- **Language/Framework:** TypeScript, Next.js 15 (App Router).
- **Public API:** Hono (Resend-compatible surface). **Internal:** tRPC (dashboard ↔ backend).
- **Storage:** Postgres + Prisma (control plane); ClickHouse/Tinybird (events/analytics); Cloudflare R2 (attachments/assets/DMARC reports).
- **Queue:** Redis + BullMQ (send, schedule, webhook dispatch, retries).
- **Sending:** AWS SES behind a `MailProvider` interface (v1 `SesProvider`); SNS → event ingestor.
- **Auth:** Auth.js (credentials + OAuth).
- **Deploy:** Coolify (Hostinger fleet) + Cloudflare (DNS automation, edge); Postgres/Redis on fleet.
- **Testing:** unit (domain logic, provider seam, signing), integration (API + queue + Prisma), e2e (the SC-001 trust path) using SES sandbox/simulator.

## Blueprint Check

- **Traceable:** every task below references FR/US IDs from the spec.
- **Independently testable:** US1 (drop-in send) is shippable on its own; later US's layer on top.
- **Complexity justified:** ClickHouse and dedicated-IP infra deferred (analytics can start on Postgres/Tinybird; IPs are Phase 2). New infra (Redis, SES, analytics store) is justified by NFR-002/050.
- **Quality gates identified:** lint + typecheck + the test tiers above; SC-001 e2e is the launch gate.

## Project Structure (proposed monorepo)

```
apps/
  dashboard/        # Next.js (App Router) + tRPC client + shadcn/ui
  api/              # Hono public API (Resend-compatible)
  workers/          # BullMQ processors: send, schedule, events, webhooks, warmup(P2)
packages/
  db/               # Prisma schema + client (control plane)
  providers/        # MailProvider interface + SesProvider (+ future SMTP/MTA)
  events/           # event ingest + ClickHouse/Tinybird writer
  webhooks/         # signing, dispatch, retry, replay
  core/             # tenancy, suppression, validation, rate-limit, abuse screening
  sdk/              # official ems SDK (+ resend-compat docs)
infra/              # Coolify/compose, Cloudflare config, SES/SNS setup
```
Reuse existing fleet boundaries for deploy; do not introduce infra beyond the table above without revisiting DECISIONS.

## Implementation Strategy (by phase → user slice)

1. **Phase 0 — Foundation spike.** Repo + Prisma + Hono + BullMQ skeleton; `SesProvider.send`; ingest one SNS event; deploy to Coolify; one authenticated email to a real inbox. *(de-risks SES lead time + the seam)*
2. **Phase 1a — Tenant spine (US3/FR-001..003,020,021).** Auth, orgs/projects/RBAC, isolation, API keys.
3. **Phase 1b — Domains (US2/FR-010..012).** DKIM gen, record derivation, Cloudflare one-click + copy-paste, verification.
4. **Phase 1c — Send path (US1/US8/FR-030..032,040..043).** Resend-compatible endpoints, validation, durable enqueue, SES dispatch, idempotency, scheduling, batch.
5. **Phase 1d — Events, suppression, logs (US4/US6/FR-041,042,050,051,070,071).** SNS ingest, auto-suppression, abuse caps, searchable logs + timeline, analytics basics.
6. **Phase 1e — Webhooks (US5/FR-060,061).** Register, sign, dispatch, retry, replay.
7. **Phase 1f — White-label foundations (US7/FR-080,081).** Branding, custom domain, reseller usage rollup.
8. **Verification.** SC-001 e2e trust path green; quality gates; migration docs.

## Key risks & mitigations
- **SES production access lead time** → request in Phase 0.
- **AGPL contamination** → enforce clean-room rule in review; no usesend source imported.
- **Deliverability/abuse on shared IPs** → ship abuse screening + caps in Phase 1d, not later.
- **Resend-compat drift** → contract tests against documented Resend payloads/responses in `packages/sdk`.

## Out of scope (this slice)
Dedicated IPs/warmup, inbox-placement testing, DMARC report ingestion, BIMI, contacts/marketing/automations, BYO-SES, SSO/SAML — see ROADMAP Phases 2–4.
