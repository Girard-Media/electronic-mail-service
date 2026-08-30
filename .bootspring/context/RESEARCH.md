# Research notes — EMS

Where numbers in the plan come from, so they can be re-checked rather than trusted.

| Claim | Source | Re-verify |
|---|---|---|
| Mailbox plateaus at 30–50/day cold | Operator consensus across outbound practice, consistent with Google `421-4.7.0` onset | Measure our own cohorts in Phase 1 and replace this with our data |
| ~30 mailboxes / ~12 domains per 1,000 sends/day | Derived arithmetic from the above with a 0.85 safety factor | Falls out automatically once cohort data exists |
| 2–3 mailboxes per domain | Risk concentration; more mailboxes per domain means one domain's failure costs more | A/B in Phase 1 |
| 14-day domain aging minimum | Receiver treatment of newly-registered domains | Test 7/14/21-day cohorts and pick on placement data |
| DMARC `p=none` → `quarantine` after 7 clean days | Conservative; alignment is fully under our control since we own both ends | Tighten if RUA shows 100% alignment sooner |
| Inference <$0.40 per 1k sends | Budget target, not a measurement | Measure from the AI ledger in Phase 2; re-route or replace any task that misses it |

**Rule:** every row above becomes a measurement or gets deleted. A planning number
that never converts into an observed one is a guess wearing a table.

## Open questions for Phase 1
1. Does our own peer warmup measurably beat no warmup, on seed placement?
2. Which warmup curve wins on time-to-plateau *and* placement-at-plateau?
3. What is the real false-valid rate of our verification engine against bounces?
4. Does persona realism (name, title, signature) correlate with reply rate?
