# Electronic Mail Services — Vision & First Principles

**Domain:** electronicmailservices.com · **App:** app.electronicmailservices.com
**Codename:** EMS · **Lineage:** hard fork of `usermails` (2026-08-29)
**Sibling product:** `usermails` — transactional. EMS is the *acquisition* half; usermails is the *lifecycle* half.

---

## 1. The one-sentence product

**EMS is cold B2B outreach infrastructure that we own end-to-end — our metal, our IPs, our MTA, our mail log — so that inbox placement is something we can measure and control, not something we rent and hope for.**

---

## 2. First-principles decomposition (SpaceX method)

> *Make the requirements less dumb. Delete the part. Simplify. Accelerate. Automate — in that order. The most common mistake is to optimize a thing that should not exist.*

### 2.1 What is the actual job to be done?

A business wants to start conversations with companies that have never heard of them. Everything else — the sequence builder, the CRM sync, the dashboard — is scaffolding around a single physical event:

> **An email leaves our machine and lands in a stranger's Primary tab.**

Every other feature is a derivative. So the requirement is not "build a sequencer." The requirement is:

> **Maximize the probability that a given message is (a) delivered, (b) placed in the inbox, (c) opened, (d) replied to — per unit of sender reputation consumed.**

Reputation is the scarce resource. Not sends. **Reputation is the propellant.** Every campaign burns it; warmup and good behavior regenerate it. The entire product is a reputation budget allocator.

### 2.2 Why do incumbents fail?

Instantly, Smartlead, Lemlist, Apollo, Woodpecker, Reply, Salesforge all share one structural defect: **they do not own the sending path.** They resell Google Workspace / Microsoft 365 mailboxes or a third-party SMTP relay. Consequences:

| They rent | Therefore |
|---|---|
| The mailbox | They see "accepted by Google," not "delivered by the receiving MX." Their `sent` is a lie by omission. |
| The IP | They cannot do per-IP warmup, per-IP quarantine, or per-IP blacklist remediation. |
| The MTA | They cannot read the SMTP response verbatim, so bounce classification is guesswork on a string. |
| The reputation | One abusive customer poisons a shared pool the vendor cannot segment. |
| The economics | Mailbox cost is a per-seat pass-through with a markup; margin is structurally thin. |

**We already own all five.** `usermails` proved it: our `delivered` comes from the Postfix maillog via `maillog-bridge`, not from a vendor's optimistic counter. That is the moat. EMS is that moat, pointed at cold outreach.

### 2.3 Requirements we are deleting (the "delete the part" pass)

| Deleted | Why |
|---|---|
| **IMAP/OAuth mailbox connectors as the primary path** | We *are* the mail server. Connecting someone's Gmail is a compatibility feature for migration, not the architecture. Keep the seam (it exists in `packages/providers`), demote it from the core. |
| **A separate "email verification" vendor** | Verification is four DNS/SMTP operations we can run ourselves from our own IPs. Buying it leaks our lead data to a third party and costs per-record forever. |
| **A third-party blacklist monitoring service** | DNSBL checks are `A` record lookups. `2.0.0.127.zen.spamhaus.org`. This is 200 lines of code, not a subscription. |
| **A hosted analytics warehouse** | Event volume at our scale fits self-hosted ClickHouse comfortably. |
| **An opt-in ESP / newsletter product** | That is `usermails`. Once a lead opts in, they leave EMS. **EMS does not do lifecycle marketing.** Refusing this is what keeps the product sharp. |
| **A visual drag-and-drop email designer** | Cold email that converts is plain text. A rich HTML designer actively harms the product's outcome. Ship a plain-text-first composer with a hard warning on heavy HTML. |
| **Open tracking pixels on by default** | Tracking pixels are a placement liability in 2026 and Apple MPP made open rates fiction. Default OFF, opt-in, and we surface *why*. |

### 2.4 Third-party surface (hard constraint from the founder)

> *"lowest 3rd party or no 3rd party services except for hosting and AI inference."*

| Allowed | Service | Why unavoidable |
|---|---|---|
| ✅ | Hostinger VPS | The metal. |
| ✅ | Cloudflare DNS/R2 | The registrar/DNS + object store already in the fleet. |
| ✅ | OpenRouter | AI inference. Model-routed, cost-capped, swappable. |
| ⚠️ | Stripe | Payments legally require a licensed processor. Isolated behind a `BillingProvider` seam so it is one adapter. |
| ⚠️ | Domain registrar API | Buying sending domains in bulk needs *a* registrar. Behind a `RegistrarProvider` seam (Cloudflare Registrar / Namecheap / Porkbun). |
| ⚠️ | Google Postmaster Tools / Microsoft SNDS | Read-only telemetry *about our own IPs*, free, unobtainable any other way. Optional inputs — the system must be fully functional without them. |
| ❌ | Everything else | Built in-house. |

