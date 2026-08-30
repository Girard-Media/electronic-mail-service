/**
 * Lead import: normalise, dedupe, and gate (E13-014..E13-041).
 *
 * The gate is the point. A list cannot be activated for sending until every row
 * resolves to a jurisdiction AND an allowed basis, and the importer produces a
 * per-batch compliance report the customer's counsel can read. That artifact is
 * the thing no competitor can generate, so it is a first-class output rather
 * than a log line.
 *
 * Normalisation follows one rule throughout: never mangle a value we are unsure
 * about. A name we cannot confidently fix is left as supplied, because a wrong
 * "correction" is worse than an inconsistent one and shows up in the greeting.
 */

export type SourceType = "csv" | "api" | "crm" | "event" | "form" | "partner";

export interface ImportAttestation {
  sourceType: SourceType;
  sourceDetail: string;
  attestedByUserId: string;
  attestedAt: Date;
  attestationIp: string;
}

export interface RawLead {
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  companyName?: string;
  companyDomain?: string;
  country?: string;
  linkedinUrl?: string;
  phone?: string;
  custom?: Record<string, string>;
}

export interface NormalizedLead {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  country: string | null;
  countrySource: "declared" | "company" | "tld" | null;
  linkedinUrl: string | null;
  phone: string | null;
  custom: Record<string, string>;
}

// ── Normalisation ────────────────────────────────────────────────────────────

export function normalizeEmail(raw: string): string {
  const t = raw.trim();
  const at = t.lastIndexOf("@");
  if (at < 0) return t.toLowerCase();
  return `${t.slice(0, at)}@${t.slice(at + 1).toLowerCase()}`;
}

/**
 * Fix obvious case damage and nothing else.
 *
 * ALL CAPS and all-lowercase are repaired because they are almost always an
 * export artefact. Anything already mixed-case is left alone: "McDonald",
 * "van der Berg" and "OConnell-Smith" are real and we have no way to tell a
 * deliberate capitalisation from a mistake.
 */
export function normalizeName(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed === "") return null;

  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const isAllLower = trimmed === trimmed.toLowerCase() && /[a-z]/.test(trimmed);
  if (!isAllCaps && !isAllLower) return trimmed;

  return trimmed
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          part
            .split("'")
            .map((p) => (p.length === 0 ? p : p[0]!.toUpperCase() + p.slice(1).toLowerCase()))
            .join("'"),
        )
        .join("-"),
    )
    .join(" ");
}

export function splitFullName(full: string | undefined): { firstName: string | null; lastName: string | null } {
  const n = normalizeName(full);
  if (!n) return { firstName: null, lastName: null };
  const parts = n.split(" ").filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/** Legal suffixes stripped into a cleaner display name, never deleted outright. */
const LEGAL_SUFFIX = /[,\s]+(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|limited|plc|gmbh|ag|s\.a\.|sa|sas|sarl|bv|nv|oy|ab|as|aps|pty|pty ltd|co|co\.|corp|corp\.|corporation|company|holdings|group)\.?$/i;

export function normalizeCompany(raw: string | undefined): string | null {
  const n = normalizeName(raw);
  if (!n) return null;
  const stripped = n.replace(LEGAL_SUFFIX, "").trim();
  return stripped === "" ? n : stripped;
}

/** Free-mail domains are never a company domain (E13-018). */
export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com", "web.de",
]);

export function companyDomainFrom(email: string, declared?: string): string | null {
  if (declared) {
    const d = declared.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (d && !FREE_MAIL.has(d)) return d;
  }
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_MAIL.has(domain)) return null;
  return domain;
}

export function normalizeLinkedIn(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /linkedin\.com\/(?:in|pub)\/([A-Za-z0-9._%-]+)/i.exec(raw.trim());
  return m?.[1] ? `https://www.linkedin.com/in/${m[1].toLowerCase()}` : null;
}

/** E.164 where a country is known; otherwise left alone rather than guessed. */
const DIAL_CODE: Record<string, string> = {
  US: "1", CA: "1", GB: "44", IE: "353", FR: "33", DE: "49", ES: "34", IT: "39",
  NL: "31", BE: "32", CH: "41", AT: "43", SE: "46", NO: "47", DK: "45", FI: "358",
  PL: "48", PT: "351", AU: "61", NZ: "64", JP: "81", SG: "65", IN: "91", ZA: "27",
  BR: "55", MX: "52", AE: "971",
};

