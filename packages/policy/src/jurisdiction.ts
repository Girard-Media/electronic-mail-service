/**
 * Jurisdiction resolution (E14-018..E14-024). planning/COMPLIANCE.md §2.
 *
 * Four sources, in precedence order. First confident answer wins, and the source
 * and confidence are recorded on every decision.
 *
 * THE ASYMMETRY RULE (E14-020): a weak signal may make the policy STRICTER, never
 * looser. If the TLD says .com (ambiguous) and the MX geolocates to Germany, the
 * message is treated as German. This is deliberate — over-blocking costs volume,
 * under-blocking costs the company.
 */

export type JurisdictionSource = "declared" | "company" | "tld" | "mxgeo";

export interface JurisdictionSignal {
  source: JurisdictionSource;
  country: string | null;
  confidence: number;
}

export interface JurisdictionResolution {
  country: string | null;
  source: JurisdictionSource | null;
  confidence: number;
  /** Every signal considered, so the decision is reconstructable a year later. */
  signals: JurisdictionSignal[];
  /** True when a weaker signal overrode a stronger one by being stricter. */
  tightenedBy: JurisdictionSource | null;
}

/** Higher wins when strictness is equal. */
const PRECEDENCE: Record<JurisdictionSource, number> = {
  declared: 4,
  company: 3,
  tld: 2,
  mxgeo: 1,
};

/**
 * ccTLD → ISO-3166-2. Data, not code (E14-022). Generic TLDs are deliberately
 * absent: .com carries no jurisdiction information and must not pretend to.
 */
export const CCTLD_COUNTRY: Record<string, string> = {
  ac: "SH", ad: "AD", ae: "AE", af: "AF", ag: "AG", al: "AL", am: "AM", ao: "AO",
  ar: "AR", at: "AT", au: "AU", az: "AZ", ba: "BA", bd: "BD", be: "BE", bg: "BG",
  bh: "BH", bo: "BO", br: "BR", bw: "BW", by: "BY", ca: "CA", cd: "CD", ch: "CH",
  cl: "CL", cm: "CM", cn: "CN", co: "CO", cr: "CR", cu: "CU", cy: "CY", cz: "CZ",
  de: "DE", dk: "DK", do: "DO", dz: "DZ", ec: "EC", ee: "EE", eg: "EG", es: "ES",
  et: "ET", fi: "FI", fr: "FR", ge: "GE", gh: "GH", gr: "GR", gt: "GT", hk: "HK",
  hr: "HR", hu: "HU", id: "ID", ie: "IE", il: "IL", in: "IN", iq: "IQ", ir: "IR",
  is: "IS", it: "IT", jo: "JO", jp: "JP", ke: "KE", kr: "KR", kw: "KW", kz: "KZ",
  lb: "LB", lk: "LK", lt: "LT", lu: "LU", lv: "LV", ly: "LY", ma: "MA", md: "MD",
  me: "ME", mk: "MK", mt: "MT", mu: "MU", mx: "MX", my: "MY", ng: "NG", nl: "NL",
  no: "NO", np: "NP", nz: "NZ", om: "OM", pa: "PA", pe: "PE", ph: "PH", pk: "PK",
  pl: "PL", pt: "PT", py: "PY", qa: "QA", ro: "RO", rs: "RS", ru: "RU", sa: "SA",
  se: "SE", sg: "SG", si: "SI", sk: "SK", sn: "SN", th: "TH", tn: "TN", tr: "TR",
  tw: "TW", tz: "TZ", ua: "UA", ug: "UG", uk: "GB", us: "US", uy: "UY", ve: "VE",
  vn: "VN", za: "ZA", zm: "ZM", zw: "ZW",
};

/** Second-level forms that carry the country in the SLD rather than the TLD. */
const SLD_COUNTRY: Record<string, string> = {
  "co.uk": "GB", "org.uk": "GB", "ac.uk": "GB", "gov.uk": "GB", "ltd.uk": "GB",
  "com.au": "AU", "net.au": "AU", "org.au": "AU", "edu.au": "AU",
  "co.nz": "NZ", "co.za": "ZA", "com.br": "BR", "com.mx": "MX", "co.jp": "JP",
  "com.sg": "SG", "com.tr": "TR", "co.in": "IN", "com.cn": "CN", "co.kr": "KR",
};

export function countryFromDomain(domain: string): string | null {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  const parts = d.split(".");
  if (parts.length >= 3) {
    const sld = parts.slice(-2).join(".");
    const hit = SLD_COUNTRY[sld];
    if (hit) return hit;
  }
  if (parts.length >= 2) {
    const sld = parts.slice(-2).join(".");
    const hit = SLD_COUNTRY[sld];
    if (hit) return hit;
  }
  const tld = parts[parts.length - 1];
  if (!tld) return null;
  return CCTLD_COUNTRY[tld] ?? null;
}

export interface StrictnessLookup {
  /** Higher = stricter. Used only to decide whether a weak signal may tighten. */
  (country: string): number;
}

/**
 * Resolve, honouring precedence AND the asymmetry rule.
 *
 * @param strictness ranks countries so we can tell "stricter" from "different".
 *        Without it a weak signal could only ever be ignored, which would let
 *        a .com address bound for Germany through on a US rule.
 */
export function resolveJurisdiction(
  signals: JurisdictionSignal[],
  strictness: StrictnessLookup,
): JurisdictionResolution {
  const usable = signals.filter((s): s is JurisdictionSignal & { country: string } =>
    s.country !== null && s.confidence > 0);

  if (usable.length === 0) {
    // Unresolved. The caller BLOCKS — never "assume allowed" (I7).
    return { country: null, source: null, confidence: 0, signals, tightenedBy: null };
  }

  // Highest precedence with usable confidence is the baseline answer.
  const primary = [...usable].sort(
    (a, b) => PRECEDENCE[b.source] - PRECEDENCE[a.source] || b.confidence - a.confidence,
  )[0]!;

  // Asymmetry: any OTHER signal naming a strictly stricter country overrides it.
  let chosen = primary;
  let tightenedBy: JurisdictionSource | null = null;
  for (const s of usable) {
    if (s === chosen) continue;
    if (strictness(s.country) > strictness(chosen.country)) {
      chosen = s;
      tightenedBy = s.source;
    }
  }

  return {
    country: chosen.country,
    source: chosen.source,
    // A tightened answer inherits the confidence of the signal that tightened it,
    // not the primary's — we are less sure *which* country, but more sure we must
    // be careful. Reporting the higher number would overstate what we know.
    confidence: chosen.confidence,
    signals,
    tightenedBy,
  };
}

/**
 * Strictness ranking used when no policy table is available (tests, and the
 * bootstrap path before the table loads). BLOCK > ALLOW_WITH_BASIS > ALLOW.
 */
export function strictnessFromOutcome(
  outcomeFor: (country: string) => "ALLOW" | "ALLOW_WITH_BASIS" | "BLOCK" | undefined,
): StrictnessLookup {
  return (country: string) => {
    switch (outcomeFor(country)) {
      case "BLOCK": return 3;
      case "ALLOW_WITH_BASIS": return 2;
      case "ALLOW": return 1;
      // An unknown country is treated as maximally strict: we block it, so it
      // must be able to tighten a permissive answer.
      default: return 3;
    }
  };
}
