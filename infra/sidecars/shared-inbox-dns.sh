#!/usr/bin/env bash
# Publish MX + SPF + DKIM (CNAME to the platform mail selector) for the shared
# inbox domains. Idempotent. Needs CF_API_TOKEN (Zone:DNS:Edit on electronicmailservices.com).
#
# Does NOT touch apex MX (Google Workspace). Does NOT change existing records
# whose content already matches. Safe to re-run.
set -euo pipefail
ZONE="${CF_ZONE_ID:-684a69e6611aa6bd0c132ba8d484462b}"
TOK="${CF_API_TOKEN:?set CF_API_TOKEN}"
API="https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records"
SPF='v=spf1 include:_spf.electronicmailservices.com ~all'
DKIM_TARGET="mail._domainkey.electronicmailservices.com"

cf() {
  curl -sS -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" "$@"
}

ensure() {
  local type="$1" name="$2" content="$3" extra="${4:-}"
  local q="type=${type}&name=${name}"
  local existing
  existing=$(cf "${API}?${q}")
  local id
  id=$(printf '%s' "$existing" | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result") or []; print(r[0]["id"] if r else "")')
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])))' "$extra")
  if [ -n "$id" ]; then
    local have
    have=$(printf '%s' "$existing" | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"][0]; print(r.get("content",""))')
    local pri_have pri_want
    pri_have=$(printf '%s' "$existing" | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"][0]; print(r.get("priority",""))')
    pri_want=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("priority",""))' "$extra")
    if [ "$have" = "$content" ] && [ "$pri_have" = "$pri_want" ]; then
      echo "ok  $type $name (unchanged)"
      return
    fi
    echo "upd $type $name"
    cf -X PUT "${API}/${id}" --data "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   success", d.get("success"), d.get("errors") or "")'
  else
    echo "add $type $name"
    cf -X POST "$API" --data "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   success", d.get("success"), d.get("errors") or "")'
  fi
}

mx_body() {
  python3 -c 'import json,sys; print(json.dumps({"type":"MX","name":sys.argv[1],"content":"mail.electronicmailservices.com","priority":10,"ttl":3600,"proxied":False}))' "$1"
}
txt_body() {
  python3 -c 'import json,sys; print(json.dumps({"type":"TXT","name":sys.argv[1],"content":sys.argv[2],"ttl":3600}))' "$1" "$2"
}
cname_body() {
  python3 -c 'import json,sys; print(json.dumps({"type":"CNAME","name":sys.argv[1],"content":sys.argv[2],"ttl":3600,"proxied":False}))' "$1" "$2"
}

# agents.electronicmailservices.com — was empty. inbox.electronicmailservices.com already has MX from 2026-06.
ensure MX agents.electronicmailservices.com mail.electronicmailservices.com "$(mx_body agents)"
ensure TXT agents.electronicmailservices.com "$SPF" "$(txt_body agents "$SPF")"
ensure CNAME mail._domainkey.agents.electronicmailservices.com "$DKIM_TARGET" "$(cname_body mail._domainkey.agents "$DKIM_TARGET")"

ensure MX inbox.electronicmailservices.com mail.electronicmailservices.com "$(mx_body inbox)"
ensure TXT inbox.electronicmailservices.com "$SPF" "$(txt_body inbox "$SPF")"
ensure CNAME mail._domainkey.inbox.electronicmailservices.com "$DKIM_TARGET" "$(cname_body mail._domainkey.inbox "$DKIM_TARGET")"

echo "done"