export function normalizePhone(raw: string | undefined, country: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned === "") return null;
  if (cleaned.startsWith("+")) return cleaned;
  const code = country ? DIAL_CODE[country.toUpperCase()] : undefined;
  // No country, no guess — a mis-prefixed number is worse than an unformatted one.
  if (!code) return raw.trim();
  const national = cleaned.replace(/^0+/, "");
  return `+${code}${national}`;
}

export interface NormalizeOptions {
  /** ccTLD → country, injected so @ems/leads does not depend on @ems/policy. */
  countryFromDomain(domain: string): string | null;
}

export function normalizeLead(raw: RawLead, opts: NormalizeOptions): NormalizedLead | null {
  if (!raw.email) return null;
  const email = normalizeEmail(raw.email);

  let firstName = normalizeName(raw.firstName);
  let lastName = normalizeName(raw.lastName);
  if (!firstName && !lastName && raw.fullName) {
    ({ firstName, lastName } = splitFullName(raw.fullName));
  }

  const companyDomain = companyDomainFrom(email, raw.companyDomain);

  let country: string | null = null;
  let countrySource: NormalizedLead["countrySource"] = null;
  if (raw.country && raw.country.trim().length >= 2) {
    country = raw.country.trim().toUpperCase().slice(0, 2);
    countrySource = "declared";
  } else if (companyDomain) {
    const fromTld = opts.countryFromDomain(companyDomain);
    if (fromTld) { country = fromTld; countrySource = "tld"; }
  }

  return {
    email,
    firstName, lastName,
    title: normalizeName(raw.title),
    companyName: normalizeCompany(raw.companyName),
    companyDomain,
    country, countrySource,
    linkedinUrl: normalizeLinkedIn(raw.linkedinUrl),
    phone: normalizePhone(raw.phone, country),
    custom: raw.custom ?? {},
  };
}

// ── Dedupe ───────────────────────────────────────────────────────────────────

export interface DedupeResult {
  unique: NormalizedLead[];
  exactDuplicates: Array<{ email: string; count: number }>;
  /** Same person, different address — surfaced for review, never auto-merged. */
  probableDuplicates: Array<{ a: string; b: string; reason: string }>;
}

/**
 * Dedupe key. RFC 5321 says the local part is case-sensitive, so we PRESERVE it
 * on the address we send to — but for deduplication we fold case, because
 * `Dana@acme.com` and `dana@acme.com` are one human and mailing both is a
 * duplicate send, not two contacts.
 */
export function dedupeKey(email: string): string {
  return email.toLowerCase();
}

