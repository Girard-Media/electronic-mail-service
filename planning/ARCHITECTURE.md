# EMS — Architecture

Implementation contract. If code disagrees with this document, one of them is a bug.

---

## 1. Topology

```
                        ┌─────────────────────────────────────────┐
                        │  app.electronicmailservices.com (Next)  │
                        │  Cockpits: Infra · Deliver · Campaign · Inbox
                        └───────────────┬─────────────────────────┘
                                        │ tRPC-shaped REST + SSE
                        ┌───────────────▼─────────────────────────┐
                        │  apps/api (Hono)                        │
                        │  auth · rbac · rest · sse · webhooks    │
                        └───────────────┬─────────────────────────┘
                                        │
        ┌───────────────────────────────┼────────────────────────────────┐
        │                               │                                │
┌───────▼────────┐          ┌───────────▼──────────┐        ┌────────────▼─────────┐
│ Postgres 18    │          │  Valkey + BullMQ     │        │  ClickHouse          │
│ control plane  │          │  queues + locks      │        │  event/telemetry     │
│ (.211)         │          │  (.211)              │        │  (.211)              │
└────────────────┘          └───────────┬──────────┘        └──────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────┐
                        │  apps/workers                           │
                        │  scheduler · router · sender · warmup   │
                        │  verify · enrich · ai · reputation      │
                        └───────────────┬─────────────────────────┘
                                        │ SMTP (per-node, per-IP bind)
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
┌───────▼─────────┐          ┌──────────▼────────┐         ┌────────────▼──────┐
│ blast-node-01   │          │  blast-node-02    │   ...   │  blast-node-N     │
│ Postfix+OpenDKIM│          │  (future)         │         │                   │
│ IP a.b.c.d      │          │                   │         │                   │
│ maillog-shipper │          │                   │         │                   │
│ inbound-lmtp    │          │                   │         │                   │
└─────────────────┘          └───────────────────┘         └───────────────────┘
```

**Hard separation from `usermails`.** EMS never sends through `31.220.104.223`. Transactional reputation and cold-outreach reputation must not share an IP, a hostname, a PTR, or a maillog. Different boxes, different `myhostname`, different DKIM keys, different bounce domain, different DMARC `rua`. The only link between the two products is an outbound API call at the moment a lead opts in.

---

## 2. Monorepo layout (post-fork)

```
apps/
  api               Hono — REST, auth, SSE, webhooks, tracking, unsubscribe   [inherited]
  web               Next.js 15 — marketing + the four cockpits                [inherited, rebuilt]
  workers            BullMQ processors                                        [inherited, extended]
  maillog-bridge     ships Postfix maillog → API                              [inherited, extended]
  feedback-ingest    ARF/FBL complaint receiver                               [inherited]
  dmarc-ingest       NEW — RUA aggregate XML + TLS-RPT JSON receiver
  seedbox            NEW — inbox-placement probe agent
  fleet-agent        NEW — per-node agent: health, queue depth, IP binding

packages/
  db                 Prisma schema + client                                   [inherited, extended]
  core               env, queue, crypto, dns, dkim, rbac, errors, plans       [inherited]
  providers          MailProvider seam + SMTP/Google/Microsoft/mime/verp      [inherited]
  sdk                public SDK                                              [inherited, reshaped]
  migrate            importer from other platforms                            [inherited, retargeted]
  mcp                MCP server for agent control                             [inherited]

  fleet              NEW — node/IP/domain/mailbox registry + capacity model
  router             NEW — send-path decision engine (the core)
  warmup             NEW — warmup curves, peer network, ramp scheduler
  reputation         NEW — the five ledgers, scoring, DNSBL, decay
  deliverability     NEW — bounce taxonomy, placement, DMARC/TLS-RPT parsers
  policy             NEW — jurisdiction + consent + content compliance gate
  verify             NEW — email verification engine (MX/SMTP/catch-all/trap)
  sequence           NEW — sequence state machine + scheduler
  leads              NEW — import, normalize, dedupe, segment, enrich
  inbox              NEW — threading, classification, handoff
  ai                 NEW — OpenRouter gateway, prompts, evals, budgets
  billing            NEW — BillingProvider seam + metering
  registrar          NEW — RegistrarProvider seam (domain purchase/DNS)
```

**Package rule:** a package may depend on `core`/`db` freely; cross-domain packages talk through interfaces, never through each other's internals. `router` is the only package permitted to make a final send decision.

---

## 3. The send path — the single most important sequence

Every outbound message passes through exactly this pipeline. There is **no** code path to the MTA that skips it.

