# EMS — Sending Infrastructure

**Decision (locked):** one dedicated blast VPS now, built as an N-node pool from day one.

---

## 1. Why a separate box at all

`31.220.104.223` is the hostssh hub. It runs `usermails-mta` and serves live transactional mail for the whole Girard Media fleet. Cold outreach traffic on that IP would:

- Put transactional delivery behind cold-email reputation. A Spamhaus listing from an outreach campaign would take down password resets for every fleet app.
- Merge two maillogs, making per-product attribution impossible.
- Share one PTR and one `myhostname`, so receivers cannot tell the traffic classes apart — and neither could we.

**Separation is not an optimization. It is the reason the product is trustworthy.**

---

## 2. Node specification

### blast-node-01 (provision first)

| Property | Value |
|---|---|
| Provider | Hostinger VPS (KVM 2 or better) |
| Resources | 2 vCPU / 8 GB / 100 GB NVMe — Postfix is I/O-light; headroom is for the queue and logs |
| OS | Ubuntu 24.04 LTS |
| IPv4 | 1 dedicated, **clean history required** — check DNSBLs *before* accepting the IP |
| IPv6 | Disabled for outbound. Google/Microsoft IPv6 policy is stricter and offers no upside here. |
| PTR / rDNS | `mta01.<sending-domain>` — must forward-confirm |
| Ports | 25 out (confirm the provider does not block it *before* purchase), 587, 25 in, 22 restricted |
| Role | Campaign sending only |

### verify-node-01 (provision second, smaller)

Separate small VPS with its own IP whose **only** job is SMTP recipient probing. Verification connection patterns (many `RCPT TO` with no `DATA`) look hostile to some receivers. Isolating them protects campaign IPs. KVM 1 / 1 vCPU / 4 GB is sufficient.

### Future nodes

`blast-node-02..N` are identical, provisioned from the same script, differing only in IP, PTR, and pool assignment. The router treats nodes as fungible capacity with per-IP reputation. **Adding node N+1 must be a config change, never a code change.**

---

## 3. Pre-purchase IP diligence (do this before paying)

1. Ask the provider for the IP *before* commit, or buy and be prepared to release.
2. Check it against Spamhaus zen/sbl/css, SpamCop, Barracuda, SORBS, UCEPROTECT, Invaluement.
3. Check `senderscore`-style history where available and passive DNS for prior hostnames.
4. Confirm the provider grants rDNS control.
5. Confirm outbound :25 is open (many providers block it silently on new accounts).
6. **A dirty IP is worse than no IP.** Release and retry — this is cheap now and catastrophic later.

Automate all of this as `scripts/ip-diligence.mts` so node N+1 is a single command.

---

## 4. Node software stack

```
Postfix              — MTA, one instance, multiple sender-dependent transports
OpenDKIM             — per-domain signing, keys mounted from /opt/ems/dkim
OpenDMARC            — inbound alignment checks
rspamd               — pre-send content scoring (local, no vendor)
fleet-agent          — our Node agent: health, capacity, IP binding, key install
maillog-shipper      — tails /var/log/mail.log → ships to apps/api (signed)
fail2ban + ufw       — 22 restricted, 25/587 controlled
chrony               — clock discipline (DKIM/TLS care)
```

### Postfix configuration principles

- `smtp_bind_address` per transport so a message can be pinned to a specific IP when a node holds several.
- **Sender-dependent transport maps** — each sending domain maps to a transport, so per-domain queue behavior and rate limits are independent.
- `smtp_destination_concurrency_limit` and `smtp_destination_rate_delay` tuned **per receiving ESP** (Google, Microsoft, Yahoo tolerate very different concurrency).
- `soft_bounce=no` in production; deferrals are managed by our scheduler, not by Postfix's queue lifetime.
- **VERP return-path** per message so bounce attribution is exact (inherited from `packages/providers/src/verp.ts`).
- Bounce domain distinct from sending domain (`bounce.<domain>`), MX'd to the node.
- No open relay. `mynetworks` = loopback + the workers' private IP only. Verified by an automated relay test in CI against every live node.
- TLS: opportunistic outbound with `smtp_tls_security_level=may`, `dane` where available; inbound `smtpd_tls_security_level=may` with a real LE cert on the PTR hostname.

---

## 5. Domain fleet

Cold outreach requires **many** sending domains, never the primary brand domain.

### Rules

1. **Never send cold from `electronicmailservices.com`** or from a customer's primary domain. Burn a throwaway, not the brand.
2. Buy lookalike/adjacent domains: `.com` preferred, then `.co`, `.io`. Avoid `.xyz`, `.top`, `.club`, `.info` — carry inherent penalty.
3. **Age before use.** Register, publish full DNS, park a real one-page site, wait ≥14 days before the first send. The warmup engine will not release a domain younger than the configured minimum.
4. Every domain gets a real website (a one-page company page), a real privacy page, and a real postal address. Receivers check.
5. `2–3 mailboxes per domain`, never more. More mailboxes on one domain concentrates risk.
6. **Retirement is planned, not reactive.** Domains have a service life. Track it, rotate before failure, keep a warm bench.

### DNS record set (automated, per domain)

