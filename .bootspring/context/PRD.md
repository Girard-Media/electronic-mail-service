# PRD — EMS

> Canonical: `planning/VISION.md`, `planning/ARCHITECTURE.md`, `planning/TODO.md`
> (2,502 tasks across 24 epics). This is the one-page product statement.

## Problem
Sending cold B2B email at any volume requires operating dozens of small, healthy,
individually-monitored senders. Every existing tool rents that infrastructure, so
nobody can see or control the thing that determines the outcome.

## Product
Four cockpits over one owned sending fleet:

1. **Infrastructure** — nodes, IPs, domains, mailboxes: health, warmup, capacity,
   rotation, retirement. *The thing nobody else can show you.*
2. **Deliverability** — placement by ESP, bounce taxonomy, blacklist status,
   DMARC/TLS-RPT, seed tests, alerts, auto-remediation.
3. **Campaigns** — leads, sequences, scheduling, variants, outcomes.
4. **Inbox** — unified replies, AI classification, handoff to usermails.

## Non-goals (v1)
LinkedIn and SMS channels · a visual HTML email designer · a contact-data
marketplace · opt-in lifecycle marketing · anything in `planning/COMPLIANCE.md` §9.

## Success, measured not asserted
Gmail placement ≥85% and Microsoft ≥75% on warmed domains · hard bounces <2% ·
complaints <0.1% · domain to first safe send ≤14 days unattended · >500 mailboxes
per operator-hour per month · AI cost <$0.40 per 1k sends.

## The single most important requirement
**No number is displayed that we cannot source.** This is what the product sells.
