#!/usr/bin/env bash
# Activate native-mailbox RECEIVING on ems-mta. Configures Postfix to accept
# inbound for any domain that has active mailboxes and pipe each message to the
# ems API's /mta/inbound. The mailbox-domain set is DYNAMIC, so a small sync
# (cron) polls GET /mta/mailbox-domains and regenerates the maps.
#
# DELIBERATE activation: a domain only receives here once its MX points at
# mail.electronicmailservices.com — which redirects that domain's inbound mail away from
# wherever it lives now. Only do this for a domain dedicated to ems.
#
# Composes with the feedback-loop config (setup-feedback-mta.sh): it ADDS to
# transport_maps / smtpd_recipient_restrictions / relay_domains rather than
# replacing them. Additive + reversible: postfix check gates the reload.
#
# Prereq: /etc/postfix/feedback.secret already present (shared secret), API_URL.
set -euo pipefail
C=ems-mta
API="${API_URL:-https://api.electronicmailservices.com}"
ex() { docker exec "$C" sh -c "$1"; }

ex 'cp -n /etc/postfix/main.cf /etc/postfix/main.cf.bak.mb || true; cp -n /etc/postfix/master.cf /etc/postfix/master.cf.bak.mb || true'

# Pipe: POST the raw message to /mta/inbound with the envelope recipient.
ex 'cat > /etc/postfix/inbound-pipe.sh <<'\''EOS'\''
#!/bin/sh
S=$(cat /etc/postfix/feedback.secret 2>/dev/null); [ -n "$S" ] || exit 0
code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" -X POST "'"$API"'/mta/inbound" \
  -H "Authorization: Bearer $S" -H "X-Original-To: $1" \
  -H "Content-Type: message/rfc822" --data-binary @-)
# 507 = mailbox over quota → Postfix TEMPFAIL (exim/postfix pipe: 75) so the
# sender defers instead of us silently dropping.
[ "$code" = "507" ] && exit 75
exit 0
EOS
chmod 755 /etc/postfix/inbound-pipe.sh'

# Sync: regenerate the mailbox-domain maps from the API, then reload.
ex 'cat > /etc/postfix/sync-mailbox-domains.sh <<'\''EOS'\''
#!/bin/sh
S=$(cat /etc/postfix/feedback.secret 2>/dev/null); [ -n "$S" ] || exit 0
DOMS=$(curl -s -m 15 -H "Authorization: Bearer $S" "'"$API"'/mta/mailbox-domains" \
  | sed -n "s/.*\"domains\":\[\([^]]*\)\].*/\1/p" | tr -d "\" " | tr "," "\n" | grep .)
ACC=/etc/postfix/mailbox_accept.pcre; TR=/etc/postfix/mailbox_transport.pcre; RLY=/etc/postfix/mailbox_relay.pcre
: > "$ACC"; : > "$TR"; : > "$RLY"
for d in $DOMS; do
  e=$(printf "%s" "$d" | sed "s/\./\\\\./g")
  echo "/@${e}\$/   OK"           >> "$ACC"
  echo "/@${e}\$/   inboundpipe:" >> "$TR"
  echo "/^${e}\$/   mailbox"      >> "$RLY"
done
postfix reload >/dev/null 2>&1 || true
EOS
chmod 755 /etc/postfix/sync-mailbox-domains.sh'

# master.cf pipe service (once).
ex 'grep -q "^inboundpipe " /etc/postfix/master.cf || printf "\ninboundpipe unix - n n - - pipe\n  flags=Rq user=nobody argv=/etc/postfix/inbound-pipe.sh \${recipient}\n" >> /etc/postfix/master.cf'

# Compose with the feedback config: append our maps to the existing lists.
ex 'postconf -e "relay_domains = bounce.electronicmailservices.com pcre:/etc/postfix/mailbox_relay.pcre"
postconf -e "transport_maps = pcre:/etc/postfix/transport.pcre pcre:/etc/postfix/mailbox_transport.pcre"
postconf -e "smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unknown_recipient_domain, check_recipient_access pcre:/etc/postfix/inbound_ok.pcre, check_recipient_access pcre:/etc/postfix/mailbox_accept.pcre, check_sender_access lmdb:/etc/postfix/allowed_senders, reject"
touch /etc/postfix/mailbox_accept.pcre /etc/postfix/mailbox_transport.pcre /etc/postfix/mailbox_relay.pcre'

# Initial sync + validate + reload (or rollback).
ex '/etc/postfix/sync-mailbox-domains.sh; if postfix check; then postfix reload; echo RELOADED; else cp /etc/postfix/main.cf.bak.mb /etc/postfix/main.cf; cp /etc/postfix/master.cf.bak.mb /etc/postfix/master.cf; postfix reload || true; echo "RESTORED (check failed)"; exit 1; fi'

# Cron: keep the maps in sync as mailboxes are added/removed.
ex 'command -v crontab >/dev/null 2>&1 && (crontab -l 2>/dev/null | grep -v sync-mailbox-domains; echo "*/5 * * * * /etc/postfix/sync-mailbox-domains.sh") | crontab - || echo "note: no crontab in container — run sync-mailbox-domains.sh from the host on a timer"'
echo "Mailbox receiving configured. Point a dedicated domain's MX at mail.electronicmailservices.com to start receiving."
