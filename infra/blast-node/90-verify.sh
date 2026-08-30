#!/usr/bin/env bash
# 90-verify — THE GATE. Backlog: E03-034, E03-035.
#
# A node that has not passed this is not eligible for routing. The registry
# refuses VERIFYING -> ACTIVE without all three flags (packages/fleet isRoutable).
# Exits non-zero on any failure and writes a machine-readable verdict.
set -uo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env

VERDICT=/opt/ems/state/verify.json
relay_ok=false; dkim_ok=false; egress_ok=false; ipv6_ok=false; rspamd_ok=false
notes=()
say() { printf '  %-24s %s\n' "$1" "$2"; }
note() { notes+=("$1"); }

echo; echo "  90-VERIFY  ${NODE_HOSTNAME}  ${NODE_IP}"; echo "  $(printf '%.0s─' {1..60})"

# ── T1  OPEN RELAY. Connect to the node's PUBLIC address so the source is the
#        node's own IP, which is deliberately NOT in mynetworks. A 2xx on RCPT
#        TO an external domain means this box relays for the world: Sev-1.
relay_reply=$(timeout 20 bash -c '
  exec 3<>/dev/tcp/'"$NODE_IP"'/25 || exit 9
  read -r _ <&3
  printf "EHLO relaytest.invalid\r\n" >&3;            sleep 0.4; while read -t 0.4 -r _ <&3; do :; done
  printf "MAIL FROM:<probe@relaytest.invalid>\r\n" >&3; sleep 0.4; while read -t 0.4 -r _ <&3; do :; done
  printf "RCPT TO:<victim@example.net>\r\n" >&3;       sleep 0.6; read -t 3 -r line <&3; echo "$line"
  printf "QUIT\r\n" >&3
' 2>/dev/null | tr -d '\r')

case "$relay_reply" in
  5*) relay_ok=true;  say "open relay test" "PASS  refused: ${relay_reply:0:56}" ;;
  2*) relay_ok=false; say "open relay test" "FAIL  ACCEPTED — THIS IS AN OPEN RELAY"; note "open relay" ;;
  "") relay_ok=false; say "open relay test" "FAIL  no reply from ${NODE_IP}:25"; note "smtpd unreachable on the public address" ;;
  *)  relay_ok=false; say "open relay test" "FAIL  unexpected: ${relay_reply:0:56}"; note "unexpected relay reply" ;;
esac

# ── T2  DKIM END-TO-END. Route a throwaway domain to a capture transport, send a
#        message through Postfix, and prove a DKIM-Signature was actually added.
#        Testing the key against DNS alone would not prove the milter is wired.
CAP=/var/spool/ems-dkim-capture.eml
if ! postconf -M | grep -q '^ems-capture'; then
  postconf -M "ems-capture/unix=ems-capture unix - n n - - pipe flags=Rq user=nobody argv=/usr/bin/tee -a ${CAP}"
fi
grep -q '^dkimprobe.invalid' /etc/postfix/transport 2>/dev/null || \
  echo "dkimprobe.invalid ems-capture:" >> /etc/postfix/transport
postmap /etc/postfix/transport
: > "$CAP"; chmod 0666 "$CAP"
systemctl reload postfix; sleep 1

first_domain=$(echo "$ALLOWED_SENDER_DOMAINS" | awk '{print $1}')
printf 'From: verify@%s\nTo: probe@dkimprobe.invalid\nSubject: ems dkim verify\n\nprobe\n' \
  "$first_domain" | sendmail -f "verify@${first_domain}" probe@dkimprobe.invalid

for _ in $(seq 1 20); do grep -qi '^DKIM-Signature:' "$CAP" && break; sleep 1; done
if grep -qi '^DKIM-Signature:' "$CAP"; then
  sel=$(grep -io 's=[a-z0-9._-]*' "$CAP" | head -1)
  dkim_ok=true; say "dkim sign test" "PASS  signed (${sel})"
else
  dkim_ok=false; say "dkim sign test" "FAIL  no DKIM-Signature header added"
  note "opendkim did not sign — check the milter, the KeyTable, and that the private key is installed"
fi
: > "$CAP"

# ── T2b DKIM key matches what is published in DNS.
if command -v opendkim-testkey >/dev/null; then
  if opendkim-testkey -d "$first_domain" -s ems -vvv 2>&1 | grep -q 'key OK'; then
    say "dkim dns match" "PASS  private key matches the published TXT"
  else
    say "dkim dns match" "WARN  key does not match DNS (publish the TXT, then re-run)"
    note "DKIM public key not published or mismatched"
  fi
fi

# ── T3  PORT 25 EGRESS to each major receiver.
ok=0; total=0
for mx in gmail-smtp-in.l.google.com outlook-com.olc.protection.outlook.com mta7.am0.yahoodns.net; do
  total=$((total+1))
  if timeout 10 bash -c "exec 3<>/dev/tcp/${mx}/25 && head -1 <&3" 2>/dev/null | grep -q '^220'; then
    ok=$((ok+1))
  fi
done
if [[ $ok -eq $total ]]; then egress_ok=true; say "egress :25" "PASS  ${ok}/${total} receivers"
elif [[ $ok -gt 0 ]]; then egress_ok=false; say "egress :25" "FAIL  only ${ok}/${total} — partial block"; note "partial port 25 block"
else egress_ok=false; say "egress :25" "FAIL  0/${total} — port 25 is blocked"; note "no port 25 egress"; fi

# ── T4  IPv6 must be off for outbound mail.
if [[ "$(postconf -h inet_protocols)" == "ipv4" ]]; then
  ipv6_ok=true; say "ipv6 disabled" "PASS"
else
  ipv6_ok=false; say "ipv6 disabled" "FAIL  inet_protocols is not ipv4"; note "IPv6 enabled for outbound"
fi

# ── T5  Local content scorer answering (the pre-send gate depends on it).
if curl -sf --max-time 5 http://127.0.0.1:11333/ping >/dev/null 2>&1; then
  rspamd_ok=true; say "rspamd scorer" "PASS"
else
  rspamd_ok=false; say "rspamd scorer" "FAIL  not answering on 127.0.0.1:11333"; note "rspamd down"
fi

# ── Verdict. relay + dkim + egress are the three registry flags.
install -d -m 0755 /opt/ems/state
printf '{"nodeHostname":"%s","nodeIp":"%s","relayTestOk":%s,"dkimTestOk":%s,"egress25Ok":%s,"ipv6Disabled":%s,"rspamdOk":%s,"verifiedAt":"%s"}\n' \
  "$NODE_HOSTNAME" "$NODE_IP" "$relay_ok" "$dkim_ok" "$egress_ok" "$ipv6_ok" "$rspamd_ok" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$VERDICT"

echo; echo "  $(printf '%.0s─' {1..60})"
if [[ "$relay_ok" == true && "$dkim_ok" == true && "$egress_ok" == true ]]; then
  echo "  VERIFY PASSED — node may be promoted to ACTIVE"
  echo "  verdict: ${VERDICT}"; echo
  exit 0
fi
echo "  VERIFY FAILED — this node must NOT carry traffic"
for n in "${notes[@]}"; do echo "    · $n"; done
echo; exit 1
