/**
 * Sending identity rules (E05-010, E05-015..022).
 * Pure — the API owns Prisma.
 */

export const ROLE_LOCAL_PARTS = new Set([
  "info",
  "sales",
  "noreply",
  "no-reply",
  "admin",
  "support",
  "hello",
  "contact",
  "office",
  "billing",
  "team",
  "mail",
  "postmaster",
  "abuse",
  "webmaster",
  "marketing",
  "news",
]);

export const MAX_MAILBOXES_PER_DOMAIN = 3;
export const DEFAULT_MAILBOXES_PER_DOMAIN = 2;

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export function normalizeLocalPart(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isRoleLocalPart(local: string): boolean {
  return ROLE_LOCAL_PARTS.has(normalizeLocalPart(local));
}

export function isValidLocalPart(local: string): boolean {
  const n = normalizeLocalPart(local);
  return n.length >= 1 && n.length <= 64 && LOCAL_RE.test(n);
}

/** Live = anything that still occupies a slot on the domain. */
export function occupiesMailboxSlot(status: string): boolean {
  return status !== "RETIRED" && status !== "BURNED";
}

export function mailboxSlotError(liveCount: number, max = MAX_MAILBOXES_PER_DOMAIN): string | null {
  if (liveCount >= max) {
    return `This domain already has ${max} mailboxes (the default cap).`;
  }
  return null;
}

export interface PersonaIdentity {
  firstName: string;
  lastName: string;
  title?: string | null;
  companyName: string;
  postalAddress: string;
}

export function normalizePostalAddress(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** CAN-SPAM physical address. Country-format parsing is E05-017; this is the floor. */
export function postalAddressError(raw: string): string | null {
  const n = normalizePostalAddress(raw);
  if (n.length < 8) return "A postal address is required (CAN-SPAM).";
  if (!/\d/.test(n)) return "Postal address must include a street number or box number.";
  return null;
}

export function personaSignature(p: PersonaIdentity): { text: string; html: string } {
  const name = `${p.firstName.trim()} ${p.lastName.trim()}`.replace(/\s+/g, " ").trim();
  const titleLine = p.title?.trim() ? `${p.title.trim()}\n` : "";
  const text = `${name}\n${titleLine}${p.companyName.trim()}\n${normalizePostalAddress(p.postalAddress)}`;
  const html = text
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>\n");
  return { text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
