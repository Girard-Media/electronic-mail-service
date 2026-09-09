# Handoff — ListKit-class outreach (campaign mailbox pool)

**Date:** 2026-09-09
**Repos:** work is in **this repo** (`electronic-mail-service`). usermails only recorded D15.
**State:** usermails D15 and EMS pool slice are **committed** (`2e929dd`, `cf84319`). Follow-up (launch gate + intent worker) may be uncommitted on EMS. Migration **not applied** to any live DB.

A cold reader should resume here without re-deriving the product split.

---

## 1. What the user asked for

ListKit screenshot ($597 bundle: 1,000 cold sends/day, 20 domains, 40 inboxes, warmup, AI scripts). They want:

1. Connect domains
2. Attach **multiple domains** to a campaign and **rotate** sending
3. ReflexWare **template builder**
4. Unified **inbox** filtered by domain / campaign
5. See replies, reply from the same identity
6. **AI reply drafts**
7. **Connect calendar** and book appointments

That is Instantly/ListKit, not Resend. Do **not** build it in usermails.

---

## 2. Product split (locked)

| Product | Repo | Job |
|---|---|---|
| **usermails** | `/Users/girardmedia/Documents/WEB/usermails` | Transactional + hosted inbox. Resend-compat. |
| **EMS** | `/Users/girardmedia/Documents/WEB/electronic-mail-service` **← you are here** | Cold B2B outreach on owned metal. |
| **ReflexWare** | `/Users/girardmedia/Documents/WEB/reflexware` | Harvest source only. Do not npm-link it. |

**Decisions**

- usermails `.bootspring/context/DECISIONS.md` **D15** — cold stays in EMS; only join is opt-in `HandoffEvent`.
- EMS `.bootspring/context/DECISIONS.md` **D16–D19**:
  - D16 outreach lives here
  - D17 campaign attaches an explicit mailbox pool
  - D18 visual HTML builder is optional, never the default composer (D12 stands)
  - D19 calendar is a booking link, not a Workspace clone; AI never auto-sends

**Do not**

- Add `Campaign` models to usermails Prisma
- Raise usermails domain caps (1/10/50) to ListKit-scale
- Mix this traffic onto the usermails app-box IP / Postfix
- Auto-send AI replies
- Cross-tenant warmup (D4)
- Build a ListKit lead-credit marketplace in v1
- Make the ReflexWare drag-and-drop builder the default cold step

Plan file (session):  
`/Users/girardmedia/.grok/sessions/%2FUsers%2Fgirardmedia%2FDocuments%2FWEB%2Fusermails/01a086bb-6819-7013-8058-2aa01f53c6ac/plan.md`

---

## 3. What this session shipped (uncommitted)

### Schema
- `CampaignMailbox` join (`campaignId`, `mailboxId`, `attachedAt`)
- `InboxThread.campaignId` index
- Migration: `packages/db/prisma/migrations/20260909000000_campaign_mailbox_pool/migration.sql`
- **Not applied.** Run `pnpm db:migrate` in EMS against local/prod Postgres when ready.

### Router (`packages/router`)
- `src/pool.ts` — `resolveCampaignPool`, `expandDomainAttach`, `mergeAttach`, `poolCapacityToday`, attachable statuses `ACTIVE | WARMING | PAUSED`
- `FilterContext.mailboxIds` / `RouteRequest.mailboxIds` — non-empty set **overrides** named `domainPool`
- LRU tie-break on `lastSendAt` before mailboxId
- WARMING mailboxes may sit on the join; `reject()` still requires `mailboxStatus === "ACTIVE"` for campaign sends

### API (session-authed, mounted from `apps/api/src/routes/app.ts`)
| Method | Path | Perm |
|---|---|---|
| GET | `/app/campaigns` | read |
| POST | `/app/campaigns` | `email:send` |
| GET | `/app/campaigns/:id` | read (includes pool + `poolCapacityToday`) |
| PUT | `/app/campaigns/:id/mailboxes` | `email:send` — body `{ mailboxIds?, domainIds? }` **replaces** the pool |
| DELETE | `/app/campaigns/:id/mailboxes/:mailboxId` | `email:send` |
| GET | `/app/inbox/threads?campaignId=&domainId=&mailboxId=&intent=&limit=` | read |

