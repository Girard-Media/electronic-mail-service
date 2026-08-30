# ems — Market & Pricing Research

**Generated:** 2026-06-20 (background research agent)
**Status:** Reference — sourced; numbers carry the caveats noted inline.

> Feeds [[MARKET]] (sizing) and [[BUSINESS_MODEL]] (pricing). Resolves [[DECISIONS]] D8/D9.

## 1) Competitor pricing (2025–2026)

| Provider | Free tier | Entry paid | Overage /1k | Dedicated IP /mo | Mktg vs txn |
|---|---|---|---|---|---|
| **Resend** | 3,000/mo (≤100/day), 1 domain | **Pro $20** → 50k (also $35→100k) | **$0.90** (→~$0.46 at scale) | **$30** (needs 500+/day) | Marketing priced by *contacts* (Free→$650/mo for 1k–150k) |
| **Postmark** | 100/mo, no expiry | **Basic $15** → 10k | **$1.80** (Basic); $1.30 (Pro); $1.20 (Platform) | **from $50/IP** (needs 300k+/mo) | "Message Streams" split txn vs broadcast |
| **SendGrid (Twilio)** | **No free tier** (retired May 2025; 60-day trial) | **Essentials $19.95** → 50k | tiered, **opaque** | **$30/IP** (1 incl. on Pro $89.95) | "Email API" vs "Marketing Campaigns" |
| **Mailgun (Sinch)** | 100/day (~3k/mo), 1-day logs | **Basic $15** → 10k | **$1.80** (Basic); $1.30; $1.10 (Scale) | **$59/IP** (1 incl. on Scale) | Mailgun=txn; Mailjet=mktg |
| **Amazon SES** | 3k/mo (first 12mo, new accts) | pure PAYG, no minimum | **$0.10** + $0.12/GB | **$24.95/IP** (Managed: $15 + $0.08→$0.02/1k) | none — raw infra |

Confidence: Resend/Postmark/Mailgun/SES read from vendor pricing pages (Jun 2026). **SendGrid** from aggregators (G2, Costbench, Apr 2026) — official page JS-rendered; per-1k overage not transparently published. SendGrid free-plan retirement confirmed via Twilio changelog.

## 2) Market size

**Caveat:** most "transactional email market" reports are syndicated-report mills with figures that **disagree ~2× on the same base year** — directional only.

- **Transactional email API/software (our segment):** unreliable reports span $2.1B→$7.5B (14.2% CAGR) vs $4.2B→$10.6B (10.8%); narrower, more plausible "transactional email *software*" clusters at **~$1.4–1.75B (2024–25), ~9–12% CAGR**. Broader "Email API Platform": $4.2B (2024) → $16.2B (2033), ~17.6% CAGR.
- **Email marketing software (adjacent, distinct):** ~$1.9–2.0B (2024–25) → ~$3.4–3.5B by 2030, ~9.5–12.2% CAGR.
- **Defensible SAM (developer-bought application email, self-serve SMB→mid-market):** **~$400–700M/yr (2025)** ≈ 25–35% of transactional-software TAM. Estimate, ±50%. A real nine-figure self-serve niche — **not** a $10B self-serve prize.

## 3) Deliverability / regulatory (Google & Yahoo bulk-sender rules, in force since Feb 2024)

Bulk senders (Google: ~5,000+/day to Gmail; Yahoo: high volume) MUST:
- **SPF + DKIM**, ≥1 aligned to pass **DMARC**; publish a DMARC record (`p=none`+).
- **One-click unsubscribe (RFC 8058)** on promotional mail; honor within 2 days.
- Keep spam-complaint rate **< 0.1%**, never exceed **0.3%** (Postmaster Tools).
- Valid forward + reverse DNS (PTR); TLS.

**Implication:** SPF/DKIM/DMARC auto-setup, hosted DMARC reporting, automatic `List-Unsubscribe`, and per-customer complaint dashboards w/ auto-suspension above ~0.3% are **table-stakes**, not premium. (See [[DELIVERABILITY]].)

## 4) Recommended ems pricing

See the table in [[BUSINESS_MODEL]]. Summary: **Free 5k · Pro $18/60k ($0.70/1k) · Scale $80/150k ($0.55/1k) · White-label from $400 + $0.30/1k wholesale · Dedicated IP $20/mo.** Margins ~67–86% vs SES COGS (~$0.10/1k). Strategy: undercut Resend on $/included-volume while matching DX; free tier as acquisition (SendGrid abandoned free); white-label as the structural differentiator; compliance automation bundled free.

## Sources

1. Resend — https://resend.com/pricing
2. Postmark — https://postmarkapp.com/pricing
3. Mailgun — https://www.mailgun.com/pricing/
4. SendGrid (verified Apr 2026) — https://costbench.com/software/email-api/sendgrid/ ; https://www.g2.com/products/twilio-sendgrid-email-api/pricing
5. Amazon SES — https://aws.amazon.com/ses/pricing/
6. Twilio changelog (SendGrid free retirement) — https://www.twilio.com/en-us/changelog/sendgrid-free-plan
7. smtp2go context — https://www.smtp2go.com/blog/sendgrid-has-ended-its-free-plan-we-have-got-you-covered/
8. Transactional email market (LOW confidence): Market Intelo, Dataintelo, Future Market Report, 360 Research Reports (links in agent transcript)
9. Email marketing software market: Mordor Intelligence; Fortune Business Insights; The Business Research Company
10. Google/Yahoo bulk-sender (Feb 2024) — https://support.valimail.com/en/articles/9143173 ; https://www.mailgun.com/state-of-email-deliverability/chapter/yahoogle-bulk-senders/