```
 1. sequence   → due step materialized into a SendIntent
 2. policy     → jurisdiction + consent + suppression + content gate      [CAN BLOCK]
 3. verify     → recipient validity (cached; re-verify if stale)          [CAN BLOCK]
 4. router     → choose (node, ip, domain, mailbox) under constraints     [CAN DEFER]
 5. compose    → personalize, spintax, footer, headers, unsubscribe
 6. score      → rspamd + AI content risk; threshold gate                 [CAN BLOCK]
 7. pace       → per-mailbox, per-domain, per-IP, per-recipient-ESP token bucket [CAN DEFER]
 8. emit       → SMTP submit on the chosen node, bound to the chosen IP
 9. observe    → maillog correlation by Message-ID → delivered/deferred/bounced
10. attribute  → update the five reputation ledgers + campaign outcomes
```

### 3.1 Invariants

- **I1 — No unsuppressed send.** Suppression is checked in step 2 *and* re-checked in step 7 against a Valkey set with the DB as the source of truth. A race that sends to a suppressed address is a Sev-1.
- **I2 — No unauthenticated domain.** A domain cannot leave `PENDING` without verified SPF, DKIM (2048-bit), DMARC, and matching forward+reverse DNS on the node's IP.
- **I3 — No cap violation.** Every emit decrements four token buckets atomically. If any is empty, the intent defers; it never overflows.
- **I4 — Message-ID is the join key.** Every message carries a Message-ID we generated. Maillog correlation, bounce attribution, reply threading, and unsubscribe tokens all key off it.
- **I5 — Every decision is auditable.** Steps 2, 4, 6, and 7 write a structured decision record. "Why did this go out from that mailbox?" must be answerable a year later.
- **I6 — Reputation is never inferred from vendor counters.** Only from maillog lines, DNSBL responses, DMARC/TLS-RPT reports, FBL/ARF, and seed probes.
- **I7 — Blocked-by-default.** Unresolvable jurisdiction, unverified domain, missing consent basis, unknown content score → block, log, surface. Never "assume allowed."

### 3.2 The router (`packages/router`)

Input: a `SendIntent` + the recipient's ESP family.
Output: a `SendPlan { nodeId, ipId, domainId, mailboxId, sendAt }` or a `Deferral { until, reason }`.

Selection is a constrained cost-minimization over live candidates:

```
score(mailbox) =
      w1 · reputationScore(mailbox)          // 0..1, five-ledger composite
    + w2 · headroom(mailbox)                 // remaining daily cap, normalized
    + w3 · espAffinity(domain, recipientEsp) // measured placement, this ESP
    + w4 · warmupFit(mailbox, intent)        // is this mailbox ramped for this volume
    - w5 · recencyPenalty(mailbox, recipientDomain)  // don't hit one company from one mailbox
    - w6 · riskPenalty(domain)               // DNSBL, complaint trend, bounce trend
```

Hard filters applied before scoring: domain verified · mailbox `ACTIVE` · IP not quarantined · node healthy · cap headroom > 0 · no per-recipient-domain cooldown violation · policy allows this domain for this jurisdiction.

**Deferral is a first-class success.** The router returning "not now" is the mechanism that keeps reputation solvent. A campaign that runs slow is correct; a campaign that burns a domain is not.

### 3.3 The four token buckets

| Bucket | Window | Typical | Enforced in |
|---|---|---|---|
| Mailbox daily | rolling 24h | warmup curve → 30–50 | Valkey + DB reconcile |
| Mailbox hourly | rolling 60m | ≤ 1/8 of daily, jittered | Valkey |
| Domain daily | rolling 24h | Σ mailboxes × 0.9 | Valkey |
| IP hourly | rolling 60m | node capacity | Valkey |
| Recipient-ESP adaptive | rolling 15m | learned from 4xx rate | Valkey, auto-tuned |

The recipient-ESP bucket is the adaptive one: sustained `421-4.7.0` from Google reduces the Google-directed rate globally for that IP until deferrals subside. This is the closed loop that prevents a slow degradation from becoming a block.

---

## 4. The five reputation ledgers (`packages/reputation`)

Independent time series, different half-lives, composed only at read time.

| Ledger | Half-life | Inputs |
|---|---|---|
| **IP** | ~21 d | DNSBL listings, deferral rate, block-bounce rate, SNDS, TLS-RPT failures |
| **Domain** | ~10 d | DMARC pass rate, complaint rate, bounce rate, placement probes, Postmaster |
| **Mailbox** | ~3 d | per-mailbox bounce/defer/complaint, reply rate, age, warmup stage |
| **Content** | ~1 d | rspamd score, link-domain reputation, AI risk score, historical placement of similar bodies |
| **Engagement** | ~7 d | replies, positive replies, unsubscribes, complaints, per-campaign and per-segment |

