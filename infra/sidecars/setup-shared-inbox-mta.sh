#!/usr/bin/env bash
# Wire OpenDKIM + sender maps for the shared inbox domains on ems-mta.
# Reuses the platform `mail` selector private key (DNS CNAMEs
# mail._domainkey.<domain> → mail._domainkey.electronicmailservices.com).
#
# Additive: does not recreate the container, does not touch bounce maps.
# Re-run after an MTA recreate (and after apply-bounce-mta.sh + setup-mailbox-mta.sh).
set -euo pipefail
C="${MTA_CONTAINER:-ems-mta}"
DOMAINS="${SHARED_INBOX_DOMAINS:-agents.electronicmailservices.com,inbox.electronicmailservices.com}"
KEY=/etc/opendkim/keys/electronicmailservices.com.private

ex() { docker exec "$C" sh -c "$1"; }

if ! docker inspect "$C" >/dev/null 2>&1; then
  echo "container $C not running" >&2
  exit 1
fi
if ! ex "test -s $KEY"; then
  echo "missing $KEY — generate the platform key first (see ems-mta.md)" >&2
  exit 1
fi

IFS=',' read -r -a list <<< "$DOMAINS"
for raw in "${list[@]}"; do
  d=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | xargs)
  [ -n "$d" ] || continue
  echo "domain $d"
  # KeyTable / SigningTable (boky layout). Same private key, per-domain d=.
  ex "grep -q 'mail._domainkey.${d}' /etc/opendkim/KeyTable 2>/dev/null || \
    echo 'mail._domainkey.${d} ${d}:mail:${KEY}' >> /etc/opendkim/KeyTable"
  ex "grep -q '*@${d}' /etc/opendkim/SigningTable 2>/dev/null || \
    echo '*@${d} mail._domainkey.${d}' >> /etc/opendkim/SigningTable"
  ex "grep -q '^${d}\$' /etc/opendkim/TrustedHosts 2>/dev/null || \
    echo '${d}' >> /etc/opendkim/TrustedHosts"
  # boky sender allow-list (envelope From). Permit our own domains only.
  ex "grep -q '^${d} ' /etc/postfix/allowed_senders 2>/dev/null || \
    echo '${d} OK' >> /etc/postfix/allowed_senders"
done

ex 'postmap lmdb:/etc/postfix/allowed_senders 2>/dev/null || postmap hash:/etc/postfix/allowed_senders'
# Reload OpenDKIM if the supervisor is there; otherwise postfix reload is enough
# for the sender map and the next opendkim spawn picks up KeyTable.
ex 'kill -HUP $(pidof opendkim) 2>/dev/null || true'
ex 'if postfix check; then postfix reload; echo RELOADED; else echo "postfix check failed" >&2; exit 1; fi'

if ex 'test -x /etc/postfix/sync-mailbox-domains.sh'; then
  ex '/etc/postfix/sync-mailbox-domains.sh && echo MAILBOX_MAPS_SYNCED'
else
  echo "note: setup-mailbox-mta.sh has not been applied — inbound maps will not update"
fi
echo "done"
