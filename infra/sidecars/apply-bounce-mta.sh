#!/usr/bin/env bash
# Wire bounce.electronicmailservices.com inbound on the live ems-mta (hub .223).
# Safe vs open-relay: internet clients may only deliver to bounce.electronicmailservices.com.
# Re-run after any MTA recreate.
set -euo pipefail
C=ems-mta

ex() { docker exec "$C" sh -c "$1"; }

if ! docker exec "$C" test -s /etc/postfix/feedback.secret; then
  docker exec ems printenv MTA_FEEDBACK_SECRET \
    | docker exec -i "$C" sh -c 'cat > /etc/postfix/feedback.secret && chmod 600 /etc/postfix/feedback.secret'
fi
bytes=$(ex 'wc -c < /etc/postfix/feedback.secret' | tr -d '[:space:]')
if [ "${bytes:-0}" -lt 8 ]; then
  echo "feedback.secret missing/short" >&2
  exit 1
fi
echo "secret_bytes=$bytes"

# Pipe DSNs to the API on the docker network (no public hairpin).
docker exec -i "$C" sh -c 'cat > /etc/postfix/feedback-pipe.sh && chmod 755 /etc/postfix/feedback-pipe.sh' <<'EOS'
#!/bin/sh
S=$(cat /etc/postfix/feedback.secret 2>/dev/null); [ -n "$S" ] || exit 0
curl -s -m 15 -X POST "http://ems:8787/mta/raw" \
  -H "Authorization: Bearer $S" -H "X-Original-To: $1" \
  -H "Content-Type: message/rfc822" --data-binary @- >/dev/null 2>&1
exit 0
EOS

MAP=pcre
if ! ex 'postconf -m' | grep -qx pcre; then
  MAP=regexp
fi
docker exec -i "$C" sh -c "cat > /etc/postfix/inbound_ok.${MAP}" <<'EOS'
/@bounce\.ems\.com$/   OK
EOS
docker exec -i "$C" sh -c "cat > /etc/postfix/transport.${MAP}" <<'EOS'
/@bounce\.ems\.com$/   feedbackpipe:
EOS

ex 'grep -q "^feedbackpipe " /etc/postfix/master.cf || printf "\nfeedbackpipe unix - n n - - pipe\n  flags=Rq user=nobody argv=/etc/postfix/feedback-pipe.sh \${recipient}\n" >> /etc/postfix/master.cf'

ex 'grep -q "^bounce.electronicmailservices.com" /etc/postfix/allowed_senders || echo bounce.electronicmailservices.com OK >> /etc/postfix/allowed_senders
postmap lmdb:/etc/postfix/allowed_senders'

# Do not become an open relay: client/sender DUNNO for the internet, then
# reject_unauth_destination with relay_domains = bounce only.
ex 'postconf -e "inet_protocols = ipv4"
postconf -e "relay_domains = bounce.electronicmailservices.com"
postconf -e "transport_maps = '"$MAP"':/etc/postfix/transport.'"$MAP"'"
postconf -e "smtpd_client_restrictions = permit_mynetworks, permit_sasl_authenticated"
postconf -e "smtpd_sender_restrictions = permit_mynetworks"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unknown_recipient_domain, check_recipient_access '"$MAP"':/etc/postfix/inbound_ok.'"$MAP"', check_sender_access lmdb:/etc/postfix/allowed_senders, reject"'

if ex 'postfix check'; then
  ex 'postfix reload'
  echo RELOADED map=$MAP
else
  echo "postfix check failed" >&2
  exit 1
fi
ex 'postconf -n inet_protocols relay_domains transport_maps smtpd_client_restrictions smtpd_sender_restrictions smtpd_relay_restrictions smtpd_recipient_restrictions'

# Publish SMTP on the hub (MTA is on the hostssh bridge, not host network).
if ! ss -lnt | grep -qE ':25\s'; then
  docker rm -f ems-smtp-in >/dev/null 2>&1 || true
  docker run -d --name ems-smtp-in --restart unless-stopped \
    --network hostssh -p 25:25 \
    alpine/socat TCP4-LISTEN:25,fork,reuseaddr TCP4:ems-mta:25
  echo PUBLISHED_25
else
  echo HOST_25_ALREADY_LISTENING
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 25/tcp comment 'ems-mta inbound bounce' || true
  echo UFW_25
fi
