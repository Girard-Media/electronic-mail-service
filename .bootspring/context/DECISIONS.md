# Decisions — EMS

| # | Decision | Why |
|---|---|---|
| D1 | Hard fork of usermails, not a monorepo sibling | Cold-outreach risk must not touch a live transactional product. Cost accepted: double-maintenance, tracked in `planning/lineage/FORK.md`. |
| D2 | We own the MTA; rented mailboxes are a migration feature, not the architecture | The whole moat. Renting means never seeing the receiving MX's response. |
| D3 | ClickHouse for observations, Postgres for decisions | Billions of transaction rows need columnar aggregation; anything a regulator could ask us to prove needs relational integrity. |
| D4 | No cross-customer warmup pool | Detectable, increasingly penalised, shared-fate. Our own fleet warming itself is honest and controllable. |
| D5 | Open tracking OFF by default | Apple MPP made open rates fiction and pixels are a placement liability. |
| D6 | OpenRouter is the only inference dependency | Model-routed, cost-capped, swappable, and every task has a documented degraded mode. |
| D7 | Stripe behind `BillingProvider` | Payments legally require a processor. Isolated to one adapter; CI fails on a Stripe import elsewhere. |
| D8 | Registrar and DNS behind `RegistrarProvider` / `DnsProvider` | Bulk domain purchase needs *a* registrar; the choice must stay reversible. |
| D9 | Compliance is a gate in the send path, not documentation | Jurisdiction rules are a versioned table with citations that counsel edits without a deploy. |
| D10 | Blocked by default on anything unresolvable | Deliberate asymmetry: over-blocking costs volume, under-blocking costs the company. |
| D11 | Verification runs on its own IP | SMTP probing attracts listings; that must never touch campaign reputation. |
| D12 | Plain-text-first composer, no visual HTML designer | Cold email that converts is plain text. A rich designer actively harms the outcome. |
| D13 | freeresend (MIT) lineage kept; usesend (AGPLv3) stays clean-room only | Inherited licence boundary; survives the fork unchanged. |
| D14 | Node state is disposable; keys are not | Blast nodes are cattle. DKIM private keys live encrypted in Postgres and are materialised at provision time. |
| D15 | A node is not routable until `90-verify.sh` passes | Three flags: no open relay, DKIM actually signs, port 25 egress works. |
| D16 | ListKit-class outreach lives here, not in usermails | usermails stays transactional. Cold volume on that MTA/IP would burn password-reset reputation. Positive replies that opt in hand off via `HandoffEvent`. |
| D17 | A campaign attaches an explicit mailbox pool | `CampaignMailbox` is the join. Named `domainPool` is the fallback when no rows exist. The router is the only mailbox picker (D2 + ARCHITECTURE §3.2). |
| D18 | Visual HTML builder is optional, never the default composer | D12 stands. ReflexWare's block builder may render `bodyHtml` with a heavy-HTML warning. Cold steps stay plain-text-first. |
| D19 | Calendar is a booking link, not a Workspace clone | Google Calendar busy/free + first-party booking page. AI drafts may include the URL. AI never auto-sends. `meeting-booked` is the terminal success. |
