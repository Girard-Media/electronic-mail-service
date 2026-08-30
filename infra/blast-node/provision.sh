#!/usr/bin/env bash
# provision — run every stage in order. Idempotent; safe to re-run.
#   ./provision.sh            apply
#   ./provision.sh --dry-run  print each stage, change nothing
set -euo pipefail
cd "$(dirname "$0")"
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 2; }
[[ -f node.env ]] || { echo "FATAL: node.env missing — copy node.env.example and fill it in"; exit 2; }

DRY=false
[[ "${1:-}" == "--dry-run" ]] && DRY=true

STAGES=(00-preflight 10-base 20-postfix 30-opendkim 40-rspamd 50-dmarc 60-agent 70-tls 90-verify)

for s in "${STAGES[@]}"; do
  echo; echo "═══ ${s} ═══"
  if $DRY; then
    echo "(dry run) would execute ./${s}.sh"
    continue
  fi
  if ! "./${s}.sh"; then
    echo
    echo "STAGE FAILED: ${s}"
    echo "The node is NOT verified and must not be promoted to ACTIVE."
    exit 1
  fi
done

echo
echo "════════════════════════════════════════════════════════════"
echo "  Provisioning complete and verified."
echo "  Verdict: /opt/ems/state/verify.json"
echo "  Promote the node in the registry, then start the agent:"
echo "    systemctl enable --now ems-fleet-agent ems-maillog-shipper"
echo
