# ems — Business Model

**Generated:** 2026-06-20
**Status:** Draft v1

> Pricing below is **benchmarked (2026-06-20)** against live competitor pricing + SES COGS (~$0.10/1k). Sourced competitor figures and rationale in [[RESEARCH]]; revisit at launch. See [[DECISIONS]] D9.

## Pricing (v1 — benchmarked 2026-06-20)

| Tier | Price/mo | Included | Overage /1k | Gross margin¹ | Positioning |
|---|---|---|---|---|---|
| **Free** | $0 | 5,000/mo (≤250/day) | — (hard cap) | — | Beats Resend (3k); SendGrid killed free; Postmark only 100. 1 domain. |
| **Pro** | **$18** | 60,000/mo | **$0.70** | ~86% | Undercuts Resend ($20 / 50k) on price *and* volume. 10 domains, full DMARC/auth automation, 7-day logs. |
| **Scale** | **$80** | 150,000/mo → $0.55, then $0.40/1k at 1M+ | **$0.55** | ~82% | Undercuts Resend Scale ($90/100k) & SendGrid Pro ($89.95). SSO, 1 dedicated IP incl., 30-day logs. |
| **White-label / Reseller** | from **$400** + usage | pooled sub-accounts | **$0.30** wholesale | ~67% | Branded domains + dashboards, per-tenant deliverability isolation, usage-billing API. Resellers mark up to ~$0.90 and still win. |

**Add-on — Dedicated IP: $20/mo** (managed warmup incl.). Undercuts SES ($24.95), Resend/SendGrid ($30), Postmark ($50), Mailgun ($59).
¹ vs SES COGS ~$0.10/1k. **Compliance automation** (SPF/DKIM/DMARC, one-click unsubscribe, complaint-rate auto-suspension) is **bundled free at every tier** — now table-stakes under Google/Yahoo rules (see [[DELIVERABILITY]], [[RESEARCH]]).

**Competitor reference (2025–26, sourced — [[RESEARCH]]):** Resend Free 3k · Pro $20/50k · $0.90/1k · IP $30 — Postmark Free 100 · Basic $15/10k · $1.80/1k · IP $50 — SendGrid no-free · Essentials $19.95/50k · IP $30 — Mailgun Free 100/day · Basic $15/10k · $1.80/1k · IP $59 — SES $0.10/1k · IP $24.95.

## Revenue model

**Usage-based SaaS** (per-email tiers) + **seats/features** + **white-label/reseller margin** + **deliverability add-ons**.

### 1. Self-serve volume tiers (beachhead — transactional)
- **Free:** generous dev tier (e.g. ~3k emails/mo, 1 domain, shared IP, full API/logs/webhooks) — the migration on-ramp.
- **Pro:** monthly base + included volume, overage per-1k, dedicated IP available as add-on.
- **Scale:** higher base, lower overage, dedicated IP pools + warmup included, priority support, SSO.
- Marketing/lifecycle metered separately (contacts × sends) once shipped.

### 2. White-label / reseller (expansion + moat)
- **Platform plan:** flat platform fee + per-sub-tenant or per-volume pricing; reseller sets their own client pricing and keeps the margin.
- Custom dashboard domain, branding, and usage rollups for billing their clients.
- This is the highest-LTV, lowest-churn segment — clients are *their* clients.

### 3. Deliverability add-ons (high margin, sticky)
- Dedicated IPs + automated warmup.
- Inbox-placement / seed-list testing.
- Reputation monitoring & blocklist alerts.
- Managed deliverability / onboarding (services attach for agencies).

### 4. BYO-cloud / self-host (enterprise & privacy)
- BYO-SES (customer's AWS account) — they pay AWS at cost, we charge for the control plane.
- Self-hosted license / support contract for regulated or sovereignty-sensitive buyers.

## Unit economics (the core insight)

- **COGS per email is near-zero** (SES ≈ fractions of a cent; our marginal cost is queue/compute/storage of events). We sell **control plane + deliverability + brand**, not bytes.
- Gross margin should be **high (target 80%+)** at the control-plane layer; protect it by *not* racing to the per-email floor — compete on DX, deliverability outcomes, and white-label margin.
- **Dedicated IPs and warmup** convert deliverability anxiety into recurring high-margin revenue.
- **BYO-SES** removes our sending COGS entirely on enterprise while we still charge for the platform.

## Pricing principles

- **Free tier must be genuinely useful** — it is the migration funnel.
- **No surprise bills** — clear overage, alerts, caps. (Anti-SendGrid positioning.)
- **Volume rewards loyalty** — overage drops as you scale, so winning customers stay.
- **White-label priced for margin**, not per-seat nickel-and-diming.

## Key metrics (instrument from day one)

- **North star:** monthly *delivered-to-inbox* volume across active projects.
- Activation: time-to-first-successful-send; % new projects with verified DKIM/DMARC.
- Deliverability: inbox-placement %, bounce %, complaint %, reputation score.
- Growth: paid conversion from free, net revenue retention, # white-label sub-tenants, ARPA.
- Reliability: send API p99 latency, queue lag, webhook delivery success.

## Cost structure

- SES (or substrate) sending fees — pass-through-ish, low.
- Compute (API/edge, workers), Redis, Postgres, analytics store (ClickHouse/Tinybird), object storage (attachments/assets).
- Deliverability infra: dedicated IPs (monthly per IP), seed-list/placement vendor or self-built panel.
- The agency/Coolify/Cloudflare fleet alignment keeps infra spend lean early (see [[ARCHITECTURE]]).

## Why this compounds

Land on cheap, sticky transactional → attach dedicated IPs/deliverability → expand into metered marketing/lifecycle → multiply via white-label resellers who bring their own client bases. Each layer raises ARPA and switching cost.

## Related

See [[VISION]], [[MARKET]], [[AUDIENCE]], [[ROADMAP]], [[DELIVERABILITY]], [[DECISIONS]].
