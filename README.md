# Electronic Mail Services

Cold B2B outreach infrastructure we own end to end — our metal, our IPs, our MTA, our mail
log. `delivered` means the receiving MX returned `250`, read out of our own Postfix log,
not a vendor's optimistic counter.

**Status:** Phase 0. Hard-forked from [usermails](../usermails) on 2026-08-30; schema
extended for the cold-outreach domain; nothing deployed yet. See `planning/ROADMAP.md`
for the gates.

## What is planned to ship

- Fleet control plane: blast nodes, IPs, sending domains, mailboxes, personas — provisioned and monitored automatically
- Warmup engine: per-mailbox ramp curves with hold/rollback, plus our own peer warmup network
- Router: constrained selection of (node, IP, domain, mailbox) per message, with four token buckets and adaptive per-ESP pacing
- Deliverability: maillog truth, bounce taxonomy, DNSBL, DMARC RUA, TLS-RPT, seed-based inbox placement testing
- Five independent reputation ledgers (IP, domain, mailbox, content, engagement) with different half-lives
- Policy engine: jurisdiction resolution, consent ledger, three-layer suppression — a hard gate in the send path
- Sequences, leads, self-hosted verification, unified inbox with AI reply classification
- Eleven AI tasks on OpenRouter behind one metered, evaluated gateway

## What we will not ship

Header forgery · domain spoofing · `RE:` on a first touch · filter-evasion tricks · hidden
unsubscribes · cross-customer fake-engagement warmup pools · lists with no provenance ·
opt-in lifecycle marketing (that is `usermails`).

## Stack

pnpm monorepo. Hono API · Next.js 15 web · BullMQ workers · Postgres 18 + ClickHouse +
Valkey + R2 · Prisma · own Postfix/OpenDKIM/rspamd blast nodes · OpenRouter for inference.
Deploy: `git push hostssh main`.

Clean-room only vs usesend (AGPLv3). Base lineage: freeresend (MIT).

## Commands

```bash
pnpm install
pnpm infra:up
pnpm db:generate && pnpm db:migrate
pnpm dev:api && pnpm dev:workers
pnpm typecheck && pnpm test
pnpm todo:compile
```

## Docs

Planning: [`planning/INDEX.md`](planning/INDEX.md). Build queue: [`planning/TODO.md`](planning/TODO.md) — 2,500 tasks.
Agent context: [`CLAUDE.md`](CLAUDE.md).
