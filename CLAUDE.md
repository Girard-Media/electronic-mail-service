# Electronic Mail Services (EMS) — AI Context

**Domain:** electronicmailservices.com · **App:** app.electronicmailservices.com
**Status:** Phase 0 — forked from `usermails` 2026-08-30, schema extended, not yet deployed
**Lineage:** hard fork of `usermails`. See `planning/lineage/FORK.md`.

---

## What this is

**Cold B2B outreach infrastructure that we own end to end** — our metal, our IPs, our MTA,
our mail log. Competitors (Instantly, Smartlead, Lemlist, Apollo) resell Google/Microsoft
mailboxes or third-party SMTP; they see "accepted by Google," not "delivered by the
receiving MX." We read the Postfix maillog, so our numbers are measurements.

It is a fleet-management and scheduling system that happens to emit email. Closer to
Kubernetes than to Mailchimp. **Reputation is the scarce resource; the product is a
reputation budget allocator.**

**What this is not:** an opt-in ESP. That is `usermails`. The moment a lead opts in, they
leave EMS via the handoff. Do not add lifecycle marketing here.

---

## Read before writing code

| Document | What it settles |
|---|---|
| `planning/VISION.md` | First principles, what we refuse to build |
| `planning/ARCHITECTURE.md` | The ten-stage send path, invariants I1–I7, the router |
| `planning/INFRA.md` | Blast-node fleet, IP diligence, domain strategy |
| `planning/COMPLIANCE.md` | Jurisdiction map, consent, suppression, refused capabilities |
| `planning/AI.md` | OpenRouter gateway contract |
| `planning/TODO.md` | The build queue — 2,500 tasks (generated from `planning/backlog/`) |

---

## Send-path invariants — do not break these

Every outbound message passes exactly ten stages. There is **no** code path to the MTA
that skips them.

```
sequence → policy → verify → router → compose → score → pace → emit → observe → attribute
```

- **I1** No unsuppressed send. Checked at policy *and* re-checked immediately before emit. A send to a suppressed address is a Sev-1.
- **I2** No unauthenticated domain. SPF + DKIM(2048) + DMARC + forward-confirmed PTR, or it does not leave `PENDING`.
- **I3** No cap violation. Four token buckets decrement atomically. Empty bucket → defer, never overflow.
- **I4** Message-ID is the join key for maillog correlation, bounce attribution, threading, and unsubscribe.
- **I5** Every policy, route, score, and pace decision is written to an auditable record.
- **I6** Reputation comes only from maillog lines, DNSBL, DMARC/TLS-RPT, FBL/ARF, and seed probes. Never from a vendor counter.
- **I7** Blocked by default. Unresolvable jurisdiction, unverified domain, missing consent basis → block and log. Never "assume allowed."

**Deferral is a first-class success.** A slow campaign is correct; a burned domain is not.

---

## Hard constraints

- **Licence boundary.** Base lineage is **freeresend (MIT)**. **usesend is AGPLv3 — clean-room inspiration only.** Never copy usesend source into this proprietary product.
- **Third-party surface.** Hosting (Hostinger, Cloudflare) and AI inference (OpenRouter) only. Stripe and a domain registrar are behind `BillingProvider` / `RegistrarProvider` seams. Everything else is ours. If a dependency goes dark, EMS must still send and still report honestly.
- **Reputation separation.** EMS **never** sends through `31.220.104.223` (the hostssh hub / `usermails` transactional MTA). Different boxes, IPs, PTRs, DKIM keys, bounce domains, mail logs.
- **Honesty.** No number is displayed that we cannot source. `delivered` means the receiving MX returned 250, read from our own log.
- **Open tracking is OFF by default.** Apple MPP made open rates fiction and pixels are a placement liability.

---

## Refused capabilities — never add these

Header/From forgery · domain spoofing · open relay · `RE:`/`FW:` on a first touch ·
invisible text, homoglyphs, or zero-width padding · hidden or delayed unsubscribe ·
cross-customer fake-engagement warmup pools · purchased lists with no provenance ·
sending for an unidentified customer · a "deliverability score" we cannot decompose ·
opt-in lifecycle marketing.

The line: **every deliverability feature here is what a good sender does** — authenticate,
warm up, pace, keep lists clean, honour opt-outs, monitor reputation. We do not build tools
whose purpose is to defeat a filter that correctly identified spam.

---

## Tech stack

| Component | Technology |
|---|---|
| Public API | Hono (`apps/api`) |
| Web + cockpits | Next.js 15 App Router (`apps/web`) |
| Workers | BullMQ (`apps/workers`) |
| Language | TypeScript, pnpm monorepo |
| Control plane | Postgres 18 + pgvector on `.211` (decisions, configuration) |
| Observations | ClickHouse on `.211` (transactions, events, series) |
| Ephemeral | Valkey on `.211` (token buckets, suppression set, locks) |
| Objects | Cloudflare R2 (raw MIME, DMARC XML, exports, backups) |
| ORM | Prisma |
| Email substrate | **Our own Postfix + OpenDKIM + rspamd on dedicated blast nodes** |
| Inference | OpenRouter, via `packages/ai` only |
| Hosting | hostssh on the Hostinger fleet — **not Vercel, not Coolify** |

**Store rule:** Postgres holds *decisions and configuration*. ClickHouse holds
*observations*. Valkey holds *nothing that cannot be rebuilt*. Anything a customer or a
regulator could ask us to prove lives in Postgres or R2.

---

## Repo layout

```
apps/
  api  web  workers  maillog-bridge  feedback-ingest
  dmarc-ingest   NEW — RUA + TLS-RPT receiver
  seedbox        NEW — inbox-placement probe agent
  fleet-agent    NEW — per-node agent

packages/
  db  core  providers  sdk  migrate  mcp                    [inherited]
  fleet  router  warmup  reputation  deliverability          NEW
  policy  verify  sequence  leads  inbox  ai  billing  registrar   NEW
```

**Package rule:** anything may depend on `core`/`db`. Cross-domain packages talk through
interfaces. **`router` is the only package permitted to make a final send decision.**

---

## Commands

```bash
pnpm install
pnpm infra:up          # local postgres + valkey + clickhouse
pnpm db:generate && pnpm db:migrate
pnpm dev:api           # :8787
pnpm dev:workers
pnpm typecheck && pnpm lint && pnpm test
pnpm todo:compile      # planning/backlog/*.md → planning/TODO.md

bootspring build next  # next task from planning/TODO.md
```

## Deployment

`git push hostssh main` — one image, sibling deploys for `api`, `web`, `workers`, plus
standalone `dmarc-ingest` and `seedbox`. **Blast nodes are provisioned by
`infra/blast-node/` and are not part of the app image.** Migrations run on boot,
forward-only, expand/contract for anything touching the send path.
