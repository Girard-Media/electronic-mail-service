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
/** Free-mail domains: never derive a company domain from one (E13-018). */

export * from "./import.js";