**Rule:** if a dependency goes dark, EMS must still send and still report honestly. Postmaster/SNDS degrade a score's confidence interval; they never gate a send.

---

## 3. The physics of the problem

Cold email deliverability is not a marketing discipline. It is a **signal-to-noise negotiation with four adversarial classifiers** (Google, Microsoft, Yahoo, and the long tail of on-prem/Proofpoint/Mimecast/Barracuda). Each maintains a reputation score for:

1. **The sending IP** — slow-moving, shared blast radius, recoverable in weeks.
2. **The sending domain** — medium-moving, per-tenant, recoverable in days-to-weeks.
3. **The From: identity (mailbox)** — fast-moving, cheap to replace.
4. **The content fingerprint** — links, images, phrases, HTML structure, URL domains.
5. **The recipient engagement signal** — replies ≫ opens ≫ nothing ≫ deletes ≫ complaints.

**Design consequence:** these five have wildly different time constants, so they need *different control loops*. A single "deliverability score" is a lie. EMS keeps five independent reputation ledgers and a router that trades between them.

### 3.1 The volume/reputation constraint

Empirically, a fresh mailbox on a fresh domain survives ~5–10/day in week 1, ~20–30/day by week 4, and plateaus at **30–50/day** for cold traffic. Push past it and Google issues `421-4.7.0` deferrals, then Microsoft `550 5.7.1 S3150`, then the domain is cooked.

So to send **1,000 cold emails/day** you need **~25–35 live mailboxes** across **~10–15 domains**. That is the actual product problem: not "send a lot of mail" but **"operate a fleet of small, healthy, individually-monitored senders and route traffic across it optimally."**

**This reframes everything.** EMS is a fleet-management and scheduling system that happens to emit email. Closer to Kubernetes than to Mailchimp.

### 3.2 The measurable ground truth

We are the only ones who can compute these honestly because we read the maillog:

- `delivered` = receiving MX returned `250` — **from the log, verbatim, with the response string**
- `deferred` = `4xx` with the exact enhanced status code and the ESP's text
- `bounced` = `5xx`, classified by ESP-specific code taxonomy
- `placement` = seed-account probe result (Primary / Promotions / Spam / Missing)
- `reputation` = our own longitudinal series per IP/domain/mailbox, plus DNSBL, DMARC RUA, TLS-RPT, FBL/ARF

Everything on the dashboard traces to one of those. **No number is displayed that we cannot source.** This is inherited from the usermails honesty rule and is non-negotiable.

---

## 4. Product surface

### 4.1 Four cockpits

1. **Infrastructure** — nodes, IPs, domains, mailboxes. Health, warmup state, capacity, rotation, retirement. *The thing nobody else can show you.*
2. **Deliverability** — placement by ESP, bounce taxonomy, blacklist status, DMARC/TLS-RPT, seed tests, per-domain trend, alerts, auto-remediation history.
3. **Campaigns** — leads, sequences, scheduling, variants, outcomes.
4. **Inbox** — unified replies, AI classification, handoff.

### 4.2 The "AI-enabled everywhere" mandate, made concrete

AI is not a chat box bolted on. Eleven load-bearing uses, each with a measurable objective:

| # | Use | Objective it optimizes |
|---|---|---|
| 1 | Copy generation from ICP + offer | Reply rate |
| 2 | Subject-line variant generation + spam-phrase scoring | Open/placement |
| 3 | Pre-send content risk scoring (with rspamd as the non-AI ground truth) | Placement |
| 4 | Per-lead personalization line from public signals | Reply rate |
| 5 | Reply classification (interested / not / OOO / referral / unsub / auto) | Inbox triage cost |
| 6 | Bounce-reason summarization across ESP dialects | MTTR on incidents |
| 7 | Deliverability advisor — natural-language root cause on a metric drop | MTTR |
| 8 | Sequence optimization proposals from outcome data | Reply rate |
| 9 | Lead scoring / ICP fit at import | Wasted-send reduction |
| 10 | Compliance pre-flight (jurisdiction, claims, footer) | Legal risk |
| 11 | Anomaly narration on the infra cockpit | Operator load |

