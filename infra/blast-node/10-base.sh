#!/usr/bin/env bash
# 10-base — host hardening. Idempotent. Backlog: E03-012, E03-013, E03-014.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env
export DEBIAN_FRONTEND=noninteractive

hostnamectl set-hostname "$NODE_HOSTNAME"
grep -q "$NODE_HOSTNAME" /etc/hosts || echo "${NODE_IP} ${NODE_HOSTNAME} ${NODE_HOSTNAME%%.*}" >> /etc/hosts

apt-get update -qq
apt-get install -y -qq ufw fail2ban chrony unattended-upgrades dnsutils curl jq ca-certificates

# Clock discipline: DKIM signatures and TLS both care.
systemctl enable --now chrony

# ── Firewall. 25 in and out for mail, 587 for submission, SSH from the
#    allowlist only. Everything else denied.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
for cidr in $SSH_ALLOWLIST; do ufw allow from "$cidr" to any port "${SSH_PORT}" proto tcp; done
ufw allow 25/tcp
ufw allow 587/tcp
ufw allow 80/tcp    # ACME http-01 only
ufw allow 443/tcp
ufw --force enable

# ── SSH: key-only, non-standard port, no root password login.
sshd_conf=/etc/ssh/sshd_config.d/99-ems.conf
cat > "$sshd_conf" <<EOF
Port ${SSH_PORT}
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
EOF
sshd -t && systemctl reload ssh

systemctl enable --now fail2ban

# ── IPv6 off for outbound mail. Stricter receiver policy, no upside here.
cat > /etc/sysctl.d/99-ems-no-ipv6.conf <<'EOF'
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
EOF
sysctl -p /etc/sysctl.d/99-ems-no-ipv6.conf >/dev/null

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

install -d -m 0700 /opt/ems/dkim
install -d -m 0755 /opt/ems/bin /opt/ems/state

echo "  10-base: done"