Writes fail closed via `permForAppWrite` (`apps/api/src/lib/require-perm.ts`). `@ems/router` added to `apps/api` deps.

### Tests
- `scripts/campaign-pool-test.mts` — **ALL PASS** (no Redis)
- `scripts/app-rbac-test.mts` — **ALL PASS** (campaign + inbox paths)
- `pnpm --filter @ems/router typecheck` and `@ems/api typecheck` — green
- `scripts/send-path-test.mts` — **not re-run to completion**; needs Redis at `127.0.0.1:56379` (`pnpm infra:up`). Hard-filter behaviour is covered by campaign-pool-test.

### Not built this session
- Dashboard chrome (inherited `dashboard.html` has no Campaigns view)
- Send worker passing `mailboxIds` into `route()` — **the join is inert until E15-031d**
- FleetDomain / FleetMailbox CRUD UI (Epic 05)
- Warmup execution against the pool (Epic 06 — package exists, not wired to campaigns)
- Sequence enrolment / halt-on-reply (E15-003, E15-018)
- Inbound → thread.campaignId attribution (E16-010)
- AI `draft.reply` (E16-047; classifier exists, drafts do not)
- Calendar OAuth / booking page (D19, harvest ReflexWare)
- ReflexWare email-builder port (D18, optional HTML only)

---

## 4. Next agent — do this, in this order

Work in **`/Users/girardmedia/Documents/WEB/electronic-mail-service`**. Do not open a usermails campaign PR.

### Step 0 — land the slice
1. Read this file + D16–D19.
2. Commit in EMS (conventional, no AI attribution). Suggested:
   `feat: attach mailbox pools to campaigns and filter the router`
   Include the usermails D15 commit separately if you are also in that repo:
   `docs: isolate cold outreach to EMS (D15)`
3. Apply migration locally: `pnpm db:migrate`.
4. `pnpm infra:up` then `pnpm exec tsx scripts/send-path-test.mts` to confirm no router regression.

### Step 1 — make the pool actually send — **done 2026-09-09**
- `POST /app/campaigns/:id/launch` runs `decideLaunch` (E15-031e).
- `apps/workers/src/route-intent.ts` loads the join and calls `route({ mailboxIds })` (E15-031d). Persist ROUTED/DEFERRED + `FleetMailbox.lastSendAt`. Does **not** SMTP-emit yet.
- Queue: `QUEUE_INTENT` / `intentQueue`. Launch enqueues due PENDING/DEFERRED intents.

### Step 2 — tenants need mailboxes to attach — **API done 2026-09-09**
- `POST /app/fleet/domains` mints DKIM, returns records to publish
- `POST /app/fleet/domains/:id/verify` walks REGISTERED → DNS_PENDING → AGING (never skips to WARMING)
- `POST …/warm` and `…/activate` are explicit promotions
- Personas require a postal address; mailboxes refuse role local-parts; cap 3 per domain
- Mailbox create needs a CAMPAIGN `BlastNode` (org-owned or platform). **409 `no_campaign_node` until Epic 03 provisions one.**
- No cockpit UI yet (E18). No maildir provision (E05-025).

### Step 2b — enrolment + halt-on-reply — **done 2026-09-09**
- `POST /app/campaigns/:id/steps` then `POST /app/campaigns/:id/enroll` `{ leadIds | listId }`
- Frozen/suppressed leads get `BLOCKED_BY_POLICY` rows, not a silent skip
- First SendIntent only (E15-008). Due at `scheduleStep` in the lead's timezone
- `POST /app/inbox/threads/:id/outcome` `{ intent }` halt INTERESTED/NOT_INTERESTED/REFERRAL across every campaign; UNSUBSCRIBE too. OOO/auto-reply do not halt
- Stub CAMPAIGN `BlastNode` (PROVISIONING) + RFC1918 IP auto-created so mailbox create is unblocked. **Not routable** until 90-verify

