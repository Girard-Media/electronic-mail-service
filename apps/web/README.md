# @ems/web — Next.js 16 frontend

Multi-tenant + programmatic-SEO frontend. Full plan: `planning/NEXTJS_FRONTEND.md`.

- **App Router**, `output: 'standalone'`, Tailwind v4.
- Reads Postgres directly via `@ems/db` in server components; writes go to the
  Hono API (`apps/api`). Hono remains the migration runner.
- Deploys on Coolify via `apps/web/Dockerfile` (build context = repo root).

## Local dev
```bash
pnpm install                       # from repo root
pnpm --filter @ems/db generate
pnpm --filter @ems/web dev   # http://localhost:3000
```
Requires `DATABASE_URL` (+ `AUTH_SECRET` in production builds — `env.ts` is strict).

## Status (Phase 0b)
Foundation + shared ISR cache. A static ISR landing (`/`), a `force-dynamic` Prisma
proof (`/status`), and a Valkey-backed `cacheHandler` (`cache-handler.cjs`) so a
revalidate on one container is seen by all replicas. The handler **fails open** — no
`REDIS_URL` or any Redis error degrades to local regeneration — so it's safe on a
single box and in dev. Cross-instance invalidation is only *provable* on a real
multi-container deploy.

Marketing: the inherited usermails pages (features, pricing, deliverability, docs)
were stripped in E18-001. The apex now serves a plain EMS landing, the blog, status,
and the legal pages (privacy/terms/security still carry usermails-era wording and
need an owner rewrite).

### Design tokens (E18-002/003)
`app/tokens.css` is the only place colour, type scale, spacing, radius and elevation
are declared; `globals.css` imports it and components read `var(--…)`. Dark is the
default palette on `:root`; light is opt-in via `<html data-theme="light">`. The
contrast floor (text ≥ 4.5:1 on every surface, `--on-brand` ≥ 4.5:1 on filled
buttons, `--focus` ≥ 3:1) is enforced by `scripts/design-tokens-test.mts`, which runs
in `pnpm test`. Add a token to both palettes or the test fails.

### Env
- `DATABASE_URL` — Postgres (install + build + runtime; `env.ts` is strict).
- `AUTH_SECRET` — required in production builds.
- `REDIS_URL` (or `QUEUE_URL`) — fleet Valkey for the ISR cache. Unset → local cache.
- `GIT_HASH` — stable build id across replicas (set in Coolify).
- `NEXT_PUBLIC_SITE_URL` — canonical origin for metadata (default `https://electronicmailservices.com`).
