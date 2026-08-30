/**
 * @ems/policy — the compliance gate in the send path.
 *
 * CONTRACT (planning/COMPLIANCE.md). This sits between the scheduler and the
 * MTA and can block anything. Blocked is the default for whatever we cannot
 * resolve (invariant I7). Every decision is written to the append-only
 * PolicyDecision table (I5).
 */

export type ConsentBasis =
  | "LEGITIMATE_INTEREST"
  | "IMPLIED_B2B"
  | "EXPRESS_OPT_IN"
  | "PUBLISHED_ADDRESS"
  | "EXISTING_RELATIONSHIP";

export type PolicyOutcome = "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK";

/**
 * Precedence order for resolving a recipient's jurisdiction. First confident
 * answer wins, and the source is recorded. ASYMMETRY RULE: a weak signal may
 * make the policy stricter, never looser (E14-020).
 */
export type JurisdictionSource = "declared" | "company" | "tld" | "mxgeo";

export interface JurisdictionResolution {
  country: string | null;
  source: JurisdictionSource | null;
  confidence: number;
}

export interface PolicyInput {
  orgId: string;
  leadId: string;
  campaignId: string;
  intentId: string;
  recipientEmail: string;
  jurisdiction: JurisdictionResolution;
  /** Non-revoked, non-expired consent records for this lead. */
  consents: Array<{ id: string; basis: ConsentBasis; expiresAt: Date | null }>;
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
  consentRecordId: string | null;
  policyVersion: number;
  /** Persisted verbatim to PolicyDecision so "prove you were allowed" is one query. */
  audit: Record<string, unknown>;
}

/** CAN-SPAM mandatory elements. A message missing any of these does not send. */
export type MessageDefect =
  | "missing-postal-address"
  | "missing-unsubscribe"
  | "unsubscribe-contrast-too-low"
  | "deceptive-subject-re-on-first-touch"
  | "from-display-name-mismatch"
  | "unverified-from-domain"
  | "header-injection"
  | "missing-ad-identification";

export interface MessageValidation {
  ok: boolean;
  defects: MessageDefect[];
}

export class NotImplemented extends Error {
  constructor(task: string) {
    super(`not implemented — see ${task} in planning/TODO.md`);
    this.name = "NotImplemented";
  }
}

export async function evaluate(_input: PolicyInput): Promise<PolicyResult> {
  throw new NotImplemented("E14-003..E14-047");
}

export function validateMessage(_msg: unknown): MessageValidation {
  throw new NotImplemented("E14-062..E14-069");
}
