/**
 * Leads import and compliance gate test (E13-102..E13-107).
 *
 * The normalisation assertions all test the same rule from different angles:
 * never mangle a value we are unsure about. The gate assertions test that a
 * list cannot activate while anything is unresolved.
 */
import {
  normalizeEmail, normalizeName, splitFullName, normalizeCompany,
  companyDomainFrom, normalizeLinkedIn, normalizePhone, normalizeLead,
  dedupe, dedupeKey, assess, canActivate, reportToCsv, FREE_MAIL,
  type RawLead, type NormalizedLead, type ImportAttestation, type GateInputs,
} from "../packages/leads/src/index.js";
import { countryFromDomain } from "../packages/policy/src/index.js";
import { JURISDICTION_POLICIES } from "../packages/db/src/seed/jurisdiction-policy.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const OPTS = { countryFromDomain };
const AT = new Date("2026-08-30T00:00:00Z");

console.log("\n--- email + company domain ---");
ok("the domain lowercases", normalizeEmail("Dana@ACME.com") === "Dana@acme.com");
ok("the local part case survives", normalizeEmail("Dana.Lee@acme.com") === "Dana.Lee@acme.com");
ok("a company domain comes from the address", companyDomainFrom("dana@acme.com") === "acme.com");
ok("a free-mail address yields NO company domain", companyDomainFrom("dana@gmail.com") === null);
ok("a declared free-mail domain is also refused", companyDomainFrom("dana@acme.com", "gmail.com") === "acme.com");
ok("a declared domain is cleaned of scheme and www",
  companyDomainFrom("dana@gmail.com", "https://www.acme.io/about") === "acme.io");
ok("the free-mail list covers the major providers",
  ["gmail.com","outlook.com","yahoo.com","icloud.com","proton.me"].every((d) => FREE_MAIL.has(d)));

console.log("\n--- names: fix obvious damage, nothing else ---");
ok("ALL CAPS is repaired", normalizeName("DANA LEE") === "Dana Lee");
ok("all lowercase is repaired", normalizeName("dana lee") === "Dana Lee");
ok("hyphenated names survive repair", normalizeName("MARY-JANE OCONNELL") === "Mary-Jane Oconnell");
ok("apostrophes are handled", normalizeName("dana o'brien") === "Dana O'Brien");
ok("MIXED case is LEFT ALONE — McDonald is not a mistake",
  normalizeName("Ronald McDonald") === "Ronald McDonald");
ok("van der Berg is left alone", normalizeName("Piet van der Berg") === "Piet van der Berg");
ok("whitespace collapses", normalizeName("  Dana   Lee  ") === "Dana Lee");
ok("empty becomes null", normalizeName("   ") === null);
ok("a full name splits", splitFullName("dana lee").firstName === "Dana");
ok("a multi-part surname stays together", splitFullName("piet van der berg").lastName === "Van Der Berg");
ok("a single name has no surname", splitFullName("Cher").lastName === null);

console.log("\n--- company ---");
ok("a legal suffix is stripped", normalizeCompany("Acme Widgets, Inc.") === "Acme Widgets");
ok("GmbH is stripped", normalizeCompany("Nordwind GmbH") === "Nordwind");
ok("Pty Ltd is stripped", normalizeCompany("Southern Cross Pty Ltd") === "Southern Cross");
ok("a name that is ONLY a suffix is not emptied", normalizeCompany("Limited") === "Limited");
ok("an ordinary name is untouched", normalizeCompany("Northwind Labs") === "Northwind Labs");

console.log("\n--- linkedin + phone ---");
ok("a profile URL is canonicalised",
  normalizeLinkedIn("https://uk.linkedin.com/in/Dana-Lee-123/") === "https://www.linkedin.com/in/dana-lee-123");
ok("a /pub/ URL works too", normalizeLinkedIn("linkedin.com/pub/danalee") !== null);
ok("a non-LinkedIn URL yields null", normalizeLinkedIn("https://twitter.com/dana") === null);
ok("a US number gets +1", normalizePhone("(512) 555-0143", "US") === "+15125550143");
ok("a UK number drops the trunk zero", normalizePhone("020 7946 0958", "GB") === "+442079460958");
ok("an already-E.164 number is kept", normalizePhone("+33123456789", "FR") === "+33123456789");
ok("with NO country we do not guess a prefix", normalizePhone("020 7946 0958", null) === "020 7946 0958");

console.log("\n--- full normalisation ---");
{
  const raw: RawLead = {
    email: "  Dana.Lee@ACME.DE ", fullName: "DANA LEE", title: "head of ops",
    companyName: "Acme Widgets GmbH", phone: "030 12345678",
  };
  const n = normalizeLead(raw, OPTS)!;
  ok("email normalised", n.email === "Dana.Lee@acme.de");
  ok("name split and repaired", n.firstName === "Dana" && n.lastName === "Lee");
  ok("title repaired", n.title === "Head Of Ops");
  ok("company suffix stripped", n.companyName === "Acme Widgets");
  ok("country derived from the ccTLD", n.country === "DE" && n.countrySource === "tld");
  ok("phone formatted using that country", n.phone === "+493012345678");
}
{
  const n = normalizeLead({ email: "d@acme.com", country: "us" }, OPTS)!;
  ok("a declared country wins and uppercases", n.country === "US" && n.countrySource === "declared");
}
{
  const n = normalizeLead({ email: "d@acme.com" }, OPTS)!;
  ok("a .com yields NO country — it carries no jurisdiction information",
    n.country === null && n.countrySource === null);
}
ok("a row with no email is rejected", normalizeLead({ firstName: "Dana" }, OPTS) === null);

