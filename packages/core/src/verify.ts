import { promises as dnsp } from "node:dns";

// Email-list verification: validate addresses BEFORE sending so dead, disposable,
// blacklisted, or role addresses don't bounce and wreck sending reputation.

// Common disposable / throwaway domains (high-risk, never-engaging). Extensible.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com", "getnada.com",
  "trashmail.com", "trashmail.de", "sharklasers.com", "grr.la", "spam4.me",
  "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com", "fakeinbox.com",
  "tempinbox.com", "dispostable.com", "mailcatch.com", "spamgourmet.com",
  "33mail.com", "tempmailaddress.com", "emailondeck.com", "burnermail.io",
  "moakt.com", "tmpmail.org", "tmpmail.net", "tempr.email", "discard.email",
  "maileater.com", "spambox.us", "tempemail.com", "fakemailgenerator.com",
  "guerrillamailblock.com", "pokemail.net", "spam.la", "anonbox.net",
  "mail-temporaire.fr", "jetable.org", "throwawaymailbox.com", "wegwerfemail.de",
  "einrot.com", "fleckens.hu", "cuvox.de", "dayrep.com", "rhyta.com",
  "teleworm.us", "armyspy.com", "gustr.com", "superrito.com", "tempail.com",
  "luxusmail.org", "mailto.plus", "fexbox.org", "rover.info", "vomoto.com",
  "harakirimail.com", "incognitomail.org", "mailnull.com", "mytemp.email",
  "nada.email", "tempmailo.com", "minuteinbox.com", "1secmail.com", "1secmail.org",
  "kzccv.com", "qiott.com", "wuuvo.com", "icznn.com", "ezztt.com",
]);

// Role-based local parts — low engagement, often spam traps / shared inboxes.
export const ROLE_LOCALPARTS = new Set([
  "admin", "administrator", "info", "support", "sales", "contact", "help",
  "postmaster", "hostmaster", "webmaster", "abuse", "noreply", "no-reply",
  "donotreply", "do-not-reply", "marketing", "billing", "office", "mail",
  "team", "hello", "careers", "jobs", "hr", "security", "root", "sysadmin",
  "enquiries", "enquiry", "feedback", "newsletter", "notifications",
]);

// Pragmatic RFC-5322-ish syntax check (good enough to reject the obviously-broken).
const EMAIL_RE = /^(?=.{3,254}$)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}
export function isValidSyntax(email: string): boolean {
  return EMAIL_RE.test(email);
}
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1) : null;
}
export function emailLocalPart(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}
export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}
export function isRoleAddress(email: string): boolean {
  return ROLE_LOCALPARTS.has(emailLocalPart(email));
}

/** Does the domain accept mail? MX records, or an A record as implicit MX. null = lookup failed. */
export async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  try {
    const mx = await dnsp.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "NXDOMAIN") return false; // domain doesn't exist
    if (code !== "ENODATA") return null; // real error
  }
  // No MX — RFC 5321 allows fallback to the A record.
  try {
    const a = await dnsp.resolve4(domain);
    return a.length > 0;
  } catch {
    return false;
  }
}

/** Spamhaus DBL — is the recipient domain on the domain blocklist? null = lookup failed. */
export async function domainOnDBL(domain: string): Promise<boolean | null> {
  try {
    const r = await dnsp.resolve4(`${domain}.dbl.spamhaus.org`);
    // 127.0.1.x = listed; 127.255.255.x = query refused/blocked.
    return r.some((a) => a.startsWith("127.0.1.")) ? true : false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
}

export type VerifyStatus = "deliverable" | "risky" | "undeliverable" | "unknown";
export interface VerifyChecks {
  syntax: boolean;
  mx: boolean | null;
  disposable: boolean;
  role: boolean;
  dbl: boolean | null;
  suppressed: boolean;
}

export function classifyEmail(checks: VerifyChecks): {
  status: VerifyStatus;
  reasons: string[];
} {
  if (!checks.syntax) return { status: "undeliverable", reasons: ["invalid format"] };
  if (checks.mx === false)
    return { status: "undeliverable", reasons: ["domain can't receive mail (no MX)"] };

  const reasons: string[] = [];
  if (checks.suppressed) reasons.push("on your suppression list");
  if (checks.dbl) reasons.push("domain on Spamhaus DBL blocklist");
  if (checks.disposable) reasons.push("disposable/temporary domain");
  if (checks.role) reasons.push("role-based address (low engagement)");
  if (checks.suppressed || checks.dbl || checks.disposable || checks.role) {
    return { status: "risky", reasons };
  }
  if (checks.mx === null || checks.dbl === null) {
    return { status: "unknown", reasons: ["could not fully verify (DNS)"] };
  }
  return { status: "deliverable", reasons: [] };
}
