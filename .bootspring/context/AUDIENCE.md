# ems — Audience

**Generated:** 2026-06-20
**Status:** Draft v1

## Who we are for

We sell to the person who writes (or owns) the line of code that sends an email. Then we expand to the person who owns the customer relationship.

## Beachhead ICP (land here first)

**Indie & SMB SaaS developers shipping transactional email.**

- 1–25 person teams, technical founder or small eng team.
- Already on Resend, SendGrid, Mailgun, Postmark, or raw SES — and unhappy.
- Send 10k–2M emails/month: password resets, magic links, receipts, notifications.
- Buy with a credit card, self-serve, no sales call. Decision driver: "make this stop being a problem in an afternoon."
- **Wedge:** Resend-compatible API = migrate in minutes; deliverability tooling = stay forever.

## Primary personas

### 1. "Ship-it" Sam — Full-stack / founding engineer (champion + buyer)
- **Job:** get reliable transactional email live and never think about it again.
- **Pain:** spam folder complaints, cryptic bounces, surprise bills, bad docs.
- **Wins with:** drop-in SDK, great logs, guided DKIM/DMARC, webhooks that just work.

### 2. "Deliverability" Dana — Growth/lifecycle or platform eng at scaling SaaS
- **Job:** protect sender reputation, hit the inbox at volume, prove it to stakeholders.
- **Pain:** no inbox-placement visibility, shared-IP contamination, no warmup tooling.
- **Wins with:** dedicated IP pools, warmup automation, reputation + placement dashboards, suppression management.

### 3. "Reseller" Riley — Agency / platform / vertical-SaaS owner (expansion + moat)
- **Job:** offer email to *their* clients under *their* brand, bill margin on top.
- **Pain:** nobody offers true white-label; SES-from-scratch is a project they don't want to own.
- **Wins with:** multi-tenant orgs, white-label dashboard + sending domains, per-tenant branding, usage rollups & billing hooks.

### 4. "Lifecycle" Lin — Marketer/PM at an existing ems customer (future land-and-expand)
- **Job:** launch onboarding sequences, feature-launch announcements, re-engagement — triggered by product events.
- **Pain:** marketing tools live divorced from product data; double integration, double cost.
- **Wins with:** automations & journeys on the same event stream, contacts/segments, broadcasts — no new vendor.

## Anti-personas (not now)

- Pure bulk/cold-email blasters and gray-area senders (deliverability poison — actively screened out).
- Enterprise procurement-led deals requiring SOC2/contract before any value (revisit post-PMF).
- Non-technical SMB marketers wanting a Mailchimp clone (we come at marketing *through* developers).

## How they find us

- Migration content ("Resend alternative", "SendGrid alternative", "self-host transactional email"), great docs that rank, SDK READMEs, and the agency network reselling under their own brand.

## Related

See [[VISION]], [[MARKET]], [[COMPETITORS]], [[BUSINESS_MODEL]].
