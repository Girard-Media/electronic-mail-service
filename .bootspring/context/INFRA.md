# Infrastructure — EMS

> Canonical source: `planning/INFRA.md`.

## Why a separate box

`31.220.104.223` is the hostssh hub running usermails' transactional MTA for the
whole fleet. Cold traffic there would put password resets behind cold-email
reputation, merge two mail logs, and give receivers one PTR for two traffic
classes. **Separation is why the product is trustworthy, not an optimisation.**

## Nodes

- `blast-node-01` — Hostinger KVM2, Ubuntu 24.04, one dedicated IPv4 with clean
  history, IPv6 off for outbound, PTR `mta01.<sending-domain>` forward-confirmed.
- `verify-node-01` — a separate small VPS whose only job is SMTP recipient probing.

Provisioned by `infra/blast-node/provision.sh`. Stack: Postfix, OpenDKIM,
OpenDMARC, rspamd (local scoring only — every phone-home module disabled),
`fleet-agent`, `maillog-shipper`, ufw, fail2ban, chrony.

**A node is not routable until `90-verify.sh` passes**: no open relay, DKIM
actually signs, port 25 egress works.

## Before paying for an IP

```
pnpm ip:diligence <ip> --ptr <host>
```

DNSBL sweep, forward-confirmed rDNS, live port-25 egress. **A dirty IP is worse
than no IP.** Release and retry.

## Domains

Never send cold from the brand domain. Register, publish full DNS, park a real
one-page site with a real postal address, wait ≥14 days. SPF is a single
hard-fail `ip4:` with no includes. DMARC starts at `p=none` and promotes on
evidence. `BURNED` is terminal — never reuse.

## Capacity

`daily = Σ min(warmupCap, hardCap) × 0.85`. 1,000/day ≈ 30 mailboxes ≈ 12 domains
≈ 1 node. One node carries 1,000–2,000/day; the pool exists so 5,000 is
procurement, not engineering.

## Local development

`pnpm infra:up` — Postgres 18 on **55432**, Valkey on **56379**, ClickHouse on
8123/9000, Mailpit sink on 1025/8025. High ports on purpose: this machine also
runs a system Postgres and Redis, plus the usermails stack.