console.log("\n--- dedupe ---");
{
  const leads = [
    normalizeLead({ email: "a@acme.com", firstName: "Dana" }, OPTS)!,
    normalizeLead({ email: "A@ACME.com", firstName: "Dana", lastName: "Lee", title: "CTO" }, OPTS)!,
    normalizeLead({ email: "b@acme.com", firstName: "Sam" }, OPTS)!,
  ];
  const r = dedupe(leads);
  ok("case-different addresses collapse", r.unique.length === 2, String(r.unique.length));
  ok("the RICHER row is kept",
    r.unique.find((l) => l.email.toLowerCase() === "a@acme.com")?.lastName === "Lee");
  ok("and the address we send to keeps its original case",
    r.unique.some((l) => l.email === "A@ACME.com".replace("@ACME.com", "@acme.com")));
  ok("the duplicate is reported", r.exactDuplicates[0]?.count === 2);
  ok("the dedupe key folds case but the address does not",
    dedupeKey("Dana@Acme.com") === "dana@acme.com" && normalizeEmail("Dana@Acme.com") === "Dana@acme.com");
}
{
  const leads = [
    normalizeLead({ email: "d.lee@acme.com", firstName: "Dana", lastName: "Lee" }, OPTS)!,
    normalizeLead({ email: "dana@acme.com", firstName: "Dana", lastName: "Lee" }, OPTS)!,
  ];
  const r = dedupe(leads);
  ok("same person at the same company is flagged", r.probableDuplicates.length === 1);
  ok("but NOT auto-merged — a human decides", r.unique.length === 2);
}
{
  const leads = [
    normalizeLead({ email: "d@acme.com", firstName: "Dana", lastName: "Lee" }, OPTS)!,
    normalizeLead({ email: "d@northwind.com", firstName: "Dana", lastName: "Lee" }, OPTS)!,
  ];
  ok("the same name at a DIFFERENT company is not a duplicate",
    dedupe(leads).probableDuplicates.length === 0);
}

console.log("\n--- the compliance gate ---");
const OUTCOME = new Map(JURISDICTION_POLICIES.map((j) => [j.countryCode, j.outcome]));
const outcomeFor = (c: string | null) =>
  (c === null ? null : (OUTCOME.get(c) ?? OUTCOME.get("*") ?? null)) as
    "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK" | null;

const ATTEST: ImportAttestation = {
  sourceType: "csv", sourceDetail: "Exported from our 2026 conference booth scans",
  attestedByUserId: "u1", attestedAt: AT, attestationIp: "203.0.113.9",
};
const gate = (over: Partial<GateInputs> = {}): GateInputs => ({
  outcomeFor, hasBasis: () => false, isSuppressed: () => false,
  attestation: ATTEST, now: AT, ...over,
});

const mk = (email: string, country?: string): NormalizedLead =>
  normalizeLead({ email, country }, OPTS)!;

{
  const r = assess([mk("a@acme.com", "US"), mk("b@acme.com", "US")], gate());
  ok("US rows are sendable", r.sendable === 2 && r.blocked === 0);
  ok("and the reason is recorded per row", r.rows[0]!.reason.includes("opt-out"));
  ok("activation is allowed", canActivate(r).canActivate);
}
{
  const r = assess([mk("a@acme.de")], gate());
  ok("a German row is BLOCKED without consent", r.blocked === 1 && r.sendable === 0);
  ok("and says why", r.rows[0]!.reason.includes("prior consent"));
  ok("the LIST cannot activate while a row is blocked", !canActivate(r).canActivate);
  ok("with an actionable blocker message",
    canActivate(r).blockers.some((b) => b.includes("Remove or quarantine")));
}
{
  const r = assess([mk("a@acme.de")], gate({ hasBasis: () => true }));
  ok("a recorded basis lifts the German block", r.sendable === 1 && r.blocked === 0);
  ok("and names the basis as the reason", r.rows[0]!.reason === "recorded lawful basis");
}
{
  const r = assess([mk("a@acme.co.uk")], gate());
  ok("a UK row NEEDS a basis rather than being blocked", r.needsBasis === 1);
  ok("needs-basis rows do NOT block list activation — that state is recoverable",
    canActivate(r).canActivate);
}
{
  const r = assess([mk("a@acme.com")], gate());
  ok("an unresolvable jurisdiction is BLOCKED, never assumed",
    r.blocked === 1 && r.rows[0]!.reason === "jurisdiction unresolved");
}
{
  const r = assess([mk("a@acme.com", "US")], gate({ isSuppressed: () => true }));
  ok("a suppressed address is blocked before jurisdiction is even considered",
    r.blocked === 1 && r.rows[0]!.reason === "suppressed");
}
{
  const r = assess([mk("a@acme.com", "US")], gate({ attestation: null }));
  ok("a list with NO attested provenance cannot activate, however clean the rows",
    r.sendable === 1 && !canActivate(r).canActivate);
  ok("and says provenance is the blocker",
    canActivate(r).blockers.some((b) => b.includes("Provenance is required")));
}
{
  ok("an empty list cannot activate", !canActivate(assess([], gate())).canActivate);
}
{
  const r = assess([mk("a@acme.com", "US"), mk("b@acme.de"), mk("c@acme.co.uk")], gate());
  ok("a mixed list counts every category",
    r.sendable === 1 && r.blocked === 1 && r.needsBasis === 1, JSON.stringify({s:r.sendable,b:r.blocked,n:r.needsBasis}));
  ok("reasons are aggregated for the summary", Object.keys(r.byReason).length === 3);
  const csv = reportToCsv(r);
  ok("the report exports as CSV counsel can read", csv.split("\n").length === 4);
  ok("with a header naming the verdict", csv.startsWith("email,verdict,country,reason"));
  ok("and the attestation travels with the report", r.attestation?.sourceDetail.includes("conference booth"));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
