/**
 * @ems/reputation — the five ledgers (planning/ARCHITECTURE.md §4).
 *
 * Five independent series with different half-lives. A single "deliverability
 * score" is a lie, so there is no stored composite: it is computed at read time
 * and NEVER returned without its decomposition (E11-021, E11-022).
 */

export type Subject = "IP" | "DOMAIN" | "MAILBOX" | "CONTENT" | "ENGAGEMENT";

/** Half-lives in days. Different time constants need different control loops. */
export const HALF_LIFE_DAYS: Record<Subject, number> = {
  IP: 21,
  DOMAIN: 10,
  MAILBOX: 3,
  CONTENT: 1,
  ENGAGEMENT: 7,
};

export interface Factor {
  key: string;
  /** Normalised 0..1 contribution. */
  value: number;
  weight: number;
  /** Where the number came from — maillog, dnsbl, dmarc, tlsrpt, fbl, seed. */
  source: string;
  observedAt: Date;
}

export interface LedgerReading {
  subject: Subject;
  subjectId: string;
  /** null when there is not enough volume to say anything honest (E11-015). */
  score: number | null;
  insufficientData: boolean;
  sampleSize: number;
  factors: Factor[];
  windowEnd: Date;
}

export interface Composite {
  score: number;
  /** Never omitted. A composite without its parts is refused by the API. */
  ledgers: LedgerReading[];
  weightsVersion: string;
}

/** Exponential decay by half-life. Used by the nightly snapshot writer. */
export function decay(value: number, ageDays: number, halfLifeDays: number): number {
  return value * Math.pow(0.5, ageDays / halfLifeDays);
}

export function readingScore(factors: Factor[]): number | null {
  if (factors.length === 0) return null;
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return null;
  return factors.reduce((s, f) => s + f.value * f.weight, 0) / totalWeight;
}

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
