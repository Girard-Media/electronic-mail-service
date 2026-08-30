# ems

Developer-first, white-label application email. Resend-compatible API on a mail server we operate. Transactional today; lifecycle later on the same event stream.

**Status:** live for the Girard Media fleet (`RESEND_BASE_URL` + a ems key). Public enterprise launch is the remaining honesty + crash-structure work in `planning/LAUNCH_AUDIT_2026-08-23.md`.

## What ships

- Public API: `POST /emails`, batch, get, cancel, domains, keys, verify, hosted `/inboxes`
- Dashboard: `https://app.electronicmailservices.com/dashboard` (Hono SPA)
- Marketing + docs: `https://electronicmailservices.com`
- Own Postfix MTA — `delivered` comes from the mail log, not a vendor “sent” count
- White-label tenancy from the schema (org → project)

Not shipped (do not claim): dedicated IPs, warmup, SSO, Stripe checkout, npm `ems` package, connected Gmail/Outlook in production.

## Stack

pnpm monorepo. Next.js 15 (marketing) · Hono (API + dashboard) · Postgres 18 + Prisma · Redis/Valkey + BullMQ · own MTA behind `MailProvider`. Deploy: `git push hostssh main`.

Clean-room only vs usesend (AGPLv3). Base lineage: freeresend (MIT). See `.bootspring/context/DECISIONS.md`.

## Commands

```bash
pnpm install
pnpm infra:up          # local postgres + redis
pnpm db:generate && pnpm db:migrate
pnpm dev:api           # :8787
pnpm dev:workers
pnpm typecheck && pnpm test
```

## Docs

Canonical: [electronicmailservices.com/docs](https://electronicmailservices.com/docs). Planning: `planning/TODO.md`, `planning/LAUNCH_AUDIT_2026-08-23.md`.
