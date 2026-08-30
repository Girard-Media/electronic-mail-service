/**
 * Consent basis resolution (E14-025..E14-030). planning/COMPLIANCE.md §3.
 *
 * Rules that are non-negotiable:
 *  - An expired consent is not a consent. CASL implied consent is time-boxed.
 *  - A revoked consent can NEVER be resurrected, including by re-import (E14-030).
 *  - When several records exist, the strongest ALLOWED basis wins.
 */

export type ConsentBasis =
  | "LEGITIMATE_INTEREST"
  | "IMPLIED_B2B"
  | "EXPRESS_OPT_IN"
  | "PUBLISHED_ADDRESS"
  | "EXISTING_RELATIONSHIP";

export interface ConsentRecord {
  id: string;
  basis: ConsentBasis;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Strongest first. Express opt-in beats everything; legitimate interest is weakest. */
const BASIS_STRENGTH: Record<ConsentBasis, number> = {
  EXPRESS_OPT_IN: 5,
  EXISTING_RELATIONSHIP: 4,
  IMPLIED_B2B: 3,
  PUBLISHED_ADDRESS: 2,
  LEGITIMATE_INTEREST: 1,
};

export function isLive(r: ConsentRecord, at: Date): boolean {
  if (r.revokedAt !== null && r.revokedAt <= at) return false;
  if (r.expiresAt !== null && r.expiresAt <= at) return false;
  return true;
}

export interface BasisResolution {
  basis: ConsentBasis | null;
  recordId: string | null;
  /** Why nothing was usable, when nothing was. */
  rejected: Array<{ id: string; reason: "revoked" | "expired" | "not-allowed-here" }>;
}

export function resolveBasis(
  records: ConsentRecord[],
  allowedBases: ConsentBasis[],
  at: Date,
): BasisResolution {
  const rejected: BasisResolution["rejected"] = [];
  const usable: ConsentRecord[] = [];

  for (const r of records) {
    if (r.revokedAt !== null && r.revokedAt <= at) {
      rejected.push({ id: r.id, reason: "revoked" });
      continue;
    }
    if (r.expiresAt !== null && r.expiresAt <= at) {
      rejected.push({ id: r.id, reason: "expired" });
      continue;
    }
    if (!allowedBases.includes(r.basis)) {
      rejected.push({ id: r.id, reason: "not-allowed-here" });
      continue;
    }
    usable.push(r);
  }

  if (usable.length === 0) return { basis: null, recordId: null, rejected };

  const best = usable.sort((a, b) => BASIS_STRENGTH[b.basis] - BASIS_STRENGTH[a.basis])[0]!;
  return { basis: best.basis, recordId: best.id, rejected };
}
