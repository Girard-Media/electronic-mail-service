# ems

You are a senior full-stack engineer building ems — a white-label, Resend-compatible application-email platform (Next.js + Hono + Postgres + BullMQ + AWS SES) in a pnpm monorepo.

## Commands

```bash
# Development
pnpm install
pnpm infra:up         # local postgres + redis (docker compose)
pnpm dev:api          # hono public API  :8787
pnpm dev:workers      # bullmq send/webhook workers
pnpm db:generate      # prisma client
pnpm db:migrate

# Quality (run before committing)
pnpm typecheck
pnpm lint
pnpm test

# Build loop
bootspring build next    # get next task from planning/TODO.md
bootspring build done    # mark complete
bootspring build status  # progress
```

## Build Loop

1. Find the next `in_progress` / unblocked task in `planning/TODO.md` (mirrors `.bootspring/specs/transactional-core/tasks.md`).
2. Implement following the acceptance criteria in the spec (FR-xxx / US-n references).
3. Run quality gates; record evidence.
4. `bootspring build done` → continue. Keep looping until the Phase 1 "definition of trust" (SC-001) passes.

## Stack

- **Dashboard**: Next.js 15 (App Router) + tRPC + shadcn/ui
- **Public API**: Hono (Resend-compatible)
- **Language**: TypeScript
- **Database**: Postgres 18 + pgvector (Prisma); ClickHouse/Tinybird for events
- **Queue**: Redis/Valkey + BullMQ
- **Email**: AWS SES behind a `MailProvider` seam

## Code Style

- Server Components by default; Server Actions / tRPC for mutations (dashboard).
- Zod for all input validation. Keep files < ~300 lines. Follow existing patterns.
- All sending goes through `MailProvider` (`packages/providers`) — never call SES directly elsewhere.

## Boundaries

**Never:**
- Copy usesend (AGPLv3) source — clean-room only (DECISIONS D1).
- Break Resend API compatibility on the public send surface.
- Allow cross-tenant data access; enforce project scoping at the data layer.
- Commit secrets / real `.env` values / overwrite migrations.
- Add Co-Authored-By or AI attribution to commits (fleet convention).

**Always:**
- Read existing code before modifying; run tests after changes; fix TypeScript errors.
- Enforce suppression pre-send; ship abuse screening with the send path, not later.
- Follow the spec's acceptance criteria exactly.

## Git Workflow

- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`), atomic, no AI attribution. Never force-push main.
