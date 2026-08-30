#!/usr/bin/env bash
# 50-dmarc — inbound alignment checks. Backlog: E03-030.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq opendmarc

cat > /etc/opendmarc.conf <<EOF
AuthservID              ${NODE_HOSTNAME}
PidFile                 /run/opendmarc/opendmarc.pid
RejectFailures          false
Syslog                  true
TrustedAuthservIDs      ${NODE_HOSTNAME}
Socket                  inet:8893@127.0.0.1
UMask                   0002
UserID                  opendmarc:opendmarc
IgnoreHosts             /etc/opendmarc/ignore.hosts
HistoryFile             /var/lib/opendmarc/opendmarc.dat
EOF

install -d -m 0755 /etc/opendmarc /var/lib/opendmarc
chown opendmarc:opendmarc /var/lib/opendmarc
cat > /etc/opendmarc/ignore.hosts <<EOF
127.0.0.1
localhost
${WORKERS_PRIVATE_IP}
EOF

systemctl enable --now opendmarc
systemctl restart opendmarc
echo "  50-dmarc: done"