export function dedupe(leads: NormalizedLead[]): DedupeResult {
  const byEmail = new Map<string, NormalizedLead>();
  const counts = new Map<string, number>();

  for (const l of leads) {
    const key = dedupeKey(l.email);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const existing = byEmail.get(key);
    // Keep the richer row when the same address appears twice.
    if (!existing || fieldCount(l) > fieldCount(existing)) byEmail.set(key, l);
  }

  const unique = [...byEmail.values()];
  const probable: DedupeResult["probableDuplicates"] = [];
  const byPerson = new Map<string, NormalizedLead[]>();

  for (const l of unique) {
    if (!l.firstName || !l.lastName || !l.companyDomain) continue;
    const key = `${l.firstName.toLowerCase()}|${l.lastName.toLowerCase()}|${l.companyDomain}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), l]);
  }
  for (const group of byPerson.values()) {
    for (let i = 1; i < group.length; i++) {
      probable.push({
        a: group[0]!.email, b: group[i]!.email,
        reason: "same name at the same company domain",
      });
    }
  }

  return {
    unique,
    exactDuplicates: [...counts.entries()].filter(([, c]) => c > 1).map(([email, count]) => ({ email, count })),
    probableDuplicates: probable,
  };
}

function fieldCount(l: NormalizedLead): number {
  return Object.values(l).filter((v) => v !== null && v !== "" && typeof v !== "object").length;
}

// ── The compliance gate ──────────────────────────────────────────────────────

export type RowVerdict = "sendable" | "needs-basis" | "blocked";

export interface RowAssessment {
  email: string;
  verdict: RowVerdict;
  reason: string;
  country: string | null;
}

export interface ComplianceReport {
  total: number;
  sendable: number;
  needsBasis: number;
  blocked: number;
  byReason: Record<string, number>;
  rows: RowAssessment[];
  generatedAt: Date;
  attestation: ImportAttestation | null;
}

export interface GateInputs {
  /** ALLOW | ALLOW_WITH_BASIS | BLOCK for a resolved country, or null if unknown. */
  outcomeFor(country: string | null): "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK" | null;
  /** Whether this lead already carries a live, allowed consent record. */
  hasBasis(email: string): boolean;
  /** Suppressed anywhere — global, org, or role. */
  isSuppressed(email: string): boolean;
  attestation: ImportAttestation | null;
  now?: Date;
}

export function assess(leads: NormalizedLead[], g: GateInputs): ComplianceReport {
  const rows: RowAssessment[] = [];
  const byReason: Record<string, number> = {};
  const count = (r: string) => { byReason[r] = (byReason[r] ?? 0) + 1; };

  for (const l of leads) {
    if (g.isSuppressed(l.email)) {
      rows.push({ email: l.email, verdict: "blocked", reason: "suppressed", country: l.country });
      count("suppressed");
      continue;
    }
    if (l.country === null) {
      // Unresolvable jurisdiction blocks (I7). Never "assume allowed".
      rows.push({ email: l.email, verdict: "blocked", reason: "jurisdiction unresolved", country: null });
      count("jurisdiction unresolved");
      continue;
    }
    const outcome = g.outcomeFor(l.country);
    if (outcome === null || outcome === "BLOCK") {
      if (g.hasBasis(l.email)) {
        rows.push({ email: l.email, verdict: "sendable", reason: "recorded lawful basis", country: l.country });
        count("recorded lawful basis");
      } else {
        rows.push({ email: l.email, verdict: "blocked", reason: `${l.country} requires prior consent`, country: l.country });
        count(`${l.country} requires prior consent`);
      }
      continue;
    }
    if (outcome === "ALLOW_WITH_BASIS") {
      if (g.hasBasis(l.email)) {
        rows.push({ email: l.email, verdict: "sendable", reason: "recorded lawful basis", country: l.country });
        count("recorded lawful basis");
      } else {
        rows.push({ email: l.email, verdict: "needs-basis", reason: `${l.country} requires a recorded basis`, country: l.country });
        count(`${l.country} requires a recorded basis`);
      }
      continue;
    }
    rows.push({ email: l.email, verdict: "sendable", reason: `${l.country} permits opt-out sending`, country: l.country });
    count(`${l.country} permits opt-out sending`);
  }

  return {
    total: leads.length,
    sendable: rows.filter((r) => r.verdict === "sendable").length,
    needsBasis: rows.filter((r) => r.verdict === "needs-basis").length,
    blocked: rows.filter((r) => r.verdict === "blocked").length,
    byReason,
    rows,
    generatedAt: g.now ?? new Date(),
    attestation: g.attestation,
  };
}

export interface ActivationCheck {
  canActivate: boolean;
  blockers: string[];
}

/**
 * A list activates only when provenance is attested AND nothing is unresolved.
 * Rows needing a basis do not block the LIST — they are excluded from sending
 * until a basis is recorded, which is a different and recoverable state.
 */
export function canActivate(report: ComplianceReport): ActivationCheck {
  const blockers: string[] = [];
  if (report.attestation === null) {
    blockers.push("No list source has been attested. Provenance is required before any list can send.");
  }
  if (report.total === 0) {
    blockers.push("The list is empty.");
  }
  if (report.sendable === 0 && report.needsBasis === 0 && report.total > 0) {
    // Only a blocker when nothing can become sendable. A list where every row
    // merely needs a recorded basis is pending, not broken.
    blockers.push("No row in this list is sendable, and none can become sendable.");
  }
  if (report.blocked > 0) {
    blockers.push(
      `${report.blocked} row${report.blocked === 1 ? "" : "s"} cannot be sent to. ` +
      `Remove or quarantine them, or record a lawful basis.`,
    );
  }
  return { canActivate: blockers.length === 0, blockers };
}

/** CSV the customer's counsel can read, not a summary we assert (E13-038). */
export function reportToCsv(r: ComplianceReport): string {
  const head = "email,verdict,country,reason";
  const rows = r.rows.map((x) =>
    [x.email, x.verdict, x.country ?? "", `"${x.reason.replace(/"/g, '""')}"`].join(","));
  return [head, ...rows].join("\n");
}
