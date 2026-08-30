# ems — Architecture

**Generated:** 2026-06-20
**Status:** Draft v1

## Guiding principles

- **Resend-compatible at the edge** — the public API mirrors Resend so the `resend` SDK works with a base-URL swap.
- **Provider abstraction at the core** — SES is the first sending backend behind a `MailProvider` interface; SMTP relays, multi-provider routing, and our own MTA slot in later with zero customer code change.
- **Multi-tenant from the first migration** — org/project scoping is in the schema, not bolted on.
- **MIT-clean foundation** — build on freeresend (MIT); usesend (AGPLv3) is clean-room inspiration only. See [[DECISIONS]].
- **Deliverability is a subsystem, not a feature** — events, suppression, reputation, and warmup are first-class. See [[DELIVERABILITY]].

## Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard / web | **Next.js 15 (App Router) + TypeScript** | Matches both starters; great DX; SSR for dashboard |
| UI | **Tailwind + shadcn/ui** | Fast, white-label-themeable |
| Public API | **Hono** (edge-friendly) | usesend's choice; fast, portable, clean for the Resend-compat surface |
| Internal API | **tRPC** (dashboard ↔ backend) | Typesafe internal calls |
| Control-plane DB | **Postgres + Prisma** | Tenants, domains, keys, webhooks, suppression, billing |
| Queue / jobs | **Redis + BullMQ** | Durable send queue, retries, scheduling, warmup throttling |
| Event/analytics store | **ClickHouse** (or Tinybird) | High-volume email events, logs, analytics at scale |
| Object storage | **Cloudflare R2** | Attachments, assets, DMARC reports — aligns with fleet |
| Sending substrate | **AWS SES** (v1: us-east-1 + regions) behind `MailProvider` | Cheap, reliable, DKIM/SNS; abstracted for future |
| Auth | **Auth.js (NextAuth)** | Both starters use it; OAuth + credentials + SSO later |

## High-level topology

```
                ┌─────────────── Customer's app ───────────────┐
                │   resend SDK (base_url → ems) / our SDK │
                └───────────────────────┬──────────────────────┘
                                         │ HTTPS (API key)
                              ┌──────────▼───────────┐
                              │  Public API (Hono)    │  Resend-compatible
                              │  authn, rate-limit,   │  /emails /emails/batch
                              │  validate, suppress   │  /domains /api-keys ...
                              └──────────┬───────────┘
                  enqueue (durable)      │
                              ┌──────────▼───────────┐        ┌───────────────┐
                              │   Redis + BullMQ      │───────▶│  Send Workers │
                              │   (send/schedule/warm)│        │  MailProvider │
                              └──────────┬───────────┘        │   → AWS SES   │
                                         │                     └──────┬────────┘
        SES events (SNS/EventBridge)     │                            │ send
                              ┌──────────▼───────────┐                ▼
                              │  Event Ingestor       │◀──── delivery/bounce/
                              │  → suppression rules   │      complaint/open/click
                              │  → ClickHouse (events) │
                              │  → Postgres (state)    │
                              └──────────┬───────────┘
                                         │ fan-out
                              ┌──────────▼───────────┐     ┌──────────────────┐
                              │ Webhook dispatcher    │────▶│ Customer endpoint │ (HMAC-signed, retried)
                              └───────────────────────┘     └──────────────────┘

   Next.js Dashboard (tRPC) ── reads Postgres + ClickHouse ── manages all of the above
```

## Data model (control plane — initial)

- `organizations` (white-label brand, plan, custom domain) → `memberships` (user, role)
- `projects` (scopes everything) → `domains` (DKIM keys, DNS/verification status, region, tracking domain)
- `api_keys` (hashed, scoped, rate limits)
- `emails` (message record: from/to, subject, status, tags, scheduled_at, idempotency_key)
- `email_events` (delivered/bounced/complained/opened/clicked — also in ClickHouse for analytics)
- `suppressions` (per-project: address, reason, source, created_at)
- `webhook_endpoints` + `webhook_deliveries` (attempts, status, signature)
- `ip_pools` + `dedicated_ips` + `warmup_schedules` (Phase 2)
- `contacts`, `segments`, `broadcasts`, `automations`, `templates` (Phase 3)
- `usage_records` (metering for billing & reseller rollups)

## The `MailProvider` abstraction (core seam)

```ts
interface MailProvider {
  send(msg: NormalizedMessage): Promise<{ providerMessageId: string }>;
  verifyDomain(domain: Domain): Promise<DnsRecord[]>;       // DKIM/SPF/etc.
  getDomainStatus(domain: Domain): Promise<VerificationStatus>;
  // event ingestion handled per-provider (SES→SNS, SMTP→relay hooks)
}
// v1: SesProvider. Later: SmtpRelayProvider, MultiProviderRouter, OwnMtaProvider.
```

Routing policy (later) chooses provider/IP-pool per message based on tenant plan, domain reputation, and warmup state — without changing the public API.

## Deployment (aligned to the existing fleet)

- **Run on Coolify** (Hostinger VPS fleet) for dashboard + API + workers; containerized per the starters' Docker support.
- **Cloudflare** for DNS automation (the one-click domain verify path), R2 storage, and edge in front of the API.
- **Postgres** self-hosted (fleet pgvector box) or Neon; **Redis** on the fleet; **ClickHouse** self-hosted or Tinybird to start.
- **AWS SES** account dedicated to ems; production access (out of sandbox) + per-region identities; SNS topics → event ingestor.
- This keeps early infra cost low and uses infrastructure we already operate (see fleet/Cloudflare skills).

## Build approach: reuse vs clean-room

- **From freeresend (MIT) — reuse/adapt directly:** Resend-compatible request/response shapes, SES send path, DKIM key generation & DNS record derivation, API-key format & middleware, webhook-from-SES handling.
- **From usesend (AGPLv3) — clean-room re-implement (patterns, not code):** Hono public-API structuring, BullMQ queue design, ClickHouse analytics modeling, the email editor approach, broadcasts/scheduling. **Do not copy AGPL source into the proprietary product.**
- **Net-new for us:** multi-tenant white-label spine, deliverability suite, dedicated-IP/warmup, reseller rollups, automations on the unified event stream.

## Open technical decisions

Tracked in [[DECISIONS]]: ClickHouse vs Tinybird; Hono-everywhere vs Next route handlers; SES-only v1 vs early SMTP; own-MTA timing; DB host (Neon vs self-hosted); analytics vendor for inbox placement.

## Related

See [[PRD]], [[DELIVERABILITY]], [[ROADMAP]], [[COMPETITORS]], [[DECISIONS]].
