# ems — observability (Better Stack)

Industry split: **liveness** (process up) vs **readiness** (can serve) vs **heartbeats** (workers that have no HTTP).

The API exposes:

| Path | When it fails | Better Stack use |
|---|---|---|
| `GET /livez` (alias `GET /health`) | Process is dead | HTTP monitor — pages "API down" |
| `GET /readyz` | Postgres or Redis unreachable → **503**. Queue backup → 200 with `"status":"degraded"` | JSON monitor on `"status":"ok"` |

Workers and the maillog-bridge have no HTTP server. They GET a Better Stack **heartbeat URL** every 60s when `BETTERSTACK_HEARTBEAT_*` is set. A missed heartbeat pages "pipeline stalled" even if the API still 200s.

## Env (set on the running containers)

```
BETTERSTACK_HEARTBEAT_WORKERS=https://uptime.betterstack.com/api/v1/heartbeat/<workers-id>
BETTERSTACK_HEARTBEAT_MAILLOG=https://uptime.betterstack.com/api/v1/heartbeat/<maillog-id>
```

Unset = no-op. Never commit the URLs.

## Monitors to create (Better Stack Uptime — 10 free)

Paste these in **Uptime → Monitors**. Check interval 30s–3m (free tier is 3m).

| # | Name | Type | Target | Expect | Alert |
|---|---|---|---|---|---|
| 1 | API liveness | HTTP | `https://api.electronicmailservices.com/livez` | 200, body `"status":"ok"` | API process dead |
| 2 | API readiness | HTTP | `https://api.electronicmailservices.com/readyz` | 200 **and** body contains `"status":"ok"` | DB / Redis / we cannot serve |
| 3 | Marketing | HTTP | `https://electronicmailservices.com/` | 200 | Site down |
| 4 | Dashboard | HTTP | `https://app.electronicmailservices.com/dashboard` | 200 | Dashboard shell down |
| 5 | MTA SMTP | TCP | `mail.electronicmailservices.com:25` | banner contains `220` | MTA / UFW / container |
| 6 | Status page | HTTP | `https://electronicmailservices.com/status` | 200 | Status page itself |
| 7 | Workers | Heartbeat | (create heartbeat, paste URL into `BETTERSTACK_HEARTBEAT_WORKERS`) | every 60s, grace 2m | BullMQ processors stalled |
| 8 | Maillog bridge | Heartbeat | (create heartbeat, paste URL into `BETTERSTACK_HEARTBEAT_MAILLOG`) | every 60s, grace 5m | delivered events stopped |
| 9 | API TLS | SSL | `api.electronicmailservices.com` | expires > 14 days | cert |
| 10 | Queue backup (warn) | HTTP keyword | `https://api.electronicmailservices.com/readyz` | **fails** if body contains `"degraded"` — severity **warning**, not down | send queue backing up |

## Status page

Create a Better Stack status page and (optional) CNAME `status.electronicmailservices.com` to it. The marketing `/status` route is our own component view (`/readyz`); it does not leak tenant counts.

## Ops follow-ups that affect these checks

1. `infra/sidecars/apply-bounce-mta.sh` on the hub — bounce MX + UFW 25. Until this runs, monitor 5 may fail and VERP bounces black-hole.
2. `infra/sidecars/setup-mailbox-mta.sh` — inbound pipe for native mailboxes. Re-run after MTA recreate so 507 (over-quota) maps to Postfix TEMPFAIL.
3. Set `MAIL_BOUNCE_DOMAIN=bounce.electronicmailservices.com` on workers **only after** (1).
4. God Mode → Reputation: red "Sending health alert" if 24h delivered rate dropped >15 points vs 7d, or mail is accepted with zero terminal feedback in 24h.