Every one runs through **one** `packages/ai` gateway on OpenRouter with: model routing by task class, prompt versioning, response caching, per-org token budgets, structured-output validation, and an offline eval harness. **No AI call is made from a route handler.**

---

## 5. Compliance as architecture, not a checkbox

Cold B2B email is legal in the US and illegal-by-default in much of the world. This is a **hard rail in the send path**, enforced below the application layer:

- **US (CAN-SPAM)** — opt-out regime. Legal *if*: truthful headers, non-deceptive subject, ad identification, valid physical postal address, working unsubscribe honored ≤10 days.
- **Canada (CASL)** — opt-in, with narrow B2B implied-consent windows. Fines to $10M CAD. **Default: blocked.**
- **EU/UK (GDPR + ePrivacy)** — B2B legitimate interest is arguable and member-state-specific. **Default: blocked without a recorded lawful basis.**
- **Australia (Spam Act)** — opt-in. **Default: blocked.**

**Implementation:** a `PolicyEngine` sits between the scheduler and the MTA. Every send resolves a jurisdiction for the recipient (TLD → company HQ → MX geo → declared), looks up the policy, and either allows, blocks, or requires a recorded lawful basis. Every decision is written to an immutable audit log with the inputs that produced it. **Blocked is the default for anything we cannot resolve.**

Non-negotiables in the message itself: real identity, real postal address, RFC 8058 one-click unsubscribe, no forged headers, no open relays, no spoofed domains, verified domain ownership before first send.

**This is also commercial strategy.** An outreach platform that can prove per-send lawful basis is the only kind an enterprise legal team will approve. Our competitors cannot produce that artifact.

---

## 6. Success criteria (the honest ones)

| Metric | Target at GA | Source of truth |
|---|---|---|
| Inbox placement, Google, warmed domain | ≥ 85% | Seed probe |
| Inbox placement, Microsoft, warmed domain | ≥ 75% | Seed probe |
| Hard bounce rate | < 2% | Maillog `5xx` |
| Complaint rate | < 0.1% | FBL/ARF |
| Domain time-to-first-safe-send | ≤ 14 days, unattended | Warmup engine |
| Mailboxes per operator-hour/month | > 500 | Ops telemetry |
| Median send decision latency | < 50 ms | Router trace |
| Blacklist MTTD | < 15 min | DNSBL poller |
| AI cost per 1k sends | < $0.40 | OpenRouter ledger |

---

## 7. What we will refuse to build

Stated up front so it is never re-litigated:

1. **Header forgery, domain spoofing, or open relaying.** Ever.
2. **Spam-filter evasion as a feature** — no invisible text, no homoglyph obfuscation, no unsubscribe-link hiding, no fake reply chains (`RE:` on a first touch).
3. **Purchased-list ingestion with no provenance.** Every list records a source and an attestation.
4. **Sending on behalf of a customer we cannot identify.** KYC before the first live send.
5. **A "deliverability score" we cannot decompose** into the measurements that produced it.
6. **Opt-in lifecycle marketing.** That is `usermails`. The handoff is a first-class feature; the overlap is not.

The line is precise: **we build infrastructure that makes legitimate outreach reach the inbox. We do not build tools whose purpose is to defeat a filter that correctly identified spam.** Every deliverability feature here — warmup, rotation, pacing, content scoring — is what a *good* sender does. It is the same work Postmark or SendGrid does for their customers, applied to a harder traffic class.

---

## 8. Ninety-day shape

- **Days 0–14 — Foundation.** Fork compiles green. Schema for the fleet. Blast node #1 provisioned with its own IP + rDNS. Domain/mailbox provisioning automated. Policy engine skeleton in the send path.
- **Days 15–35 — The Fleet.** Warmup engine live. Rotation router live. Maillog ingestion → bounce taxonomy. DNSBL + DMARC RUA + TLS-RPT receivers. Deliverability cockpit v1.
- **Days 36–60 — The Product.** Sequence engine, lead pipeline, verification engine, unified inbox, AI gateway with the first six uses. Stripe metering.
- **Days 61–90 — GA.** Seed-list placement testing, auto-remediation, self-serve onboarding, usermails handoff, SOC-2-shaped audit trail, public docs, launch.

---

*Governed by `planning/COMPLIANCE.md`. Implementation contract in `planning/ARCHITECTURE.md`. Execution in `planning/TODO.md`.*
