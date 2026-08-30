# Roadmap — EMS

> Canonical: `planning/ROADMAP.md`. Gates are conditions, not dates. A phase that
> has not met its gate does not advance; when that happens the plan was wrong.

| Phase | Days | Epics | Gate |
|---|---|---|---|
| **0 Foundation** | 0–14 | 01–02 | Fork green · migration applied · ClickHouse round-trips · node passes `90-verify.sh` · **one real message delivered to a Gmail seed with the 250 in our own maillog** |
| **1 The Fleet** | 15–35 | 03–08 | 10 domains + 25 mailboxes with zero manual steps · warmup holds and rolls back under injected bounces · router p95 <50 ms at 10k candidates · bounce coverage >98% non-UNKNOWN |
| **2 The Product** | 36–60 | 09–17 | A real campaign import→reply · every compliance gate demonstrably blocks · reply classification ≥92% / ≥80% per class · metering reconciles to raw events |
| **3 GA** | 61–90 | 18–24 | Gmail ≥85%, Microsoft ≥75% measured this week · pen test fixed and re-tested · DR drill done · honesty audit passed · a second operator runs it unaided for a week |

## Status — 2026-08-30

Phase 0 in progress. Done: fork green (typecheck + full test suite pass),
54-model schema migrated (55 tables), ClickHouse observation store live with
rollups firing, `infra/blast-node/` provisioning written including the
`90-verify.sh` gate, `pnpm ip:diligence` runnable.

Blocking Phase 0 completion: **no VPS purchased.** Everything downstream of the
node is written and untested against real hardware.

## What would make us stop
Port 25 unobtainable at acceptable cost · placement at plateau below gate across
two cohorts · operator time per mailbox never falls below target · the compliance
gate proves unworkable in practice. Reviewed at day 90, on the data.
