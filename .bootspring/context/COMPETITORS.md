# ems — Competitors

**Generated:** 2026-06-20
**Status:** Draft v1

## Landscape map

| Player | Strength | Weakness we exploit |
|---|---|---|
| **Resend** | Best-in-class DX, React Email, clean API, fast-growing dev love | Closed/cloud-only, no self-host, shallow white-label, pricing scales painfully, marketing still thin |
| **Postmark** | Elite transactional deliverability & support, great reputation | Premium price, transactional-only ethos, dated DX, no real white-label, no self-host |
| **SendGrid (Twilio)** | Scale, brand, enterprise reach | Disliked DX, opaque deliverability, shared-IP roulette, surprise bills, slow support |
| **Mailgun (Sinch)** | Powerful APIs, EU regions, validation tooling | Crufty console, deliverability complaints, pricing complexity |
| **Amazon SES** | Cheapest, reliable substrate, massive scale | It's *infrastructure*, not a product — no dashboard, no DX, no contacts/automation, you build everything |
| **Loops / Resend marketing / Customer.io / Knock** | Lifecycle & product-messaging UX | Either not transactional-first, or not white-label, or not developer-owned end to end |
| **OSS: usesend (AGPLv3)** | Feature-rich Resend alternative, SES-based, editor, broadcasts | **AGPLv3** (copyleft network clause) — risky base for closed white-label SaaS |
| **OSS: freeresend (MIT)** | **100% Resend-compatible drop-in**, SES + DKIM/DNS automation | Thin feature set, single-tenant, minimal deliverability/automation tooling |
| **AgentMail** ⚠️ top threat | Owns "email for AI agents": programmatic inboxes, threads, drafts/HITL, labels, WebSockets, MCP, agent-native docs (llms.txt), SOC 2, per-inbox pricing. YC S25, $6M seed (General Catalyst, 3/2026), 100M+ emails, 500+ B2B customers | Inbox-first, weak at high-volume transactional; white-label + BYO cloud gated to Enterprise; no marketing/lifecycle; young infra. **~80% of their core = machinery we already run** — our gap is public API exposure + packaging. Full teardown & counter-plan: `planning/AGENT_EMAIL.md` |

## Our differentiation (the wedge)

1. **Drop-in Resend compatibility** → near-zero switching cost (steal Resend's *and* SES-rollers' users).
2. **Deliverability as a product** → dedicated IP pools, warmup, inbox-placement, reputation dashboard, DMARC/BIMI guidance. Postmark-grade outcomes, self-serve.
3. **True white-label multi-tenancy** → agencies/platforms resell under their brand. Nobody credible does this self-serve.
4. **Self-host / BYO-cloud option** → answers the closed-box objection to Resend; BYO-SES keeps sending costs at customer cost.
5. **Unified transactional + marketing on one event stream** → expand revenue without a second vendor or integration.

## Positioning statements

- **vs Resend:** "Everything you love about Resend's DX — plus white-label, self-host, dedicated IPs, and marketing on the same account."
- **vs Postmark:** "Postmark-grade deliverability without the premium-per-email tax, and you can resell it."
- **vs SendGrid/Mailgun:** "The modern replacement: drop-in API, honest pricing, deliverability you can actually see."
- **vs raw SES:** "SES's price and reliability with the dashboard, DX, deliverability tooling, and contacts you'd otherwise build yourself."
- **vs OSS starters:** "Production-grade, multi-tenant, white-label, and supported — on a clean MIT-safe foundation."
- **vs AgentMail:** "One email platform for your product *and* your agents — agent inboxes plus Resend-compatible transactional at scale, white-label, self-serve. You'd need AgentMail *and* Resend; we're both."

## Foundation decision (critical)

We **build on freeresend (MIT)** for the Resend-compatible contract + SES/DKIM wiring, and treat **usesend (AGPLv3) as clean-room architectural inspiration only** (queues, editor, broadcasts, analytics) — we do **not** copy AGPL code into a proprietary white-label product. See [[DECISIONS]] and [[ARCHITECTURE]].

## Moats we are building

- **Hosted mailbox on the same authenticated domain** — Resend/Postmark are send-only; ImprovMX is forward-only. One DKIM, send + receive, no Workspace seat. This is the wedge to capitalize (see [[NATIVE_MAILBOXES]] in `planning/`). AgentMail's $6M seed and traction **validate this direction hard** — capitalize it via the Agent Track (`planning/AGENT_EMAIL.md`): public inbox API, threads, MCP, realtime.
- **Reputation data + deliverability ML** (we see cross-tenant placement signals → better routing/warmup).
- **Agency distribution network** (white-label lock-in + switching cost via their clients).
- **Compatibility + migration tooling** (importers, log parity) that make us the path of least resistance.

## Related

See [[VISION]], [[MARKET]], [[AUDIENCE]], [[DELIVERABILITY]], [[DECISIONS]].
