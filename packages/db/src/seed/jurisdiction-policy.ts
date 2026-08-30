/**
 * Jurisdiction policy rows (E02-061). Config, not code — counsel reads and edits
 * these without a deploy, and every row carries its citation.
 *
 * Nothing here is legal advice. The product's job is to make the rule explicit,
 * enforce it, and prove what it did.
 *
 * Precedence at send time is handled by @ems/policy: the wildcard "*" row is the
 * default, and it BLOCKS (invariant I7).
 */

export type ConsentBasis =
  | "LEGITIMATE_INTEREST"
  | "IMPLIED_B2B"
  | "EXPRESS_OPT_IN"
  | "PUBLISHED_ADDRESS"
  | "EXISTING_RELATIONSHIP";

export type PolicyOutcome = "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK";

export interface JurisdictionSeed {
  countryCode: string;
  regime: "opt-in" | "opt-out" | "mixed";
  outcome: PolicyOutcome;
  allowedBases: ConsentBasis[];
  citation: string;
  notes?: string;
}

export const JURISDICTION_POLICIES: JurisdictionSeed[] = [
  {
    countryCode: "*",
    regime: "opt-in",
    outcome: "BLOCK",
    allowedBases: [],
    citation: "EMS default — planning/COMPLIANCE.md §1",
    notes: "Blocked by default. Anything we cannot resolve does not send (I7).",
  },
  {
    countryCode: "US",
    regime: "opt-out",
    outcome: "ALLOW",
    allowedBases: ["LEGITIMATE_INTEREST", "IMPLIED_B2B", "PUBLISHED_ADDRESS", "EXISTING_RELATIONSHIP", "EXPRESS_OPT_IN"],
    citation: "CAN-SPAM Act of 2003, 15 U.S.C. §7701 et seq.",
    notes:
      "Opt-out regime. Legal only with truthful headers, non-deceptive subject, ad identification, a valid physical postal address, and an opt-out honoured within 10 business days. Those are enforced by policy.validateMessage(), not left to the customer.",
  },
  {
    countryCode: "CA",
    regime: "opt-in",
    outcome: "BLOCK",
    allowedBases: ["EXPRESS_OPT_IN", "EXISTING_RELATIONSHIP"],
    citation: "CASL, S.C. 2010, c. 23",
    notes:
      "Opt-in. Implied consent from an existing business relationship is time-boxed (24 months from a transaction, 6 months from an enquiry) — ConsentRecord.expiresAt enforces that. Penalties to CAD 10M. Default BLOCK; a recorded basis lifts it.",
  },
  {
    countryCode: "GB",
    regime: "mixed",
    outcome: "ALLOW_WITH_BASIS",
    allowedBases: ["LEGITIMATE_INTEREST", "IMPLIED_B2B", "PUBLISHED_ADDRESS", "EXPRESS_OPT_IN"],
    citation: "PECR 2003 reg. 22; UK GDPR Art. 6(1)(f)",
    notes:
      "Corporate subscribers (limited companies, LLPs, public bodies) may be emailed with an opt-out. Sole traders and unincorporated partnerships are treated as individuals and are NOT covered — resolve entity type before relying on this row.",
  },
  {
    countryCode: "FR",
    regime: "mixed",
    outcome: "ALLOW_WITH_BASIS",
    allowedBases: ["LEGITIMATE_INTEREST", "IMPLIED_B2B", "PUBLISHED_ADDRESS"],
    citation: "CNIL B2B prospecting guidance; GDPR Art. 6(1)(f)",
    notes:
      "B2B permitted to a professional address where the message relates to the recipient's role. Requires a recorded legitimate-interest assessment.",
  },
  {
    countryCode: "AU",
    regime: "opt-in",
    outcome: "ALLOW_WITH_BASIS",
    allowedBases: ["PUBLISHED_ADDRESS", "EXPRESS_OPT_IN", "EXISTING_RELATIONSHIP"],
    citation: "Spam Act 2003 (Cth) s.16, Sch.2",
    notes:
      "Inferred consent exists where a business address is conspicuously published without a no-unsolicited-email statement, and the message relates to the recipient's role. The published-address basis must record where it was published.",
  },
  {
    countryCode: "DE",
    regime: "opt-in",
    outcome: "BLOCK",
    allowedBases: ["EXPRESS_OPT_IN"],
    citation: "UWG §7 Abs. 2 Nr. 2",
    notes: "Prior express consent required, B2B included. One of the strictest regimes; default BLOCK.",
  },
  {
    countryCode: "AT",
    regime: "opt-in",
    outcome: "BLOCK",
    allowedBases: ["EXPRESS_OPT_IN"],
    citation: "TKG 2021 §174",
  },
  {
    countryCode: "IE",
    regime: "mixed",
    outcome: "ALLOW_WITH_BASIS",
    allowedBases: ["LEGITIMATE_INTEREST", "IMPLIED_B2B", "EXPRESS_OPT_IN"],
    citation: "S.I. No. 336/2011 reg. 13",
    notes: "Corporate subscribers may opt out; individuals require consent.",
  },
  {
    countryCode: "NL",
    regime: "mixed",
    outcome: "ALLOW_WITH_BASIS",
    allowedBases: ["LEGITIMATE_INTEREST", "IMPLIED_B2B", "EXPRESS_OPT_IN"],
    citation: "Telecommunicatiewet art. 11.7",
    notes: "B2B carve-out exists but is narrower than the UK's. Requires a recorded LIA.",
  },
  // Blocked pending a per-country rule row reviewed by counsel (E02-061).
  ...(["ES", "IT", "PL", "SE", "DK", "FI", "NO", "BE", "PT", "CZ", "GR", "HU", "RO", "CH"] as const).map(
    (cc): JurisdictionSeed => ({
      countryCode: cc,
      regime: "opt-in",
      outcome: "BLOCK",
      allowedBases: ["EXPRESS_OPT_IN"],
      citation: "GDPR + national ePrivacy implementation — row pending counsel review",
      notes: "Blocked until a specific rule is written. Blocked-by-default is the correct interim state.",
    }),
  ),
];
