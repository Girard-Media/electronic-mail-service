# ems — Decisions & Open Questions

**Generated:** 2026-06-20
**Status:** Living doc

Captures the genuine forks. Each has a **recommendation**; flagged ones (★) change architecture, legality, or cost.

## Accepted (2026-06-20 — "continue with all")

### ★ D1 — Foundation & license — **ACCEPTED**
**Decision:** Build on **freeresend (MIT)**; use **usesend (AGPLv3) as clean-room inspiration only** (re-implement patterns, never copy source).
**Why:** AGPLv3's network-use copyleft would force us to release source of a hosted, white-label, proprietary product (or buy a commercial license). MIT lets us build closed and resell. freeresend also already gives us the Resend-compatible contract + SES/DKIM wiring.
**Override path:** If later willing to open-source or license usesend commercially, forking it would jump-start features — a deliberate legal/business call, not a default.

### D2 — Sending substrate — **CHANGED 2026-06-20: OWN INFRASTRUCTURE (no AWS)**
Per direction, ems sends on **its own self-hosted infrastructure** — NOT AWS SES. The `MailProvider` seam targets a custom **SMTP/MTA** (`SmtpProvider`, configured via `SMTP_URL`) on the fleet with dedicated IPs + DKIM signing. Until the MTA is online the worker runs in stub mode (`SES_STUB=true` marks messages sent for end-to-end testing) — **no AWS is called at runtime**. `SesProvider` stays in `packages/providers` only as an optional seam reference; it is no longer imported. Standing up the MTA (PowerMTA/Haraka/Postal-class) is the next infra task. (Supersedes the original SES-first decision.)

### D3 — Compatibility surface — **ACCEPTED**
Lead with **Resend API compatibility** (drop-in via base URL) as the primary wedge; ship our own SDK as a superset. Zero switching cost is the biggest growth lever and also captures raw-SES users.

### D4 — Deployment fabric — **ACCEPTED** (grounded in real fleet, see [[INFRA]])
Deploy api+dashboard+workers on the **Coolify App box .207** (`31.220.104.207`, railpack + Node 22). **Postgres 18 + pgvector and shared Valkey/BullMQ on the Data box .211** (`10.10.0.2:5432` / `:6432` / `:6379`). **Cloudflare** for DNS (`Zone:DNS:Edit` token), R2, edge. Analytics: start **Tinybird** (D10). **SES has no standing AWS infra** — provision via the AWS API MCP; request production access early. Uses infra we already operate → near-zero new infra cost.

### D5 — Multi-tenancy & white-label timing — **ACCEPTED**
Build the org/project tenant spine and white-label foundations **in Phase 1**, not retrofitted. White-label is a core value and a moat; retrofitting tenancy is painful.

### D6 — Marketing comes through developers — **ACCEPTED**
Sequence marketing/lifecycle **after** transactional + deliverability, on the same event stream. Transactional is the acute pain and trust-builder.

### ★ D7 — Product name & domain — **ACCEPTED**
Product **ems**, domain **electronicmailservices.com** confirmed final. (Action: verify domain ownership/registration is in hand.)

## In progress

### ★ D8 — Real market sizing — **RESEARCH IN PROGRESS (2026-06-20)**
[[MARKET]] figures were planning order-of-magnitude. A sourced TAM/SAM/SOM + competitor pricing teardown is running (background research agent); findings fold into [[MARKET]].

### D9 — Pricing specifics — **RESEARCH IN PROGRESS (2026-06-20)**
Concrete tiers (free-tier limits, per-1k overage, dedicated-IP $/mo, white-label platform fee) being benchmarked to live SES cost + Resend/Postmark/SendGrid/Mailgun; findings fold into [[BUSINESS_MODEL]].

## Open — revisit during build

### D10 — Analytics store
ClickHouse (self-host, more ops) vs **Tinybird** (managed, faster start). Lean Tinybird for speed-to-MVP, revisit at scale.

### D11 — API framework split
Hono-everywhere vs Next.js route handlers for the public API. **Going with Hono** for the public API (portable, clean Resend-compat surface); confirm ergonomics during Phase 0 spike.

### D12 — Own-MTA timing
When (if) to run our own MTA (PowerMTA/Haraka/Postal) vs SES + relays. Driven by SES policy risk, margin at scale, deliverability control. Decide in Phase 4 with real volume.

### D13 — Region & compliance scope
EU sending region + SOC2/GDPR DPA timing. Likely Phase 4; agency/enterprise demand could pull forward.

### D14 — Build vs buy: inbox placement
Build a seed-list panel vs integrate a vendor (GlockApps/Inbox-style). Buy first, build later.

## Decision log

| ID | Decision | Status | Owner | Date |
|---|---|---|---|---|
| D1 | freeresend MIT base; usesend clean-room only | Accepted | sgirard | 2026-06-20 |
| D2 | SES-only v1 behind MailProvider | Accepted | sgirard | 2026-06-20 |
| D3 | Resend-compat as primary wedge | Accepted | sgirard | 2026-06-20 |
| D4 | Coolify + Cloudflare deploy fabric | Accepted | sgirard | 2026-06-20 |
| D5 | Tenancy + white-label in Phase 1 | Accepted | sgirard | 2026-06-20 |
| D6 | Transactional → deliverability → marketing | Accepted | sgirard | 2026-06-20 |
| D7 | Name ems / electronicmailservices.com | Accepted | sgirard | 2026-06-20 |
| D8 | Real market sizing | Research in progress | sgirard | 2026-06-20 |
| D9 | Pricing specifics | Research in progress | sgirard | 2026-06-20 |
| D10 | Analytics store (lean Tinybird) | Open | — | — |
| D11 | Hono for public API | Leaning accepted | sgirard | 2026-06-20 |
| D12 | Own-MTA timing | Open (Phase 4) | — | — |
| D13 | Region & compliance | Open (Phase 4) | — | — |
| D14 | Inbox-placement build vs buy | Open | — | — |

## Related

See [[VISION]], [[ARCHITECTURE]], [[COMPETITORS]], [[BUSINESS_MODEL]], [[MARKET]], [[ROADMAP]].