### Step 2c — compose + emit — **done 2026-09-09**
- After `route()` returns a plan, `emitRoutedIntent` personalises copy, appends postal + unsubscribe, validates CAN-SPAM, then submits.
- No SMTP_URL / `MAIL_RELAY_STUB=true` → `SUBMITTED` with a stub 250 (same as transactional worker).
- Real SMTP uses FleetDomain DKIM. **Delivered is still maillog-only (E08-025).**
- Unverified From domain fails closed (`unverified-from-domain`). Stub node traffic will FAILED until DNS + 90-verify.

### Step 3 — inbox that salespeople can use (next product surface)
- E16-010 link inbound to lead + campaign + mailbox (`SendIntent.messageId` ↔ `In-Reply-To`)
- E16-034 cockpit on top of `GET /app/inbox/threads`
- E16-041 reply from the receiving mailbox only
- E16-047 AI draft, human accept, **never auto-send** (E16-048). Harvest `reflexware/src/services/support-assist.service.ts`. Classifier already in `@ems/ai`.

### Step 4 — calendar (after inbox drafts)
Harvest ReflexWare `BookingCalendar` + `src/lib/calendar/google.ts`. Public booking URL in the AI draft. Terminal success = `meeting-booked` (E16-069). No Nylas/Cal.com (EMS third-party rule).

### Step 5 — templates (decision already made)
Plain-text-first sequence composer (E15-034). Optional HTML via ReflexWare builder onto `StepVariant.bodyHtml` with heavy-HTML warning (E15-035). Do not invert D12/D18 unless the user overrides.

---

## 5. File pointers

| What | Path |
|---|---|
| Join + indexes | `packages/db/prisma/schema.prisma` (`CampaignMailbox`, `FleetMailbox.campaigns`) |
| Migration | `packages/db/prisma/migrations/20260909000000_campaign_mailbox_pool/` |
| Pool helpers | `packages/router/src/pool.ts` |
| Filter / LRU | `packages/router/src/candidates.ts` |
| `route()` mailboxIds fold-in | `packages/router/src/index.ts` |
| Campaign API | `apps/api/src/routes/campaigns.ts` |
| Inbox filter API | `apps/api/src/routes/inbox.ts` |
| Mount + perm | `apps/api/src/routes/app.ts`, `apps/api/src/lib/require-perm.ts` |
| Tests | `scripts/campaign-pool-test.mts`, `scripts/app-rbac-test.mts` |
| ReflexWare rotation | `../reflexware/src/lib/email/mailbox-rotation.ts` |
| ReflexWare builder | `../reflexware/src/components/email-builder/` |
| ReflexWare booking | `../reflexware/src/lib/calendar/google.ts`, `BookingCalendar` in prisma |

---

## 6. Invariants (do not violate)

From `planning/ARCHITECTURE.md` + D16–D19:

1. **Only `@ems/router` picks a mailbox.** Nothing else sets `SendIntent.mailboxId`.
2. **Deferral is success.** Empty/capped pool → `kind: "defer"`, never a thrown send.
3. **WARMING is not a campaign sender.** Attach yes, rotate no.
4. **Named `domainPool` is fallback** when the join is empty. Once rows exist, they are the pool.
5. **Org-scoped.** PUT must 404 mailboxes that are not `orgId` of the session.
6. **Terminal mailboxes (DRAINING/RETIRED/BURNED/CREATED) cannot attach.**
7. **usermails `/emails` stays Resend-shaped.** No rotation params there.

---

## 7. Open product calls (defaults already in D16–D19)

| Question | Default unless user overrides |
|---|---|
| Product home | EMS |
| Domain provisioning v1 | BYO connect (ListKit “we buy 20 domains” = `@ems/registrar`, later) |
| Composer | Plain-text first; ReflexWare HTML optional |
| Calendar | Google OAuth + first-party booking page |
| Lead data | CSV + `@ems/verify`, no credit marketplace |

---

## 8. Build-loop

EMS TODO is **generated**. Edit `planning/backlog/*.md`, then:

```
cd /Users/girardmedia/Documents/WEB/electronic-mail-service
pnpm todo:compile
```

This session marked E07-009a, E07-022a, E15-031a/b/c, E16-034a done, and added E15-031d/e + E18-078a as next.

`bootspring build next` in **EMS**, not usermails, for this product line.
