/**
 * @ems/leads — import, normalise, dedupe, segment, enrich.
 *
 * A list cannot be activated for sending until every row resolves to a
 * jurisdiction AND an allowed basis. The importer produces a per-batch
 * compliance report the customer's counsel can read (planning/COMPLIANCE.md §3).
 */

export type LeadStatus =
  | "NEW" | "VERIFIED" | "RISKY" | "INVALID" | "ENROLLED" | "CONTACTED"
  | "REPLIED" | "BOUNCED" | "UNSUBSCRIBED" | "SUPPRESSED" | "CONVERTED";

export type ListStatus = "IMPORTING" | "NEEDS_REVIEW" | "READY" | "ARCHIVED";

/** Provenance is mandatory. No list activates without a stated source (E13-035). */
export type SourceType = "csv" | "api" | "crm" | "event" | "form" | "partner";

export interface ImportAttestation {
  sourceType: SourceType;
  sourceDetail: string;
  attestedByUserId: string;
  attestedAt: Date;
  attestationIp: string;
}

export interface ComplianceReport {
  total: number;
  sendable: number;
  blocked: number;
  needsBasis: number;
  byReason: Record<string, number>;
  generatedAt: Date;
}

export function canActivate(r: ComplianceReport): boolean {
  return r.blocked === 0 && r.needsBasis === 0 && r.total > 0;
}

/** Free-mail domains: never derive a company domain from one (E13-018). */
export const FREE_MAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "zoho.com", "yandex.com",
] as const;

export function companyDomainFrom(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if ((FREE_MAIL_DOMAINS as readonly string[]).includes(domain)) return null;
  return domain;
}

export function normalizeEmail(raw: string): string {
  const [local, domain] = raw.trim().split("@");
  if (!local || !domain) return raw.trim().toLowerCase();
  return `${local}@${domain.toLowerCase()}`;
}
