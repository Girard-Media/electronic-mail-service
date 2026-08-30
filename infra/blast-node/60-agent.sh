#!/usr/bin/env bash
# 60-agent — fleet-agent + maillog-shipper as systemd units. Backlog: E03-039, E03-054.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env
export DEBIAN_FRONTEND=noninteractive

command -v node >/dev/null || {
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
}

install -d -m 0750 /opt/ems/agent /opt/ems/state
cat > /etc/ems-agent.env <<EOF
EMS_API_URL=${EMS_API_URL}
EMS_NODE_ID=${EMS_NODE_ID}
EMS_AGENT_SIGNING_KEY=${EMS_AGENT_SIGNING_KEY}
EMS_NODE_HOSTNAME=${NODE_HOSTNAME}
EMS_NODE_IP=${NODE_IP}
EOF
chmod 0600 /etc/ems-agent.env

cat > /etc/systemd/system/ems-fleet-agent.service <<'EOF'
[Unit]
Description=EMS fleet agent
After=network-online.target postfix.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/ems-agent.env
WorkingDirectory=/opt/ems/agent
ExecStart=/usr/bin/node /opt/ems/agent/fleet-agent.js
Restart=always
RestartSec=5
# The agent handles DKIM private keys. Keep them out of everything else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/ems-maillog-shipper.service <<'EOF'
[Unit]
Description=EMS maillog shipper
After=network-online.target rsyslog.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/ems-agent.env
WorkingDirectory=/opt/ems/agent
ExecStart=/usr/bin/node /opt/ems/agent/maillog-shipper.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "  60-agent: units installed. Deploy the agent bundle to /opt/ems/agent, then:"
echo "            systemctl enable --now ems-fleet-agent ems-maillog-shipper"
