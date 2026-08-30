/**
 * @ems/policy — the compliance gate in the send path.
 *
 * CONTRACT (planning/COMPLIANCE.md). This sits between the scheduler and the
 * MTA and can block anything. Blocked is the default for whatever we cannot
 * resolve (invariant I7). Every decision is written to the append-only
 * PolicyDecision table (I5).
 *
 * Types live in their own modules and are re-exported here; declaring them in
 * both places would shadow the richer definitions.
 */

export * from "./jurisdiction.js";
export * from "./consent.js";
export * from "./message.js";

import type { ConsentBasis } from "./consent.js";
import type { JurisdictionResolution } from "./jurisdiction.js";

export type PolicyOutcome = "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK";

export interface PolicyInput {
  orgId: string;
  leadId: string;
  campaignId: string;
  intentId: string;
  recipientEmail: string;
  jurisdiction: JurisdictionResolution;
  consents: Array<{ id: string; basis: ConsentBasis; expiresAt: Date | null; revokedAt: Date | null }>;
  at: Date;
}

export type BlockReason =
  | "jurisdiction-unresolved"
  | "jurisdiction-blocked"
  | "no-lawful-basis"
  | "consent-expired"
  | "consent-revoked"
  | "suppressed-global"
  | "suppressed-org"
  | "suppressed-domain-or-role"
  | "lead-frozen"
  | "domain-unverified"
  | "content-prohibited"
  | "kyc-incomplete";

export interface PolicyResult {
  decision: PolicyOutcome;
  reasons: BlockReason[];
  consentBasis: ConsentBasis | null;
  consentRecordId: string | null;
  policyVersion: number;
  /** Persisted verbatim so "prove you were allowed" is one query, a year later. */
  audit: Record<string, unknown>;
}

/** The row the policy table supplies for a resolved country. */
export interface JurisdictionRule {
  countryCode: string;
  outcome: PolicyOutcome;
  allowedBases: ConsentBasis[];
  version: number;
}

export interface SuppressionVerdict {
  global: boolean;
  org: boolean;
  domainOrRole: boolean;
}

import { resolveBasis } from "./consent.js";

/**
 * Pure evaluation. The caller supplies the resolved jurisdiction, the matching
 * rule, and the suppression verdict; this decides and records why.
 *
 * Order matters: suppression is checked before anything else, because a
 * suppressed address must never send regardless of how lawful the basis is.
 */
export function evaluate(
  input: PolicyInput,
  rule: JurisdictionRule | null,
  suppression: SuppressionVerdict,
  flags: { leadFrozen: boolean; domainVerified: boolean; kycComplete: boolean },
): PolicyResult {
  const reasons: BlockReason[] = [];

  if (suppression.global) reasons.push("suppressed-global");
  if (suppression.org) reasons.push("suppressed-org");
  if (suppression.domainOrRole) reasons.push("suppressed-domain-or-role");
  if (flags.leadFrozen) reasons.push("lead-frozen");
  if (!flags.domainVerified) reasons.push("domain-unverified");
  if (!flags.kycComplete) reasons.push("kyc-incomplete");

  const audit: Record<string, unknown> = {
    jurisdiction: input.jurisdiction.country,
    jurisdictionSource: input.jurisdiction.source,
    jurisdictionConfidence: input.jurisdiction.confidence,
    tightenedBy: input.jurisdiction.tightenedBy,
    signals: input.jurisdiction.signals,
    suppression,
    flags,
    ruleCountry: rule?.countryCode ?? null,
    ruleOutcome: rule?.outcome ?? null,
  };

  // Unresolvable jurisdiction blocks. Never "assume allowed" (I7).
  if (input.jurisdiction.country === null) {
    reasons.push("jurisdiction-unresolved");
    return { decision: "BLOCK", reasons, consentBasis: null, consentRecordId: null, policyVersion: rule?.version ?? 0, audit };
  }
  if (rule === null) {
    reasons.push("jurisdiction-unresolved");
    return { decision: "BLOCK", reasons, consentBasis: null, consentRecordId: null, policyVersion: 0, audit };
  }

  const basis = resolveBasis(input.consents, rule.allowedBases, input.at);
  audit.consentRejected = basis.rejected;

  if (rule.outcome === "BLOCK") {
    // A blocked jurisdiction can still be lifted by a recorded allowed basis —
    // that is what the allowedBases column is for. Without one, it stays blocked.
    if (basis.basis === null) {
      reasons.push("jurisdiction-blocked");
      if (basis.rejected.some((r) => r.reason === "revoked")) reasons.push("consent-revoked");
      if (basis.rejected.some((r) => r.reason === "expired")) reasons.push("consent-expired");
      return { decision: "BLOCK", reasons, consentBasis: null, consentRecordId: null, policyVersion: rule.version, audit };
    }
    if (reasons.length > 0) {
      return { decision: "BLOCK", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
    }
    return { decision: "ALLOW_WITH_BASIS", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
  }

  if (rule.outcome === "ALLOW_WITH_BASIS") {
    if (basis.basis === null) {
      reasons.push("no-lawful-basis");
      if (basis.rejected.some((r) => r.reason === "revoked")) reasons.push("consent-revoked");
      if (basis.rejected.some((r) => r.reason === "expired")) reasons.push("consent-expired");
      return { decision: "BLOCK", reasons, consentBasis: null, consentRecordId: null, policyVersion: rule.version, audit };
    }
    if (reasons.length > 0) {
      return { decision: "BLOCK", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
    }
    return { decision: "ALLOW_WITH_BASIS", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
  }

  // ALLOW (opt-out regime). Suppression and the flags still bind.
  if (reasons.length > 0) {
    return { decision: "BLOCK", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
  }
  return { decision: "ALLOW", reasons, consentBasis: basis.basis, consentRecordId: basis.recordId, policyVersion: rule.version, audit };
}
