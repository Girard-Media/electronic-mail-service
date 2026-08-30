/**
 * @ems/reputation — the five ledgers (planning/ARCHITECTURE.md §4).
 *
 * Five independent series with different half-lives. A single "deliverability
 * score" is a lie, so there is no stored composite: it is computed at read time
 * and NEVER returned without its decomposition (E11-021, E11-022).
 */

/** Half-lives in days. Different time constants need different control loops. */
/** Exponential decay by half-life. Used by the nightly snapshot writer. */
/** DNSBL zones we poll. Per-IP and per-domain, scheduled with jitter (E09-027/028). */
export const DNSBL_ZONES = [
  "zen.spamhaus.org",
  "sbl.spamhaus.org",
  "css.spamhaus.org",
  "xbl.spamhaus.org",
  "pbl.spamhaus.org",
  "dbl.spamhaus.org",
  "bl.spamcop.net",
  "b.barracudacentral.org",
  "dnsbl.sorbs.net",
  "multi.surbl.org",
  "dnsbl-1.uceprotect.net",
  "ivmSIP.dnsbl.invaluement.com",
  "ips.backscatterer.org",
] as const;

export * from "./score.js";
