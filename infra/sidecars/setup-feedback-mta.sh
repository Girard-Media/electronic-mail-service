#!/usr/bin/env bash
# Configure ems-mta (boky/postfix) to ACCEPT inbound bounce.electronicmailservices.com
# mail and pipe each DSN/ARF report to the ems API's /mta/raw endpoint
# (curl over https). Re-run this AFTER any ems-mta recreate — the container
# is ephemeral, so this config is lost on rebuild (see ems-mta.md).
#
# Prereqs (one-time): the secret file must exist in the container —
#   SECRET from ~/Documents/PROJECTS/DEV OPS/.env (MTA_FEEDBACK_SECRET):
#   printf '%s' "$SECRET" | docker exec -i ems-mta sh -c \
#     'cat > /etc/postfix/feedback.secret && chmod 600 /etc/postfix/feedback.secret'
#
# Fully additive + reversible: backs up configs, validates with `postfix check`,
# reloads ONLY if the check passes (else restores). Run on the hub (.223).
# Prefer apply-bounce-mta.sh (also publishes host :25 + UFW + ipv4-only).
set -euo pipefail
C=ems-mta
ex() { docker exec "$C" sh -c "$1"; }

ex 'cp -n /etc/postfix/main.cf /etc/postfix/main.cf.bak.fb || true; cp -n /etc/postfix/master.cf /etc/postfix/master.cf.bak.fb || true'

ex 'cat > /etc/postfix/feedback-pipe.sh <<'\''EOS'\''
#!/bin/sh
# $1 = original recipient (bounce+<emailId>@bounce.electronicmailservices.com)
S=$(cat /etc/postfix/feedback.secret 2>/dev/null); [ -n "$S" ] || exit 0
curl -s -m 15 -X POST "https://api.electronicmailservices.com/mta/raw" \
  -H "Authorization: Bearer $S" -H "X-Original-To: $1" \
  -H "Content-Type: message/rfc822" --data-binary @- >/dev/null 2>&1
exit 0
EOS
chmod 755 /etc/postfix/feedback-pipe.sh'

ex 'printf "/@bounce\\.ems\\.com\$/   OK\n" > /etc/postfix/inbound_ok.pcre
printf "/@bounce\\.ems\\.com\$/   feedbackpipe:\n" > /etc/postfix/transport.pcre'

ex 'grep -q "^feedbackpipe " /etc/postfix/master.cf || printf "\nfeedbackpipe unix - n n - - pipe\n  flags=Rq user=nobody argv=/etc/postfix/feedback-pipe.sh \${recipient}\n" >> /etc/postfix/master.cf'

ex 'postconf -e "relay_domains = bounce.electronicmailservices.com"
postconf -e "transport_maps = pcre:/etc/postfix/transport.pcre"
postconf -e "smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unknown_recipient_domain, check_recipient_access pcre:/etc/postfix/inbound_ok.pcre, check_sender_access lmdb:/etc/postfix/allowed_senders, reject"'

if ex 'postfix check'; then ex 'postfix reload'; echo RELOADED; else
  ex 'cp /etc/postfix/main.cf.bak.fb /etc/postfix/main.cf; cp /etc/postfix/master.cf.bak.fb /etc/postfix/master.cf; postfix reload || true'
  echo "RESTORED (postfix check failed)"; exit 1
fi