A composite is computed **on demand** with explicit weights and is always displayed with its decomposition. There is no stored "the score."

**Decay is a scheduled job, not a query trick** — a nightly pass writes decayed snapshots so historical charts are reproducible.

---

## 5. Deliverability observability (`packages/deliverability`)

Six independent evidence streams. Each can fail without blinding the others.

1. **Maillog** (`apps/maillog-bridge`) — verbatim Postfix lines → parsed → `SmtpTransaction`. The primary truth. Carries the receiving MX's exact response string.
2. **Bounce taxonomy** — a rules table mapping (ESP family, SMTP code, enhanced code, response substring) → `BounceClass` ∈ {hard, soft, block-reputation, block-content, block-rate, mailbox-full, policy, auth, unknown}. Seeded with the real Google/Microsoft/Yahoo/Proofpoint/Mimecast/Barracuda dialects. `unknown` is a work queue, not a shrug.
3. **DNSBL poller** — Spamhaus (zen/sbl/xbl/pbl/dbl), SpamCop, Barracuda, SORBS, SURBL, UCEPROTECT, Invaluement, Backscatterer. Per-IP and per-domain, on a schedule with jitter, respecting free-tier query limits. Listing → immediate alert + optional auto-quarantine.
4. **DMARC RUA** (`apps/dmarc-ingest`) — we publish `rua=mailto:dmarc@…`, receive aggregate XML, parse to per-source-IP pass/fail. This is how we detect someone else spoofing our domains and how we prove alignment.
5. **TLS-RPT** — same receiver, JSON reports, surfaces MTA-STS/TLS negotiation failures that silently kill delivery to strict receivers.
6. **Seed probes** (`apps/seedbox`) — real accounts we control on Gmail, Outlook, Yahoo, Zoho, Proton, plus on-prem-style targets. A campaign sample is sent to seeds; the agent reads the folder and reports Primary/Promotions/Updates/Spam/Missing. **This is the only true measure of placement.** Everything else is a proxy.

Optional enrichers: Google Postmaster Tools API, Microsoft SNDS. They widen confidence; they never gate.

---

## 6. Warmup (`packages/warmup`)

Two mechanisms, both required.

**A. Ramp scheduling.** A per-mailbox curve (default: 5/day week 1, +5/day per week, plateau 40) with jittered hourly distribution, weekday bias, and automatic hold-or-rollback when the mailbox's bounce/defer rate crosses a threshold. The curve is a first-class row, editable per plan and per domain age.

**B. Peer warmup network.** Our own mailboxes exchange real messages with each other on a schedule, with realistic bodies, and the receiving side **opens, marks-not-spam, replies, and stars**. Because we own both ends, this is not a gray-market warmup pool — it is our own infrastructure exercising itself, and every message is an honest message between two accounts we operate. Participation is per-mailbox opt-in and is disclosed in the product.

> **Design note.** We deliberately do *not* join or build a cross-customer warmup exchange where strangers' mailboxes fake engagement with each other. Those pools are detectable, are increasingly penalized, and are a shared-fate liability. Our own fleet warming itself is both more honest and more controllable.

---

## 7. Sequence engine (`packages/sequence`)

A durable state machine per (lead, campaign). States: `PENDING → SCHEDULED → SENT → (REPLIED | BOUNCED | UNSUBSCRIBED | COMPLETED | STOPPED)`.

- Steps carry `delayDays`, `delayHours`, `sendWindow`, `conditions`, and `variants[]`.
- **Timezone resolution per lead** (declared → company HQ → TLD → default), business-hours windows, and a holiday calendar table.
- **Reply detection stops the sequence** for the whole thread *and* every other campaign targeting that person, immediately. Implemented as a domain event, not a per-campaign check.
- **Bounce → suppress → stop** for the address, and for hard-bounce clusters, a domain-level pause.
- **Variant assignment** is deterministic from `hash(leadId, stepId)` so re-runs are stable and results are attributable.
- Scheduling is materialized into a `SendIntent` table with a `dueAt` index; the scheduler is a claim-with-lock loop, not a cron scan.

---

## 8. Verification engine (`packages/verify`)

Self-hosted, five stages, short-circuiting, all results cached with a TTL:

