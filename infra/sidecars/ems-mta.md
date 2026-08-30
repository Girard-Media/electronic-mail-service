# ems-mta — self-hosted sending MTA (portability runbook)

Shared `boky/postfix` sidecar on the **hostssh hub `.223`** (`--network hostssh`).
A hub rebuild will NOT recreate it — follow this to restore. ems workers relay
`SMTP_URL=smtp://ems-mta:25`. Outbound is DKIM-signed to Google (`status=sent 250 OK`).

## What it is
- Image: `boky/postfix` (Postfix + OpenDKIM).
- Network: `hostssh` (workers reach it by name `ems-mta`).
- The worker relays to it: `SMTP_URL=smtp://ems-mta:25` (plaintext on the trusted
  container network; the worker also sets `tls.rejectUnauthorized=false` for the STARTTLS case).
- DKIM keys persist on the host at `/opt/ems-mta/dkim` → mounted to `/etc/opendkim/keys`.

## Recreate
```bash
mkdir -p /opt/ems-mta/dkim
docker rm -f ems-mta 2>/dev/null
docker run -d --name ems-mta --restart unless-stopped \
  --network hostssh -p 25:25 \
  -e ALLOWED_SENDER_DOMAINS="electronicmailservices.com mail.hostssh.com hostssh.com bounce.electronicmailservices.com" \
  -e POSTFIX_myhostname=mail.hostssh.com \
  -e POSTFIX_inet_protocols=ipv4 \
  -e POSTFIX_smtpd_tls_security_level=none \
  -v /opt/ems-mta/dkim:/etc/opendkim/keys \
  boky/postfix

# DKIM key (only if /opt/ems-mta/dkim is empty — else it persists):
docker exec ems-mta sh -c 'mkdir -p /etc/opendkim/keys/electronicmailservices.com && \
  cd /etc/opendkim/keys/electronicmailservices.com && opendkim-genkey -b 2048 -d electronicmailservices.com -s mail && \
  cp mail.private /etc/opendkim/keys/electronicmailservices.com.private && \
  chown -R opendkim:opendkim /etc/opendkim/keys && chmod 600 /etc/opendkim/keys/electronicmailservices.com.private'
docker restart ems-mta
docker exec ems-mta cat /etc/opendkim/keys/electronicmailservices.com/mail.txt   # -> publish DKIM TXT
```
> `POSTFIX_smtpd_tls_security_level=none` makes the internal hop plaintext so nodemailer doesn't
> trip on the self-signed STARTTLS cert (persisted, vs the runtime `postconf` we set the first time).

## DNS (Cloudflare zone electronicmailservices.com `684a69e6…`, DNS-only) — live 2026-08-20
- `A mail.electronicmailservices.com → 31.220.104.223` (grey; bounce MX target)
- `TXT _spf.electronicmailservices.com  "v=spf1 ip4:31.220.104.223 ~all"` (what customer domains include)
- `TXT electronicmailservices.com  "v=spf1 ip4:31.220.104.223 include:_spf.google.com include:_spf.electronicmailservices.com ~all"`
- `TXT bounce.electronicmailservices.com  "v=spf1 ip4:31.220.104.223 ip4:31.220.104.207 -all"`
- `MX bounce.electronicmailservices.com → mail.electronicmailservices.com`
- `TXT mail._domainkey.electronicmailservices.com  "v=DKIM1; h=sha256; k=rsa; p=<from mail.txt>"`
- `TXT _dmarc.electronicmailservices.com  "v=DMARC1; p=none; rua=mailto:dmarc@electronicmailservices.com"`
- Apex MX stays Google Workspace — do not point `electronicmailservices.com` MX at this MTA.
- Shared inbox domains (apply `infra/sidecars/shared-inbox-dns.sh`, then `setup-shared-inbox-mta.sh` on the box):
  - `MX agents.electronicmailservices.com → mail.electronicmailservices.com` (inbox.electronicmailservices.com MX live since 2026-06)
  - `TXT agents.electronicmailservices.com` / `inbox.electronicmailservices.com`  `"v=spf1 include:_spf.electronicmailservices.com ~all"`
  - `CNAME mail._domainkey.agents.electronicmailservices.com` / `inbox.electronicmailservices.com` → `mail._domainkey.electronicmailservices.com`

## Deliverability TODO (inbox placement, not just acceptance)
- **PTR**: hub `.223` is `mail.hostssh.com` (shared MTA HELO). Leave it — do not steal
  hostssh FCrDNS. After recreate run `infra/sidecars/apply-bounce-mta.sh` (bounce inbound
  + `inet_protocols=ipv4` + host `:25` + UFW). IPv6 PTR on `.223` stays the generic
  `srv726571.hstgr.cloud`; outbound is IPv4-only after the apply script.
- **MTA-STS** (RFC 8461): policy is served by the API at `/.well-known/mta-sts.txt` (mode `testing`).
  To activate: (1) route `mta-sts.electronicmailservices.com` to the API in Coolify with a LE cert [needs Coolify
  access — currently ISP-filtered]; (2) publish `TXT _mta-sts.electronicmailservices.com "v=STSv1; id=<unix-ts>"` and
  `CNAME mta-sts.electronicmailservices.com → electronicmailservices.com` (or A → .223); (3) verify the policy fetches over https;
  (4) flip `testing → enforce` after TLS-RPT is clean. Don't publish the `_mta-sts` TXT until the policy
  actually serves. Primarily protects electronicmailservices.com **inbound** — higher value once native mailboxes ship.
- **TLS-RPT** (RFC 8460): publish `TXT _smtp._tls.electronicmailservices.com "v=TLSRPTv1; rua=mailto:tlsrpt@electronicmailservices.com"`
  once an inbox/endpoint can receive reports (use an `https:` rua to avoid the inbound-mail dependency).
- **Dedicated IP + warmup** for production volume (the App box IP is shared/cold).
- Tighten DMARC `p=none → quarantine` after monitoring `rua` reports.
- Outbound port 25 from `.223` is **open** (verified to Google). hotmail/icloud may defer on a cold IP.
