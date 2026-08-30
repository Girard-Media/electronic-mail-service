#!/usr/bin/env bash
# 70-tls — Let's Encrypt certificate on the PTR hostname. Backlog: E03-031..E03-033.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source node.env
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq certbot

certbot certonly --standalone --non-interactive --agree-tos \
  -m "${ACME_EMAIL}" -d "${NODE_HOSTNAME}" --keep-until-expiring

live="/etc/letsencrypt/live/${NODE_HOSTNAME}"
[[ -f "${live}/fullchain.pem" ]] || { echo "FATAL: certificate not issued"; exit 1; }

postconf -e "smtpd_tls_cert_file = ${live}/fullchain.pem"
postconf -e "smtpd_tls_key_file = ${live}/privkey.pem"
postconf -e "smtpd_tls_security_level = may"

# Reload Postfix after every renewal so the new certificate is actually served.
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-postfix.sh <<'EOF'
#!/usr/bin/env bash
systemctl reload postfix
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-postfix.sh

systemctl reload postfix
echo "  70-tls: done"
