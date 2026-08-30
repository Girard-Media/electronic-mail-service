#!/usr/bin/env bash
# 30-opendkim — multi-domain signing. Idempotent. Backlog: E03-025, E03-026.
#
# Private keys are materialised from the encrypted value in Postgres by the
# fleet-agent. This stage only prepares the structure; it never prints a key.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq opendkim opendkim-tools

install -d -m 0700 -o opendkim -g opendkim /etc/opendkim/keys
install -d -m 0700 -o opendkim -g opendkim /opt/ems/dkim
mountpoint -q /etc/opendkim/keys || mount --bind /opt/ems/dkim /etc/opendkim/keys 2>/dev/null || true
grep -q '/opt/ems/dkim /etc/opendkim/keys' /etc/fstab || \
  echo "/opt/ems/dkim /etc/opendkim/keys none bind 0 0" >> /etc/fstab

cat > /etc/opendkim.conf <<EOF
Syslog                  yes
SyslogSuccess           yes
LogWhy                  no
Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no
OversignHeaders         From
AutoRestart             yes
AutoRestartRate         10/1h
UserID                  opendkim:opendkim
Socket                  inet:8891@127.0.0.1
PidFile                 /run/opendkim/opendkim.pid
UMask                   007
MinimumKeyBits          2048
KeyTable                refile:/etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
ExternalIgnoreList      refile:/etc/opendkim/TrustedHosts
InternalHosts           refile:/etc/opendkim/TrustedHosts
EOF

touch /etc/opendkim/KeyTable /etc/opendkim/SigningTable
cat > /etc/opendkim/TrustedHosts <<EOF
127.0.0.1
localhost
${WORKERS_PRIVATE_IP}
EOF

# Register each authorised sending domain. The agent drops the key file in.
for d in $ALLOWED_SENDER_DOMAINS; do
  install -d -m 0700 -o opendkim -g opendkim "/etc/opendkim/keys/${d}"
  grep -q "^ems._domainkey.${d} " /etc/opendkim/KeyTable 2>/dev/null || \
    echo "ems._domainkey.${d} ${d}:ems:/etc/opendkim/keys/${d}/ems.private" >> /etc/opendkim/KeyTable
  grep -q "^\*@${d} " /etc/opendkim/SigningTable 2>/dev/null || \
    echo "*@${d} ems._domainkey.${d}" >> /etc/opendkim/SigningTable
done

chown -R opendkim:opendkim /etc/opendkim
chmod 0640 /etc/opendkim/KeyTable /etc/opendkim/SigningTable /etc/opendkim/TrustedHosts
systemctl enable --now opendkim
systemctl restart opendkim
echo "  30-opendkim: done  (keys are installed by fleet-agent, not by this script)"
