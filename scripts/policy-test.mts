/**
 * Policy gate test (E14-097..E14-107, E22-023). Invariant I7.
 *
 * The point of this suite is that the gate BLOCKS. Anything that cannot be
 * resolved, anything suppressed, anything without a lawful basis where one is
 * required — none of it sends, under any configuration.
 */

import {
  resolveJurisdiction, strictnessFromOutcome, countryFromDomain,
  resolveBasis, validateMessage, evaluate,
  type JurisdictionSignal, type ConsentBasis, type JurisdictionRule,
  type MessageToValidate, type SuppressionVerdict, type PolicyOutcome,
} from "../packages/policy/src/index.js";
import { JURISDICTION_POLICIES } from "../packages/db/src/seed/jurisdiction-policy.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const AT = new Date("2026-08-30T12:00:00Z");

const RULES = new Map<string, JurisdictionRule>(
  JURISDICTION_POLICIES.map((j) => [
    j.countryCode,
    { countryCode: j.countryCode, outcome: j.outcome as PolicyOutcome, allowedBases: j.allowedBases, version: 1 },
  ]),
);
const ruleFor = (c: string): JurisdictionRule | null => RULES.get(c) ?? RULES.get("*") ?? null;
const strict = strictnessFromOutcome((c) => RULES.get(c)?.outcome);

const CLEAN: SuppressionVerdict = { global: false, org: false, domainOrRole: false };
const OKFLAGS = { leadFrozen: false, domainVerified: true, kycComplete: true };

function input(over: Partial<Parameters<typeof evaluate>[0]> = {}) {
  return {
    orgId: "org1", leadId: "lead1", campaignId: "camp1", intentId: "int1",
    recipientEmail: "buyer@example.com",
    jurisdiction: { country: "US", source: "tld" as const, confidence: 0.9, signals: [], tightenedBy: null },
    consents: [],
    at: AT,
    ...over,
  };
}

// ── ccTLD mapping ────────────────────────────────────────────────────────────
console.log("\n--- domain → country ---");
ok(".de → DE", countryFromDomain("acme.de") === "DE");
ok(".co.uk → GB", countryFromDomain("acme.co.uk") === "GB");
ok(".com.au → AU", countryFromDomain("acme.com.au") === "AU");
ok("uk alias maps to GB", countryFromDomain("acme.uk") === "GB");
ok(".com carries NO jurisdiction and must not pretend to", countryFromDomain("acme.com") === null);
ok(".io carries none either", countryFromDomain("acme.io") === null);
ok("trailing dot (FQDN form) handled", countryFromDomain("acme.de.") === "DE");
ok("subdomains do not confuse it", countryFromDomain("mail.eu.acme.co.uk") === "GB");

// ── Precedence and the asymmetry rule ────────────────────────────────────────
console.log("\n--- jurisdiction resolution ---");
{
  const r = resolveJurisdiction(
    [{ source: "declared", country: "US", confidence: 1 }, { source: "tld", country: "US", confidence: 0.8 }],
    strict,
  );
  ok("declared wins on precedence", r.country === "US" && r.source === "declared");
}
{
  // The headline case: .com says nothing, but the MX geolocates to Germany.
  const signals: JurisdictionSignal[] = [
    { source: "company", country: "US", confidence: 0.7 },
    { source: "mxgeo", country: "DE", confidence: 0.4 },
  ];
  const r = resolveJurisdiction(signals, strict);
  ok("a WEAK signal tightens a permissive answer (US → DE)",
    r.country === "DE" && r.tightenedBy === "mxgeo", `got ${r.country}`);
}
{
  // The inverse must NOT happen: a weak permissive signal cannot loosen.
  const signals: JurisdictionSignal[] = [
    { source: "company", country: "DE", confidence: 0.7 },
    { source: "mxgeo", country: "US", confidence: 0.4 },
  ];
  const r = resolveJurisdiction(signals, strict);
  ok("a weak signal can NEVER loosen a strict answer (DE stays DE)",
    r.country === "DE" && r.tightenedBy === null, `got ${r.country}`);
}
{
  const r = resolveJurisdiction([], strict);
  ok("no signals → unresolved, not a default", r.country === null && r.source === null);
}
{
  const r = resolveJurisdiction([{ source: "tld", country: "US", confidence: 0 }], strict);
  ok("a zero-confidence signal is not usable", r.country === null);
}
{
  // An unknown country outranks everything, because we block it.
  const r = resolveJurisdiction(
    [{ source: "declared", country: "US", confidence: 1 }, { source: "tld", country: "ZZ", confidence: 0.5 }],
    strict,
  );
  ok("an unmapped country tightens (we block what we do not know)", r.country === "ZZ");
}

