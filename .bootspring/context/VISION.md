# ems — Vision

**Generated:** 2026-06-20
**Status:** Draft v1

## One-liner

**ems is the developer-first platform for application email** — the email your app *has* to send (transactional today, marketing & lifecycle tomorrow) — delivered with Resend-grade DX, Postmark-grade deliverability, and white-label multi-tenancy built in from day one.

## Problem

Every application sends email, and almost everyone hates how they do it.

- **Transactional email is the acute pain.** Password resets, magic links, receipts, OTPs, invites, alerts. If these are slow, land in spam, or silently fail, users churn and support tickets spike — yet the incumbents make this *harder*, not easier.
- **The legacy giants (SendGrid, Mailgun) have rotted.** Painful APIs, opaque deliverability, shared-IP reputation roulette, console UX from 2014, surprise bills, and support that disappears below enterprise tier.
- **The modern darling (Resend) nailed DX but is a closed box.** No self-host, limited white-label, and pricing that punishes you exactly when you start to win.
- **Deliverability is a black art** nobody hands developers good tools for: no inbox-placement visibility, no guided SPF/DKIM/DMARC/BIMI, no warmup, no reputation dashboard.
- **Agencies and platforms can't resell email under their own brand** without gluing together SES + a dashboard themselves.

## Solution

A single platform that treats application email as a first-class product surface:

1. **Zero-switching-cost migration.** A **Resend-compatible API** — change one base URL and existing `resend` SDK code keeps working. We win by removing the reason not to switch.
2. **Deliverability as a product, not a prayer.** Guided domain auth, dedicated IP pools with automated warmup, suppression/bounce/complaint management, seed-list inbox-placement testing, and a live reputation dashboard.
3. **White-label and multi-tenant from the first commit.** Orgs → projects → domains → keys, custom sending + dashboard domains, per-tenant branding. Agencies and SaaS platforms resell email as *their* feature.
4. **One event stream, two jobs.** The same delivery/engagement events that power transactional observability later power **marketing automation, lifecycle journeys, and CRM** — so customers grow *into* marketing without leaving.
5. **Own your substrate.** Built on AWS SES initially, behind a provider abstraction so we can add SMTP relays, multi-provider routing, and our own MTA without customers ever changing code.

## Why now

- Resend proved developers will pay for email DX — and validated the category — but left self-host, white-label, and marketing on the table.
- SES made world-class sending infrastructure a commodity; the value has moved up to the **control plane, deliverability tooling, and DX**.
- AI-built apps are multiplying the number of apps that need email overnight, each one a buyer.

## Core values

- **Developer experience is the product.** Docs, SDKs, errors, and dashboards that respect the developer's time.
- **Deliverability is non-negotiable.** We measure the inbox, not the "sent" count.
- **Transparent by default.** Clear pricing, clear logs, clear reasons an email failed.
- **White-label native.** Every feature must survive being someone else's brand.
- **Boring reliability.** Email is infrastructure. It should be invisible when it works and loud when it doesn't.

## What success looks like

Developers reach for ems the way they reach for Stripe for payments — the obvious default for application email — and a meaningful share of them are agencies and platforms reselling it under their own name.

## Related

See [[MARKET]], [[COMPETITORS]], [[PRD]], [[ARCHITECTURE]], [[DELIVERABILITY]], [[ROADMAP]], [[BUSINESS_MODEL]].
