# Deliverability — EMS

> Canonical source: `planning/ARCHITECTURE.md` §5 and `planning/INFRA.md`.

## Six evidence streams, each able to fail without blinding the others

1. **Maillog** — primary truth. Carries the receiving MX's exact response text.
2. **Bounce taxonomy** — a deterministic table over (ESP, code, enhanced, substring).
   AI runs only on `UNKNOWN`, and only proposes new rows for operator approval.
3. **DNSBL** — Spamhaus (zen/sbl/css/xbl/pbl/dbl), SpamCop, Barracuda, SORBS,
   SURBL, UCEPROTECT, Invaluement, Backscatterer.
4. **DMARC RUA** — we publish `rua=`, receive the XML, parse per source IP.
5. **TLS-RPT** — surfaces negotiation failures that silently kill delivery.
6. **Seed probes** — the ONLY true measure of placement. Everything else is a
   proxy and is labelled as one.

## The volume constraint

Fresh mailbox: ~5–10/day in week 1, ~20–30 by week 4, plateau **30–50** for cold.
Past that: Google `421-4.7.0`, then Microsoft `550 5.7.1 S3150`, then the domain is
cooked. Two to three mailboxes per domain, never more.

## Numbers we refuse to fake

- `delivered` = a `status=sent` log line with a 2xx. Nothing else counts.
- A Promotions landing is never presented as an inbox landing.
- Every metric ships with its window, its sample size and its source.
- Opens are excluded from reputation entirely (Apple MPP); open tracking is off
  by default.
- A DNSBL lookup timeout is inconclusive, never a pass.
