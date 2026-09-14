# EMS — Planning Index

| Document | What it settles |
|---|---|
| [VISION.md](VISION.md) | First-principles decomposition, what we refuse to build, success criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Topology, the ten-stage send path, invariants I1–I7, the router, the five ledgers |
| [INFRA.md](INFRA.md) | Blast-node fleet, IP diligence, domain/mailbox strategy, capacity math, cost model |
| [COMPLIANCE.md](COMPLIANCE.md) | Jurisdiction map, consent ledger, suppression, KYC/AUP, refused capabilities |
| [AI.md](AI.md) | OpenRouter gateway, the eleven tasks, evals, budgets, injection posture |
| [ROADMAP.md](ROADMAP.md) | The ninety-day shape and the gates between phases |
| [HANDOFF.md](HANDOFF.md) | **Start here if you are the next agent on ListKit-class outreach** (2026-09-09) |
| [TODO.md](TODO.md) | **Generated** build-loop queue — re-run `pnpm todo:compile` for Epic 25 |
| [INNOVATION-100.md](INNOVATION-100.md) | 100 agency-synthesized differentiators (2026-09-14), 20 promoted bets |
| [backlog/](backlog/) | Source of truth for the queue, 25 epic files |
| [bootspring/](bootspring/) | Notes back to the Bootspring team from building this |
| [lineage/](lineage/) | Fork provenance from usermails |

## Reading order for a new contributor

0. **If you are continuing the ListKit / campaign-pool thread:** `HANDOFF.md` then D16–D19 in `.bootspring/context/DECISIONS.md`.
1. `VISION.md` §2 (first principles) and §7 (what we refuse) — twenty minutes, and it prevents most wrong turns.
2. `ARCHITECTURE.md` §3 (the send path) — memorise the ten stages and the seven invariants.
3. `COMPLIANCE.md` §1 and §9 — the legal map and the refused list.
4. `INFRA.md` §3 (IP diligence) if you are touching the fleet.
5. Then pick a task from `TODO.md`.

## The one-paragraph version

EMS is cold B2B outreach infrastructure where we own the metal, the IPs, the MTA, and
the mail log. That ownership is the whole product: it is why our `delivered` comes from
the receiving MX's 250 rather than a vendor's optimistic counter, why we can run per-IP
warmup and per-domain quarantine, and why we can hand a customer's legal team a per-send
record of why the send was lawful. It is a fleet-management and scheduling system that
happens to emit email — closer to Kubernetes than to Mailchimp. Reputation is the scarce
resource; the product is a reputation budget allocator.

## Relationship to usermails

`usermails` is transactional (opt-in, application email, Resend-compatible).
EMS is acquisition (cold outreach). **The moment a lead opts in, they leave EMS.**
Different boxes, different IPs, different PTRs, different DKIM keys, different mail logs.
The only link is an outbound handoff API call. See `ARCHITECTURE.md` §1.
usermails recorded this as **D15** (2026-09-09). ListKit-class attach/rotate/inbox work continues from `HANDOFF.md`.
