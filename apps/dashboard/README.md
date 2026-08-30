# @ems/dashboard

The Next.js 15 (App Router) + tRPC + shadcn/ui control panel — domains, API keys, logs, deliverability, team, branding, and (Phase 3) marketing.

**Status:** placeholder. Scaffolded in **Phase 1a** (tenant spine) per
[`.bootspring/specs/transactional-core/plan.md`](../../.bootspring/specs/transactional-core/plan.md).

Planned to be created with:

```bash
pnpm create next-app@latest apps/dashboard --ts --app --tailwind --eslint
```

then wired to `@ems/db` (Prisma) via tRPC, with Auth.js for sign-in (FR-001).
Reuse freeresend (MIT) dashboard patterns; clean-room any usesend (AGPLv3) UI ideas (DECISIONS D1).