// ── Consent ──────────────────────────────────────────────────────────────────
console.log("\n--- consent basis ---");
const ALLOWED: ConsentBasis[] = ["EXPRESS_OPT_IN", "IMPLIED_B2B", "LEGITIMATE_INTEREST"];
{
  const r = resolveBasis(
    [{ id: "c1", basis: "LEGITIMATE_INTEREST", expiresAt: null, revokedAt: null },
     { id: "c2", basis: "EXPRESS_OPT_IN", expiresAt: null, revokedAt: null }],
    ALLOWED, AT,
  );
  ok("strongest allowed basis wins", r.basis === "EXPRESS_OPT_IN" && r.recordId === "c2");
}
{
  const r = resolveBasis(
    [{ id: "c1", basis: "IMPLIED_B2B", expiresAt: new Date("2026-01-01T00:00:00Z"), revokedAt: null }],
    ALLOWED, AT,
  );
  ok("an expired basis is not a basis (CASL time-boxing)",
    r.basis === null && r.rejected[0]?.reason === "expired");
}
{
  const r = resolveBasis(
    [{ id: "c1", basis: "EXPRESS_OPT_IN", expiresAt: null, revokedAt: new Date("2026-06-01T00:00:00Z") }],
    ALLOWED, AT,
  );
  ok("a revoked basis can never be used", r.basis === null && r.rejected[0]?.reason === "revoked");
}
{
  const r = resolveBasis(
    [{ id: "c1", basis: "PUBLISHED_ADDRESS", expiresAt: null, revokedAt: null }],
    ALLOWED, AT,
  );
  ok("a basis not allowed in this jurisdiction is rejected",
    r.basis === null && r.rejected[0]?.reason === "not-allowed-here");
}

// ── The gate ─────────────────────────────────────────────────────────────────
console.log("\n--- the gate ---");
{
  const r = evaluate(input(), ruleFor("US"), CLEAN, OKFLAGS);
  ok("US with no consent record → ALLOW (opt-out regime)", r.decision === "ALLOW", r.decision);
}
{
  const r = evaluate(
    input({ jurisdiction: { country: "DE", source: "tld", confidence: 1, signals: [], tightenedBy: null } }),
    ruleFor("DE"), CLEAN, OKFLAGS,
  );
  ok("Germany with no consent → BLOCK", r.decision === "BLOCK" && r.reasons.includes("jurisdiction-blocked"));
}
{
  const r = evaluate(
    input({
      jurisdiction: { country: "DE", source: "tld", confidence: 1, signals: [], tightenedBy: null },
      consents: [{ id: "c1", basis: "EXPRESS_OPT_IN", expiresAt: null, revokedAt: null }],
    }),
    ruleFor("DE"), CLEAN, OKFLAGS,
  );
  ok("Germany WITH express opt-in → ALLOW_WITH_BASIS", r.decision === "ALLOW_WITH_BASIS", r.decision);
}
{
  const r = evaluate(
    input({
      jurisdiction: { country: "CA", source: "tld", confidence: 1, signals: [], tightenedBy: null },
      consents: [{ id: "c1", basis: "EXISTING_RELATIONSHIP", expiresAt: new Date("2026-01-01T00:00:00Z"), revokedAt: null }],
    }),
    ruleFor("CA"), CLEAN, OKFLAGS,
  );
  ok("Canada with EXPIRED implied consent → BLOCK",
    r.decision === "BLOCK" && r.reasons.includes("consent-expired"), r.reasons.join(","));
}
{
  const r = evaluate(
    input({ jurisdiction: { country: null, source: null, confidence: 0, signals: [], tightenedBy: null } }),
    null, CLEAN, OKFLAGS,
  );
  ok("unresolvable jurisdiction → BLOCK (I7)",
    r.decision === "BLOCK" && r.reasons.includes("jurisdiction-unresolved"));
}
{
  const r = evaluate(input(), ruleFor("US"), { ...CLEAN, global: true }, OKFLAGS);
  ok("global suppression blocks even a lawful US send",
    r.decision === "BLOCK" && r.reasons.includes("suppressed-global"));
}
{
  const r = evaluate(
    input({
      jurisdiction: { country: "DE", source: "tld", confidence: 1, signals: [], tightenedBy: null },
      consents: [{ id: "c1", basis: "EXPRESS_OPT_IN", expiresAt: null, revokedAt: null }],
    }),
    ruleFor("DE"), { ...CLEAN, org: true }, OKFLAGS,
  );
  ok("suppression beats a valid consent basis", r.decision === "BLOCK" && r.reasons.includes("suppressed-org"));
}
{
  const r = evaluate(input(), ruleFor("US"), CLEAN, { ...OKFLAGS, domainVerified: false });
  ok("an unverified sending domain blocks (I2)", r.decision === "BLOCK" && r.reasons.includes("domain-unverified"));
}
{
  const r = evaluate(input(), ruleFor("US"), CLEAN, { ...OKFLAGS, kycComplete: false });
  ok("incomplete KYC blocks", r.decision === "BLOCK" && r.reasons.includes("kyc-incomplete"));
}
{
  const r = evaluate(input(), ruleFor("US"), CLEAN, { ...OKFLAGS, leadFrozen: true });
  ok("a frozen lead (GDPR Art.18 restriction) blocks", r.decision === "BLOCK" && r.reasons.includes("lead-frozen"));
}
{
  const r = evaluate(
    input({ jurisdiction: { country: "ZZ", source: "tld", confidence: 1, signals: [], tightenedBy: null } }),
    ruleFor("ZZ"), CLEAN, OKFLAGS,
  );
  ok("an unlisted country falls to the wildcard, which BLOCKS", r.decision === "BLOCK", r.decision);
}
{
  const r = evaluate(input(), ruleFor("US"), CLEAN, OKFLAGS);
  ok("every decision carries a reconstructable audit record",
    typeof r.audit.jurisdiction !== "undefined" && typeof r.audit.suppression !== "undefined");
}

