# Architecture — EMS

> Canonical source: `planning/ARCHITECTURE.md`.

## The send path — ten stages, no way around them

```
sequence → policy → verify → router → compose → score → pace → emit → observe → attribute
             BLOCK    BLOCK   DEFER            BLOCK   DEFER
```

Deferral is a first-class success. A slow campaign is correct; a burned domain is not.

## Invariants I1–I7

1. **No unsuppressed send** — checked at policy, re-checked immediately before emit.
2. **No unauthenticated domain** — SPF + 2048-bit DKIM + DMARC + forward-confirmed PTR.
3. **No cap violation** — four token buckets decrement atomically; an empty bucket defers.
4. **Message-ID is the join key** for maillog, bounces, threading and unsubscribe.
5. **Every decision is auditable** a year later.
6. **Reputation never comes from a vendor counter** — only maillog, DNSBL, DMARC,
   TLS-RPT, FBL/ARF and seed probes.
7. **Blocked by default.** Never "assume allowed."

## Packages

`router` is the ONLY package permitted to make a final send decision. Anything may
depend on `core`/`db`; cross-domain packages talk through interfaces.

| Package | Owns |
|---|---|
| `fleet` | node/IP/domain/mailbox registry, state machines, capacity |
| `router` | candidate filtering, scoring, deferral, the four token buckets |
| `warmup` | ramp curves, hold and rollback, the peer network |
| `reputation` | the five ledgers and their decay |
| `deliverability` | bounce taxonomy, DNSBL, DMARC, TLS-RPT, placement |
| `policy` | jurisdiction, consent, suppression, CAN-SPAM validation |
| `verify` | self-hosted verification on an isolated IP |
| `sequence` | the durable enrolment state machine |
| `leads` | import, dedupe, segment, enrich |
| `inbox` | threading, classification, handoff |
| `ai` | the single OpenRouter gateway |
| `billing`, `registrar` | the two third-party seams |

## Stores

Postgres holds **decisions and configuration**. ClickHouse holds **observations**.
Valkey holds **nothing that cannot be rebuilt**. R2 holds raw evidence.

## Hard separation from usermails

EMS never sends through `31.220.104.223`. Different boxes, IPs, PTRs, DKIM keys,
bounce domains and mail logs. Transactional and cold-outreach reputation must
never share a blast radius.
