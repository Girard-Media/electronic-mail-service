#!/usr/bin/env bash
# 00-preflight — refuse to build a node on an address that cannot send.
# Backlog: E03-011. A dirty IP is worse than no IP.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
[[ -f node.env ]] || { echo "FATAL: node.env missing — copy node.env.example"; exit 2; }
source node.env

: "${NODE_IP:?}" "${NODE_HOSTNAME:?}"
fail=0
say() { printf '  %-22s %s\n' "$1" "$2"; }

echo; echo "  PREFLIGHT  ${NODE_IP}  (${NODE_HOSTNAME})"; echo "  $(printf '%.0s─' {1..60})"

# ── rDNS must forward-confirm. Receivers check this before anything else.
ptr=$(dig +short -x "$NODE_IP" 2>/dev/null | sed 's/\.$//' || true)
if [[ -z "$ptr" ]]; then
  say "PTR" "MISSING — the provider must grant rDNS control"; fail=1
else
  say "PTR" "$ptr"
  [[ "$ptr" == "$NODE_HOSTNAME" ]] || { say "" "does not match NODE_HOSTNAME"; fail=1; }
  fwd=$(dig +short A "$ptr" 2>/dev/null | tail -1 || true)
  if [[ "$fwd" == "$NODE_IP" ]]; then say "forward-confirm" "yes"
  else say "forward-confirm" "NO (A ${ptr} -> ${fwd:-nothing})"; fail=1; fi
fi

# ── Port 25 egress. Providers block it silently on new accounts.
egress_ok=0
for mx in gmail-smtp-in.l.google.com mta7.am0.yahoodns.net; do
  if timeout 10 bash -c "exec 3<>/dev/tcp/${mx}/25 && head -1 <&3" 2>/dev/null | grep -q '^220'; then
    say "egress :25" "ok  ${mx}"; egress_ok=1
  else
    say "egress :25" "FAIL ${mx}"
  fi
done
[[ $egress_ok -eq 1 ]] || { say "" "no port 25 egress — this node cannot send"; fail=1; }

# ── Blocklists. Critical zones only; the full sweep lives in ip-diligence.mts.
rev=$(echo "$NODE_IP" | awk -F. '{print $4"."$3"."$2"."$1}')
for zone in zen.spamhaus.org b.barracudacentral.org bl.spamcop.net; do
  ans=$(dig +short A "${rev}.${zone}" 2>/dev/null | head -1 || true)
  case "$ans" in
    "")             say "$zone" "clean" ;;
    127.255.255.*)  say "$zone" "INCONCLUSIVE (resolver refused) — check manually" ;;
    *)              say "$zone" "LISTED ${ans}"; fail=1 ;;
  esac
done

echo
if [[ $fail -ne 0 ]]; then
  echo "  PREFLIGHT FAILED — do not provision this address."
  echo "  Release it and take another. Cheap now, catastrophic later."; echo
  exit 1
fi
echo "  PREFLIGHT PASSED"; echo
