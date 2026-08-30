# ems — Deliverability

**Generated:** 2026-06-20
**Status:** Draft v1

> Deliverability is our durable differentiator. Resend has DX; Postmark has deliverability; **we ship both, self-serve, white-label.** This doc defines the subsystem that makes "it reached the inbox" a measurable product promise.

## North star

**Inbox-placement rate**, not "sent" or even "delivered." We instrument and surface where mail actually lands.

## Pillars

### 1. Authentication & alignment (Phase 1 baseline)
- Auto-generate **DKIM** keys; derive **SPF**, **DMARC**, optional custom **MAIL FROM**, and tracking-domain **CNAME**.
- **One-click DNS** via Cloudflare (our fleet) first; copy-paste records for any registrar; live re-verification.
- **DMARC policy guidance** (none → quarantine → reject) with a readiness checker.
- **BIMI** support (record + VMC guidance) once DMARC at enforcement.
- Alignment is a *gate*: warn before sending on misaligned/unverified domains.

### 2. Reputation & IP strategy (Phase 2)
- **Shared IP pools** (well-managed, abuse-screened) for low volume / free tier.
- **Dedicated IP pools** for scale customers; pool-per-tenant or pool-per-stream (transactional vs marketing separated — never mix reputations).
- **Automated IP warmup**: ramp schedules that throttle send volume per IP/day, auto-adjusting to engagement & bounce signals via BullMQ-paced workers.
- **Reputation dashboard**: per-domain/per-IP bounce %, complaint %, deferrals, trend, and a composite score with alerts.

### 3. List hygiene & suppression (Phase 1 → 2)
- **Automatic suppression** on hard bounce & complaint; per-project suppression list enforced *pre-send*.
- Suppression UI: view/search/export, manual add/remove with reason + audit.
- Optional **address validation** (syntax, MX, disposable/role detection) before send.
- Engagement-based hygiene (Phase 3): sunset disengaged recipients for marketing streams.

### 4. Inbox-placement & monitoring (Phase 2)
- **Seed-list / inbox-placement tests**: send to seed accounts across major mailbox providers, report folder placement (inbox/spam/missing) per provider.
- **Blocklist monitoring**: watch sending IPs/domains against major RBLs; alert on listing.
- **DMARC aggregate report ingestion**: parse `rua` reports → who's sending as you, alignment failures, spoofing.
- **Feedback loops (FBLs)** where available → complaint capture beyond SES.

### 5. Abuse prevention (Day 1 — protects everyone's reputation)
- Signup screening (disposable domains, risk scoring); send-pattern anomaly detection.
- Per-tenant sending caps that expand with verified reputation; isolation so one bad actor can't poison shared pools.
- Content/spam scoring (SpamAssassin-style) as advisory pre-send check.
- Clear AUP; fast kill-switch for abusive tenants. **This is existential** — shared infra means one abuser hurts all tenants.

### 6. Compliance & standards
- **One-click unsubscribe (RFC 8058)** + `List-Unsubscribe` headers for marketing.
- **Google/Yahoo bulk-sender requirements** alignment (auth, low complaint rate, easy unsubscribe).
- GDPR/CCPA: data export/delete, EU sending region option, DPA-ready.

## Phasing

- **Phase 1 (with Transactional Core):** DKIM/SPF/DMARC auto-setup + one-click Cloudflare DNS, verification, automatic suppression on bounce/complaint, basic bounce/complaint-rate alerts, signup abuse screening.
- **Phase 2 (Deliverability Suite):** dedicated IPs + warmup, suppression UI, inbox-placement testing, blocklist + reputation dashboards, DMARC report ingestion, BIMI.
- **Phase 3+:** engagement-based hygiene, cross-tenant reputation ML for routing, deeper FBL coverage.

## Metrics surfaced to customers

Bounce rate, complaint rate, delivery rate, **inbox-placement % by provider**, reputation score & trend, blocklist status, DKIM/SPF/DMARC/BIMI health, warmup progress.

## Why this is a moat

We observe placement and reputation signals across many tenants → smarter routing, warmup, and proactive alerts than any single sender (or raw SES) can achieve alone. See [[COMPETITORS]].

## Related

See [[ARCHITECTURE]], [[PRD]], [[ROADMAP]], [[BUSINESS_MODEL]].