1. **Syntax** — RFC 5322 + practical rules.
2. **Domain** — resolves, has MX, MX resolves, not parked, not a known disposable provider (self-maintained list + heuristics).
3. **Role/trap heuristics** — `info@`, `sales@`, `abuse@`, `postmaster@`; known spam-trap patterns; recycled-domain signals.
4. **SMTP probe** — `MAIL FROM: <>` + `RCPT TO:` from a **dedicated verification IP that never sends campaigns**, then `RSET`/`QUIT`. Never `DATA`.
5. **Catch-all detection** — probe a random local-part; if accepted, mark `CATCH_ALL` (deliverable-unknown) rather than lying with "valid."

**Critical isolation:** verification traffic uses its own IP and its own PTR. SMTP probing generates connection patterns that some receivers penalize; it must never touch campaign IP reputation.

---

## 9. AI gateway (`packages/ai`)

One entry point. `ai.run(taskId, input, ctx)`.

- **Provider:** OpenRouter. Model routing per task class (cheap/fast for classification, strong for copy and root-cause).
- **Prompts are versioned files**, not string literals; every response records `promptVersion` + `model` + `tokens` + `cost`.
- **Structured output** validated with Zod; a schema failure retries once then falls back deterministically. **No AI output reaches the send path unvalidated.**
- **Budgets** per org and per task class, enforced before the call, with a hard monthly ceiling and a degraded mode.
- **Caching** on `hash(promptVersion, model, normalizedInput)`.
- **Eval harness** — a fixture set per task with scored assertions, runnable in CI. A prompt change that regresses an eval fails the build.
- **PII discipline** — lead data sent to inference is minimized and logged as a category, and per-org opt-out disables AI features rather than silently degrading them.

---

## 10. Data stores

| Store | Holds | Why |
|---|---|---|
| **Postgres 18** (.211) | Orgs, users, campaigns, leads, sequences, fleet registry, policy decisions, billing, audit | Relational integrity, transactions, Prisma |
| **ClickHouse** (.211, new) | `SmtpTransaction`, `EmailEvent`, reputation time series, placement probes, DMARC rows | Billions of rows, sub-second aggregation, cheap retention |
| **Valkey** (.211) | Token buckets, suppression bloom+set, scheduler locks, rate limiters, AI cache | Sub-ms, ephemeral, reconstructible |
| **R2** | Raw maillog archives, DMARC XML originals, MIME blobs, exports | Cheap, durable, already in the fleet |

**Rule:** Postgres holds *decisions and configuration*. ClickHouse holds *observations*. Valkey holds *nothing that cannot be rebuilt*. Anything a customer or a regulator could ask us to prove lives in Postgres or R2, never only in Valkey.

---

## 11. Multi-tenancy

`Organization → Workspace → Campaign`, inherited from usermails' `Organization → Project` (renamed). Every fleet resource is owned at the org level and *assignable* to workspaces. Cross-tenant isolation is enforced in the data layer via a mandatory `orgId` predicate helper, with a test that fails CI if any Prisma query on a tenant model omits it.

**Shared vs dedicated pools:** plan-gated. Starter plans share a warmed pool (with per-tenant complaint accounting so one tenant's damage is attributable and containable). Higher plans get dedicated domains and IPs. The router treats both identically; only the candidate filter differs.

---

## 12. Frontend

Next.js 15 App Router, per `gm-stack`, held to `app-feel` standards: cached/deduped data layer, no fetch-on-mount waterfalls, optimistic mutations, honest loading and empty states, no dead-end navigation. Realtime via SSE from `apps/api`.

The Infrastructure and Deliverability cockpits are the differentiated surfaces and get the design investment. The campaign builder should be *plain and fast*, not clever.

---

## 13. Security

Inherited and kept: SSRF guards, security headers, TOTP, RBAC, API-key scoping, webhook signature verification, abuse screening. Added:

- Per-node agent auth via mTLS or signed tokens; the API never trusts a node's self-report of health without a signature.
- DKIM private keys encrypted at rest, decrypted only in the sender worker.
- Registrar and Stripe credentials in a single secrets module with rotation runbooks.
- Immutable audit log (append-only table + periodic R2 snapshot with a hash chain).
- Tenant data export/delete (GDPR Art. 15/17) as a first-class job, not a support ticket.

---

## 14. Deployment

`git push hostssh main` — same pipeline as usermails, different remote and different boxes. One image, sibling deploys for `api`, `web`, `workers`, plus standalone `dmarc-ingest` and `seedbox`. Blast nodes are provisioned by `infra/blast-node/` scripts and run `fleet-agent` + Postfix + OpenDKIM; they are **not** part of the app image.

Migrations run on boot (`migrate:deploy`), forward-only, with an explicit expand/contract discipline for anything touching the send path.
