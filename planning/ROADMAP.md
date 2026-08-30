# EMS — Ninety-Day Roadmap

Each phase has a **gate**. The gate is not a date; it is a condition. A phase that has
not met its gate does not advance, and the plan is wrong rather than the team being late.

---

## Phase 0 — Foundation · days 0–14 · Epics 01, 02

Fork compiles green. Schema for the fleet. Blast node #1 alive with its own IP and rDNS.
Domain and mailbox provisioning automated. Policy engine skeleton wired into the send path.

**Gate:**
- `pnpm typecheck && pnpm lint && pnpm test` green on the fork
- `prisma validate` green, initial EMS migration reviewed by hand and applied
- ClickHouse provisioned, migrations running, one event round-trips
- blast-node-01 passes `90-verify.sh`: no open relay, DKIM signs, port 25 egress, PTR forward-confirms
- One real message delivered to a Gmail seed, with the `250` visible in our own maillog

**If the gate fails:** the most likely cause is the provider blocking port 25 or handing
over a dirty IP. Both are cheap now and catastrophic later — release the IP and retry.

---

## Phase 1 — The Fleet · days 15–35 · Epics 03, 04, 05, 06, 07, 08

Warmup engine live. Rotation router live. Maillog ingestion into the bounce taxonomy.
DNSBL, DMARC RUA, and TLS-RPT receivers running. Deliverability cockpit v1.

**Gate:**
- Ten domains and twenty-five mailboxes provisioned end to end with zero manual steps
- Warmup ramping unattended, with a demonstrated hold and rollback under injected bounces
- Router deciding under 50 ms p95 at 10,000 candidates, with a readable trace per decision
- Bounce classification coverage above 98% non-`UNKNOWN` against the real corpus
- DMARC alignment visible per domain from ingested aggregate reports
- No cap overflow under the concurrency race harness

---

## Phase 2 — The Product · days 36–60 · Epics 09–17

Sequence engine, lead pipeline, verification engine, unified inbox, AI gateway with the
first six tasks. Stripe metering.

**Gate:**
- A real campaign runs end to end against a real list, from import through reply
- Every compliance gate demonstrably blocks: expired consent, blocked jurisdiction, missing postal address, suppressed address
- Reply classification passes the CI eval gate at 92% overall and 80% per class
- Verification measured against real bounce outcomes, with the false-valid rate published internally
- Usage metering reconciles to raw events with zero drift
- Peer warmup excluded from billing, included in reputation — both tested

---

## Phase 3 — GA · days 61–90 · Epics 18–24

Seed placement testing, auto-remediation, self-serve onboarding, usermails handoff,
audit trail, public docs, launch.

**Gate:**
- Gmail placement ≥ 85% and Microsoft ≥ 75% on warmed domains, measured this week
- Hard bounce < 2%, complaints < 0.1%
- External penetration test complete, every finding fixed and re-tested
- Disaster recovery drill completed, RTO and RPO measured and documented
- Honesty audit passed: every claim on every surface traced to a measurement
- A second operator, not the builder, runs the platform for a week unaided

---

## What would make us stop

Stated in advance so it is a decision rather than a rationalisation:

1. **Port 25 is unobtainable at acceptable cost.** If providers will not give us clean IPs with open egress and rDNS control, the owned-infrastructure thesis fails and the honest move is to stop, not to rent mailboxes and become a worse Smartlead.
2. **Placement at plateau is below the gate after two independent warmup cohorts.** If our own infrastructure cannot beat rented mailboxes on the one number that matters, we have no product.
3. **Operator time per mailbox does not fall below the target.** The business only works if one person runs hundreds of mailboxes. If automation plateaus above that, the unit economics are an agency service, not a SaaS.
4. **The compliance surface proves unworkable in practice** — if the jurisdiction gate blocks so much real traffic that customers route around us, the honest response is to change the product, not to loosen the gate.

Review each of these at the ninety-day mark, on the data, and write down the answer.