| Record | Value |
|---|---|
| `A @` | landing page host |
| `MX @` | `mta01.<domain>` (node), priority 10 |
| `TXT @` (SPF) | `v=spf1 ip4:<node-ip> -all` — hard fail, single IP, no includes |
| `TXT <sel>._domainkey` | 2048-bit DKIM public key, selector rotated quarterly |
| `TXT _dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@<agg-domain>; ruf=…; fo=1; adkim=s; aspf=s` |
| `TXT _smtp._tls` | TLS-RPT `v=TLSRPTv1; rua=mailto:tlsrpt@<agg-domain>` |
| `TXT @` (BIMI, later) | after `p=quarantine` holds and a VMC exists |
| `CNAME bounce` | node, for VERP return-path |
| `A mta01` | node IP (PTR target) |

Start DMARC at `p=none` for 7 days to collect RUA, then move to `p=quarantine`. Move to `p=reject` only once RUA shows 100% alignment for 14 days. **Strict alignment (`adkim=s; aspf=s`) from the start** — we control both ends, so there is no reason to be lax.

---

## 6. Mailbox fleet

A "mailbox" is a real local account on the node with a real maildir, reachable inbound, so replies land in our unified inbox without IMAP polling.

| Property | Rule |
|---|---|
| Naming | Real human names matching a real persona; never `noreply@`, never `info@` |
| Count | 2–3 per domain |
| Daily cap | Warmup curve output; hard ceiling 50 for cold |
| Signature | Real name, real company, real postal address, working unsubscribe |
| Inbound | LMTP → maildir → `inbox` ingestion worker |
| Retirement | Drain (stop new sends, finish in-flight), cool down, archive |

---

## 7. Capacity math

Plan capacity from mailboxes, not from wishes.

```
daily_capacity = Σ over live mailboxes of min(warmup_cap, hard_cap) × safety_factor(0.85)
```

| Target/day | Mailboxes @40 | Domains @2.5 | Nodes @~60 mbx |
|---|---|---|---|
| 500 | 15 | 6 | 1 |
| 1,000 | 30 | 12 | 1 |
| 5,000 | 147 | 59 | 3 |
| 20,000 | 588 | 235 | 10 |

**One node comfortably carries the first 1,000–2,000/day.** The pool architecture exists so that going to 5k is procurement, not engineering.

---

## 8. Inbound path

Replies are the product's success metric, so inbound is not an afterthought.

```
recipient MX (our node) → Postfix → OpenDMARC → rspamd → LMTP → maildir
                                                              ↓
                                          fleet-agent watcher → POST /inbound (signed)
                                                              ↓
                                    packages/inbox: parse MIME, thread, classify (AI), route
```

Bounces arrive at the VERP return-path and are parsed by the existing `feedback-ingest` app. ARF/FBL complaints from Yahoo/Microsoft/Comcast land in the same receiver and trigger **immediate** suppression.

---

## 9. Aggregate-report domain

One dedicated domain (`ems-reports.com` or similar) hosts `dmarc@` and `tlsrpt@` for **every** sending domain's `rua`/`ruf`. Keeps report traffic off the sending domains and gives one ingestion point.

---

## 10. Provisioning automation

`infra/blast-node/` — idempotent, re-runnable, no manual steps:

```
00-preflight.sh      IP diligence, :25 egress check, rDNS confirm
10-base.sh           users, ufw, fail2ban, chrony, unattended-upgrades
20-postfix.sh        install, main.cf/master.cf from template, transports
30-opendkim.sh       key dirs, selector config, signing table
40-rspamd.sh         local scoring, no external services
50-dmarc.sh          OpenDMARC inbound
60-agent.sh          fleet-agent + maillog-shipper as systemd units
70-tls.sh            LE cert for the PTR hostname
90-verify.sh         relay test, DKIM sign test, loopback delivery test, egress test
```

**`90-verify.sh` must pass before the node is marked `ACTIVE` in the registry.** A node that has not proven it cannot relay and can sign is not eligible for routing.

---

## 11. Backup, DR, and node loss

- Node state is **disposable by design**. Domains, mailboxes, keys, and caps live in Postgres; a node is a cattle-grade executor.
- DKIM private keys are the exception: stored encrypted in Postgres, materialized to the node at provision time. Losing a node does not lose a key.
- Postgres/ClickHouse backups follow the existing fleet restic → R2 (`gm-fleet-backups`) runbook.
- **Node loss playbook:** mark node `DRAINING` → router stops selecting it → in-flight queue flushes or expires → provision replacement → re-materialize keys → `90-verify.sh` → `ACTIVE`. Target: under 2 hours, unattended after the VPS exists.

---

## 12. Cost model (order of magnitude, monthly)

| Line | ~USD |
|---|---|
| blast-node-01 | 15 |
| verify-node-01 | 8 |
| Domains (15 × $10/yr) | 13 |
| Postgres/Valkey/ClickHouse (existing .211) | 0 marginal |
| R2 | 2 |
| OpenRouter | 20–100 (usage) |
| **Total to 1,000 sends/day** | **~60–150** |

For comparison, Instantly/Smartlead at that volume run $97–297/mo *plus* $3–5/mailbox/mo for 30 mailboxes ($90–150). **We are structurally cheaper and we keep the margin.**
