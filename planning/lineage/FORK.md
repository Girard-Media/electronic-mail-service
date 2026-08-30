# Fork Provenance

**Source:** `/Users/girardmedia/Documents/WEB/usermails` @ `main`, 2026-08-30
**Method:** hard fork (Q1 decision, recorded 2026-08-30). Full copy, `.git`, `node_modules`,
and `pnpm-lock.yaml` excluded; `planning/` and `.bootspring/multi-feature-mvp/` excluded.
**Baseline commit:** `fork: baseline from usermails, rebranded to Electronic Mail Services (@ems)`
**Scope:** 281 files, ~19k LOC TypeScript.

## What the fork bought us

Working, production-proven implementations of: multi-tenant identity and RBAC, platform
admin with TOTP, domain verification with DKIM, suppression, webhooks with signing,
email templates, tracking and unsubscribe endpoints, an abuse screen, SSRF guards,
security headers, privacy/DSR endpoints, a Postfix MTA sidecar with a maillog bridge,
an ARF/FBL feedback receiver, a `MailProvider` seam with SMTP/Google/Microsoft adapters,
VERP, MIME handling, a migration importer, an SDK, and an MCP server.

Building those from scratch would have been roughly half the ninety days.

## Rebrand applied

| From | To |
|---|---|
| `@usermails/*` | `@ems/*` |
| `usermails` (package) | `electronic-mail-service` (root), `@ems/sdk` (SDK) |
| `usermails.com` | `electronicmailservices.com` |
| `app.usermails.com` | `app.electronicmailservices.com` |
| `usermails-mta` | `ems-mta` |
| `/srv/hostssh/usermails` | `/srv/hostssh/ems` |
| `USERMAILS_*` | `EMS_*` |

172 files touched. Zero residual `usermails` references outside this document.

## Licence boundary — carried forward unchanged

- Base lineage is **freeresend (MIT)**. The attribution and NOTICE stay current.
- **usesend is AGPLv3 and remains clean-room inspiration only.** No usesend source enters
  this proprietary product. This constraint survived the fork and is restated in
  `CLAUDE.md` and `AGENTS.md`.

## The cost of the fork (accepted, not ignored)

A hard fork means permanent double-maintenance of every shared fix. A security fix in
`packages/core/src/ssrf.ts` must be applied twice, by hand, forever. Mitigations:

1. `planning/lineage/SHARED.md` lists the files that are still substantively identical.
2. A scheduled job diffs those files against the usermails repo and opens an issue on drift.
3. Anything genuinely shared and stable should eventually be extracted to a private
   package both repos depend on. Candidates: `ssrf`, `crypto`, `security-headers`, `totp`,
   `verp`, `mime`. This is deliberately deferred — extracting too early couples two
   products that should be free to diverge.

## What must never be shared

**Reputation.** Different boxes, different IPs, different PTRs, different DKIM keys,
different bounce domains, different DMARC `rua`, different mail logs. EMS never sends
through `31.220.104.223`. Enforced by `E03-118` and `E03-119` in the backlog.
