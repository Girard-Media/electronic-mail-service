/**
 * Platform-wide suppression (E02-069, E02-070). No tenant can override these.
 *
 * Stored as domain rules rather than addresses: the point is that nobody's
 * campaign ever touches these, whatever the list says.
 */
export interface GlobalSuppressionSeed {
  domain: string;
  reason: "INTERNAL" | "COMPETITOR" | "GOV_MIL" | "SPAM_TRAP";
  source: string;
}

/** Government and military. Never a legitimate cold-outreach target for us. */
const GOV_MIL = [
  "gov", "mil", "gov.uk", "gc.ca", "gov.au", "govt.nz", "europa.eu",
  "senate.gov", "house.gov", "usdoj.gov", "fbi.gov", "ftc.gov",
];

/** Our own properties — an accidental self-send is a bad look and pollutes data. */
const INTERNAL = [
  "electronicmailservices.com",
  "usermails.com",
  "girardmedia.com",
  "hostssh.com",
];

/** Competitors. Sending them cold outreach is free intelligence for them. */
const COMPETITOR = [
  "instantly.ai", "smartlead.ai", "lemlist.com", "apollo.io",
  "woodpecker.co", "reply.io", "salesforge.ai", "quickmail.com",
  "mailshake.com", "outreach.io", "salesloft.com",
];

/**
 * Known spam-trap and honeypot operators. A single hit here can cost an IP,
 * so these are blocked outright rather than scored.
 */
const TRAP_OPERATORS = [
  "spamhaus.org", "spamcop.net", "abuse.net", "uceprotect.net",
  "projecthoneypot.org", "spamtrap.io",
];

export const GLOBAL_SUPPRESSIONS: GlobalSuppressionSeed[] = [
  ...GOV_MIL.map((d): GlobalSuppressionSeed => ({ domain: d, reason: "GOV_MIL", source: "seed:gov-mil" })),
  ...INTERNAL.map((d): GlobalSuppressionSeed => ({ domain: d, reason: "INTERNAL", source: "seed:internal" })),
  ...COMPETITOR.map((d): GlobalSuppressionSeed => ({ domain: d, reason: "COMPETITOR", source: "seed:competitor" })),
  ...TRAP_OPERATORS.map((d): GlobalSuppressionSeed => ({ domain: d, reason: "SPAM_TRAP", source: "seed:trap-operator" })),
];