// ── The seeded table itself ──────────────────────────────────────────────────
console.log("\n--- the policy table ---");
ok("a wildcard default exists", RULES.has("*"));
ok("the wildcard default BLOCKS", RULES.get("*")!.outcome === "BLOCK");
ok("every row carries a citation", JURISDICTION_POLICIES.every((j) => j.citation.trim().length > 0));
ok("Canada is not ALLOW", RULES.get("CA")!.outcome !== "ALLOW");
ok("Germany is not ALLOW", RULES.get("DE")!.outcome !== "ALLOW");
ok("the US is the opt-out regime", RULES.get("US")!.outcome === "ALLOW");

// ── CAN-SPAM message validation ──────────────────────────────────────────────
console.log("\n--- message validation ---");
const GOOD: MessageToValidate = {
  subject: "Quick question about your onboarding",
  bodyText: "Hi Dana,\n\n…\n\nAlex Rivera\nNorthwind Labs\n21 Bridge St, Austin TX 78701\n\nUnsubscribe: https://ems.example/u/abc123",
  bodyHtml: null,
  fromAddress: "alex@northwind-labs.com",
  fromDisplayName: "Alex Rivera",
  personaName: "Alex Rivera",
  postalAddress: "21 Bridge St, Austin TX 78701",
  unsubscribeUrl: "https://ems.example/u/abc123",
  headers: {
    "List-Unsubscribe": "<mailto:u@ems.example>, <https://ems.example/u/abc123>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  isFirstTouch: true,
  fromDomainVerified: true,
};
ok("a compliant first-touch message passes", validateMessage(GOOD).ok, validateMessage(GOOD).defects.join(","));
ok("RE: on a first touch is rejected",
  validateMessage({ ...GOOD, subject: "RE: our call" }).defects.includes("deceptive-subject-re-on-first-touch"));
ok("Fwd: on a first touch is rejected",
  validateMessage({ ...GOOD, subject: "Fwd: proposal" }).defects.includes("deceptive-subject-re-on-first-touch"));
ok("RE: is fine on a later step",
  !validateMessage({ ...GOOD, subject: "RE: our call", isFirstTouch: false }).defects.includes("deceptive-subject-re-on-first-touch"));
ok("a postal address stored but NOT rendered is still a defect",
  validateMessage({ ...GOOD, bodyText: "Hi Dana,\n\nUnsubscribe: https://ems.example/u/abc123" })
    .defects.includes("missing-postal-address"));
ok("a missing unsubscribe link is a defect",
  validateMessage({ ...GOOD, unsubscribeUrl: null }).defects.includes("missing-unsubscribe"));
ok("a missing List-Unsubscribe header is a defect",
  validateMessage({ ...GOOD, headers: {} }).defects.includes("missing-list-unsubscribe-header"));
ok("a missing one-click POST is a defect (RFC 8058)",
  validateMessage({ ...GOOD, headers: { "List-Unsubscribe": "<https://x>" } }).defects.includes("missing-one-click-post"));
ok("wrapping the unsubscribe in a tracking redirect is a defect",
  validateMessage({
    ...GOOD,
    unsubscribeUrl: "https://ems.example/track/u/abc123",
    bodyText: GOOD.bodyText.replace("https://ems.example/u/abc123", "https://ems.example/track/u/abc123"),
  }).defects.includes("unsubscribe-in-tracking-redirect"));
ok("an unverified From domain is a defect",
  validateMessage({ ...GOOD, fromDomainVerified: false }).defects.includes("unverified-from-domain"));
ok("a display name that is not the persona is a defect",
  validateMessage({ ...GOOD, fromDisplayName: "Support Team" }).defects.includes("from-display-name-mismatch"));
ok("CR injection in the subject is caught",
  validateMessage({ ...GOOD, subject: "Hi\r\nBcc: victim@example.net" }).defects.includes("header-injection"));
ok("LF injection in a header value is caught",
  validateMessage({ ...GOOD, headers: { ...GOOD.headers, "X-Thing": "a\nBcc: v@e.net" } }).defects.includes("header-injection"));
ok("an empty subject is a defect", validateMessage({ ...GOOD, subject: "   " }).defects.includes("empty-subject"));

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
