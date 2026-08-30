# blast-node — provisioning

Takes a bare Ubuntu 24.04 VPS to a node that is *allowed* to send. Idempotent
and re-runnable; every stage is safe to run twice.

**A node is not routable until `90-verify.sh` exits 0.** The registry refuses
the `VERIFYING → ACTIVE` transition without all three flags (`relayTestOk`,
`dkimTestOk`, `egress25Ok`) — see `packages/fleet` `isRoutable()`.

```bash
# 0. BEFORE you pay — from your laptop, against the candidate address
pnpm tsx scripts/ip-diligence.mts <ip> --ptr mta01.<sending-domain>

# 1. On the node, as root
git clone <repo> /opt/ems-provision && cd /opt/ems-provision/infra/blast-node
cp node.env.example node.env && $EDITOR node.env
./provision.sh                 # runs every stage in order
./provision.sh --dry-run       # print every change, apply nothing
./90-verify.sh                 # re-run the gate on demand
```

## Stages

| Stage | Does |
|---|---|
| `00-preflight.sh` | IP diligence, port 25 egress, rDNS forward-confirm. **Refuses to continue on a dirty IP.** |
| `10-base.sh` | users, ufw, fail2ban, chrony, unattended-upgrades, IPv6 off for mail |
| `20-postfix.sh` | Postfix from template, per-domain transports, per-ESP rate limits, VERP |
| `30-opendkim.sh` | multi-domain signing, keys mounted from `/opt/ems/dkim` |
| `40-rspamd.sh` | local content scoring only — every phone-home module disabled |
| `50-dmarc.sh` | inbound OpenDMARC alignment checks |
| `60-agent.sh` | `fleet-agent` + `maillog-shipper` as systemd units |
| `70-tls.sh` | Let's Encrypt certificate on the PTR hostname |
| `90-verify.sh` | **the gate**: open-relay test, DKIM sign test, loopback delivery, egress |

## Non-negotiables encoded in these scripts

- `mynetworks` is loopback plus the workers' private IP. Nothing else relays.
- `smtpd_relay_restrictions` ends in `reject_unauth_destination`. An open relay
  is a Sev-1 and `90-verify.sh` fails the node.
- IPv6 is disabled for outbound mail. Google and Microsoft apply stricter IPv6
  policy and there is no upside for this traffic class.
- `soft_bounce = no` and a short `maximal_queue_lifetime`: our scheduler owns
  retries, not Postfix's queue.
- DKIM private keys are materialised from the encrypted value in Postgres at
  provision time and never written to a log. Losing a node does not lose a key.
