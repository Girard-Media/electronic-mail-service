# ems

> Cold B2B outreach infrastructure we own end to end — our metal, our IPs, our
> MTA, our mail log — so inbox placement is measured and controlled, not rented
> and hoped for. Lineage: hard fork of `usermails` (transactional); the
> pre-fork seed is archived at `planning/lineage/SEED-usermails.md`.

## Overview

**The Problem:** A business wants to start conversations with companies that
have never heard of them — one email leaving our machine and landing in a
stranger's Primary tab. Incumbents (Instantly, Smartlead, Lemlist, Apollo,
Woodpecker, Reply, Salesforge) all share one structural defect: they do not
own the sending path. They resell Google/Microsoft mailboxes or a third-party
relay, so they see "accepted by Google" instead of "delivered by the receiving
MX," cannot do per-IP warmup/quarantine/remediation, classify bounces by
guessing at strings, share reputation pools across abusive customers, and pass
through per-seat mailbox cost with thin margin.

**Our Solution:** ems is the *acquisition* half to `usermails`' *lifecycle*
half. The moment a lead opts in, they leave EMS via a signed handoff. Every
message runs a 10-stage send path (sequence → policy → verify → router →
compose → score → pace → emit → observe → attribute) guarded by seven
invariants (I1–I7: no unsuppressed send, no unauthenticated domain, no cap
violation, Message-ID join key, auditable decisions, reputation only from our
own measurements, blocked-by-default). Reputation is the propellant; the
product is a reputation budget allocator.

Foundation: hard fork of `usermails` (multi-tenant RBAC, suppression,
webhooks, Postfix sidecar + maillog bridge, provider seam, SDK, MCP) +
**usesend (AGPLv3) clean-room inspiration only** (DECISIONS D1).

---

## Tech Stack

```yaml
stack:
  framework: nextjs        # dashboard (App Router); fleet/API on hono
  language: typescript
  database: postgresql     # decisions + config (prisma); clickhouse for observations
  queue: valkey + bullmq   # per-tenant lanes, fencing-token scheduler claims
  hosting: hostinger vps   # blast-node fleet + data box .211 (NOT vercel)

frontend:
  uiLibrary: shadcn
  styling: tailwind

backend:
  orm: prisma
  api: hono
  email: own-postfix-mta   # behind a MailProvider seam — SMTP, never a vendor relay
  analytics: clickhouse    # self-hosted; events + reputation series + placement
  storage: cloudflare-r2   # raw MIME, DMARC XML, exports, backups
```

---

## Architecture

1. **Fleet (blast nodes)** — per-node Postfix bound to dedicated IPs, rDNS/PTR
   controlled, `maillog-bridge` streaming `250`/deferral/bounce truth.
2. **Router (`packages/router`)** — the only package that makes a final send
   decision: constrained cost-minimization over (node, ip, domain, mailbox);
   deferral is a first-class success.
3. **Policy gate (`packages/policy`)** — jurisdiction + consent + suppression +
   content; versioned packs pinned per campaign; BLOCKED_BY_POLICY with reason.
4. **Sequence engine (`packages/sequence`)** — durable per-enrolment state
   machine; halt-on-reply/bounce/complaint/unsub across all campaigns.
5. **Verification engine (`packages/verify`)** — self-run DNS/SMTP checks from
   dedicated IPs that never burn sender reputation.
6. **Warmup (`packages/warmup`)** — quota-ramped curves as Valkey Lua token
   buckets with auto-hold; strictly per-client pools, never shared.
7. **Deliverability cockpit** — maillog truth, DNSBL, DMARC RUA/TLS-RPT ingest,
   seed probes, per-message timeline keyed by Message-ID.
8. **Dashboard (Next.js + tRPC)** — plain-text-first composer, capacity and
   reputation views, client portals under agency brands.

Full topology + invariants: `planning/ARCHITECTURE.md`. Fleet math:
`planning/INFRA.md`. Legal map: `planning/COMPLIANCE.md`.

---

## Integrations

**Sending:** own Postfix MTA (behind `MailProvider`; Gmail/Outlook only as
migration-compat, never the core path)
**DNS / storage:** Cloudflare (registrar/DNS + R2)
**Database:** Postgres 18 + pgvector (Data box .211)
**Queue/cache:** Valkey (Data box .211)
**Analytics:** self-hosted ClickHouse
**Inference:** OpenRouter (single gateway, cost-capped; human-gated drafts only)
**Payments:** Stripe behind a `BillingProvider` seam (pay-per-verified-delivered)
**Telemetry (read-only, optional):** Google Postmaster / Microsoft SNDS

**Refused:** open tracking on by default, cross-customer warmup pools,
newsletter/lifecycle mode, third-party verification/blacklist/analytics
vendors. Full list: `planning/VISION.md` §7.

---

## MVP Features (Phase 1 — The Fleet + The Product)

1. Blast node #1 alive: own IP, rDNS, DKIM-signing, port-25 egress, `90-verify.sh` green
2. Ten domains + 25 mailboxes provisioned end to end, zero manual steps
3. Warmup ramping unattended with demonstrated hold + rollback
4. Router deciding < 50ms p95 with a readable trace per decision
5. Bounce taxonomy > 98% non-`UNKNOWN` from verbatim SMTP replies
6. Sequence engine: enrol → materialize → halt-on-any-signal
7. Compliance gates that demonstrably block (jurisdiction, consent, suppression, footer)
8. Verification with a published false-valid rate; ambiguous-means-suppressed
9. Per-message timeline + usage metering with zero drift vs raw events
10. Agency spine: scoped keys, per-client DKIM/tracking, cost-plus sub-billing

Detail: `planning/ROADMAP.md` · queue: `planning/TODO.md` (source: `planning/backlog/`).

---

## Implementation Phases

- **Phase 0 — Foundation (days 0–14):** fork green, fleet schema, node #1, policy skeleton, first Gmail `250` from our own maillog.
- **Phase 1 — The Fleet (days 15–35):** warmup, router, maillog→bounce taxonomy, DNSBL/DMARC/TLS-RPT receivers, cockpit v1.
- **Phase 2 — The Product (days 36–60):** sequences, leads, verification, inbox, AI gateway (human-gated), Stripe metering.
- **Phase 3 — GA (days 61–90):** seed placement ≥85% Gmail / ≥75% Microsoft, pentest, DR drill, honesty audit, second-operator week.

Stop conditions (port 25 unobtainable, placement below gate, operator cost,
compliance unworkable): `planning/ROADMAP.md`.

---

*Seed for [Bootspring](https://bootspring.com). Merged context: `planning/SEED.md` (archived original: `planning/lineage/SEED-usermails.md`). Full context docs: `planning/`.*
