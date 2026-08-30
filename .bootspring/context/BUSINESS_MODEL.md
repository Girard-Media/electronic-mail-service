# Business model — EMS

## Revenue
Public SaaS, Stripe metered. Plans gate mailboxes, domains, sends, verifications,
AI tokens and seats. Dedicated IPs and dedicated domains are gated to the plans
that actually receive them — **we never claim a dedicated IP on a shared pool.**

## Cost structure (to 1,000 sends/day)

| Line | ~USD/mo |
|---|---|
| blast-node-01 | 15 |
| verify-node-01 | 8 |
| 15 domains | 13 |
| Postgres / Valkey / ClickHouse (existing .211) | 0 marginal |
| R2 | 2 |
| OpenRouter | 20–100 |
| **Total** | **~60–150** |

Instantly/Smartlead at that volume: $97–297 platform **plus** $90–150 in mailbox
fees for 30 mailboxes. We are structurally cheaper and keep the margin, because we
own the layer they resell.

## The metric that matters
**Cost per positive reply**, shown to the customer, broken into infrastructure,
verification and AI. It is the honest efficiency measure and it makes expansion a
data conversation rather than a sales one.

## Pricing discipline
Recompute from measured cost, never from competitor anchoring. Every pricing
change is an ADR, simulated against real customer usage first, and grandfathers
existing customers.
