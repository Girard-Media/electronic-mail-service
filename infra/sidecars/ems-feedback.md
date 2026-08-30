# ems feedback loop — bounce / complaint ingestion (runbook)

Closes the delivery lifecycle: a recipient MX bounces or an ISP files a spam
complaint → our MTA routes that report into ems → it parses (DSN/ARF),
recovers the original email id, and enqueues onto the `feedback` queue the workers
drain (status → `bounced`/`complained`, webhook fan-out, auto-suppress). Pairs
with `ems-mta.md`.

## ✅ STATUS: LIVE (activated 2026-06-25) — via HTTP pipe, not LMTP
The shipped activation uses a **Postfix pipe → curl → `POST /api/v1/mta/raw`**
path (simpler than the LMTP `feedback-ingest` service, since `curl` is already in
boky/postfix and the API endpoint is a stable HTTPS target — Coolify container
names are UUID-based and churn per deploy). What's live:
- **DNS**: `bounce.electronicmailservices.com` TXT SPF (`v=spf1 ip4:31.220.104.223 ip4:31.220.104.207 -all`) + `MX 10 mail.electronicmailservices.com` (A → `.223`).
- **MTA** (`ems-mta`): additive `relay_domains` + `check_recipient_access` (accept) +
  `pcre` transport piping `@bounce.electronicmailservices.com` → `/etc/postfix/feedback-pipe.sh` →
  curl to `/mta/raw`. Reproduce after any MTA recreate with **`setup-feedback-mta.sh`**
  (in this dir) + the one-time secret file (see that script's header).
- **API**: `POST /mta/raw` (shared secret) parses raw DSN/ARF and enqueues; `MTA_FEEDBACK_SECRET` set in Coolify.
- **VERP**: `MAIL_BOUNCE_DOMAIN=bounce.electronicmailservices.com` set on the workers app (envelope return-path on).
- Verified: injected DSN → `delivered via feedbackpipe` + `/mta/raw` → `{"queued":1}`.

> The LMTP `apps/feedback-ingest` service below remains a valid alternative design;
> it is NOT the deployed path. Coolify env gotcha: the create-env POST must NOT
> include `is_build_time` (Coolify 422s it); send only key/value/is_preview, then
> redeploy so the container is recreated with the new env.

## How correlation works (VERP)
Outbound MTA sends now use an **envelope sender we own**, keyed to the email id:

```
MAIL FROM: <bounce+<emailId>@bounce.electronicmailservices.com>
```

The `From:` header is untouched (still the customer's address) and we DKIM-sign
with the customer domain's key, so **DMARC stays aligned on DKIM** regardless of
this envelope domain. Any DSN the remote MX returns goes to that exact address →
the ingest decodes `<emailId>` straight from the envelope. ARF complaints (which
rarely hit the VERP address) are correlated from the embedded original's
`X-Entity-Ref-ID` / `Message-ID: <id@electronicmailservices.com>` instead.

Controlled by `MAIL_BOUNCE_DOMAIN` on the **workers** — **opt-in, fail-safe**.
Leave it UNSET until steps 1–4 below are live; enabling it before the inbound
path exists would send bounces to a black hole instead of the customer's own
domain. Set it (`MAIL_BOUNCE_DOMAIN=bounce.electronicmailservices.com`) and redeploy the
workers as the **final** step, once MX + Postfix transport + feedback-ingest are
all up.

## 1. DNS (Cloudflare zone electronicmailservices.com, DNS-only)
```
MX   bounce.electronicmailservices.com   10 mail.electronicmailservices.com.
TXT  bounce.electronicmailservices.com   "v=spf1 ip4:31.220.104.223 ip4:31.220.104.207 -all"
MX   fbl.electronicmailservices.com      10 mail.electronicmailservices.com.     # optional, for FBL reports
TXT  fbl.electronicmailservices.com      "v=spf1 ip4:31.220.104.223 ip4:31.220.104.207 -all"
```
> SPF on the bounce domain keeps the return-path itself authenticated. `mail.electronicmailservices.com`
> A's to `31.220.104.223` (see ems-mta.md). After any MTA recreate run
> `infra/sidecars/apply-bounce-mta.sh` on the hub.

## 2. Deploy feedback-ingest
Monorepo app `apps/feedback-ingest` — an LMTP listener (port `2400`) that enqueues
to the shared `feedback` queue. It needs only `QUEUE_URL` (same Valkey the workers
use). **No `MTA_FEEDBACK_SECRET`** — the internal LMTP→queue path is unauthenticated
by network trust, not by secret (that secret only gates the public HTTP endpoint).

Coolify (railpack, like api/workers), on the `coolify` network so Postfix reaches
it by name:
```
RAILPACK_NODE_VERSION=22
QUEUE_URL=<same as workers>        # redis://… / valkey
INGEST_LMTP_PORT=2400              # default
# start command:  pnpm --filter @ems/feedback-ingest start
```
Container name on the coolify network: `ems-feedback` (used in the Postfix
transport below). Do **not** publish 2400 publicly — container-network only.

## 3. Wire Postfix → LMTP (on ems-mta, .207)
boky/postfix is a send relay; make it also **accept inbound** for the bounce/FBL
domains and hand them to LMTP:
```bash
docker exec ems-mta sh -c '
  postconf -e "relay_domains = bounce.electronicmailservices.com, fbl.electronicmailservices.com"
  postconf -e "transport_maps = regexp:/etc/postfix/transport.pcre"
  printf "/.*@bounce\\.ems\\.com/  lmtp:[ems-feedback]:2400\n/.*@fbl\\.ems\\.com/     lmtp:[ems-feedback]:2400\n" > /etc/postfix/transport.pcre
  postfix reload'
```
> `relay_domains` makes Postfix accept mail for those domains (catch-all, no
> per-mailbox map); `transport_maps` forwards every address at them to the
> ingest's LMTP. The `+<emailId>` survives intact in the RCPT TO for the ingest
> to decode.

## 4. Firewall — inbound 25 must be open
DSNs/FBLs arrive **inbound** on TCP/25 to `31.220.104.223`. Outbound 25 is already
open (verified); confirm inbound 25 is allowed (Hostinger VPS firewall) or the
reports never land.

## 5. Verify end-to-end
```bash
# Send to an address that hard-bounces (e.g. a non-existent mailbox on a domain
# you control), then watch:
docker logs -f ems-feedback        # -> "[ingest] N event(s) … bounced"
# the email row flips to status=bounced, a webhook fires, recipient is suppressed.
```
A quick unit check of the parser (no MTA needed) lives in the providers package:
`parseDeliveryReport(rawDsn)` — proven against hard/soft DSN + ARF samples.

## Notes / top-tier MTA follow-ups
- The public `POST /mta/feedback` (shared-secret) remains for out-of-band sources
  (e.g. a provider that webhooks complaints). Internal loop doesn't use it.
- Next: List-Unsubscribe + One-Click (RFC 8058), per-receiver throttling, MTA-STS
  / TLS-RPT, dedicated IP + warmup, ARC sealing, BIMI. See planning/MASTER_PLAN.md.
