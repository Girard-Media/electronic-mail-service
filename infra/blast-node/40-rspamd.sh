#!/usr/bin/env bash
# 40-rspamd — LOCAL content scoring only. Backlog: E03-027..E03-029.
#
# Every module that contacts an external service is disabled: the third-party
# constraint in planning/VISION.md §2.4 applies to the node too, and pre-send
# scoring must not leak customer content anywhere.
set -euo pipefail
cd "$(dirname "$0")"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq rspamd redis-server

install -d /etc/rspamd/local.d

cat > /etc/rspamd/local.d/options.inc <<'EOF'
# No outbound lookups. Local scoring only.
dns { nameserver = ["127.0.0.53"]; }
EOF

# Disable everything that phones home.
for m in fuzzy_check.conf clickhouse.conf reputation.conf url_reputation.conf \
         rbl.conf surbl.conf emails.conf dkim_signing.conf; do
  echo "enabled = false;" > "/etc/rspamd/local.d/${m}"
done

cat > /etc/rspamd/local.d/worker-normal.inc <<'EOF'
bind_socket = "127.0.0.1:11333";
EOF
cat > /etc/rspamd/local.d/worker-controller.inc <<'EOF'
bind_socket = "127.0.0.1:11334";
EOF

# rspamd runs as a scorer we call before sending; it is NOT a Postfix milter
# here. The pre-send gate in @ems/router queries it over HTTP (E07-066).
systemctl enable --now redis-server rspamd
systemctl restart rspamd
echo "  40-rspamd: done  (local scorer on 127.0.0.1:11333)"
