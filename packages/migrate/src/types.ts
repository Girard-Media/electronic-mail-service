// Provider-agnostic migration model. A Source reads another ESP's account and
// returns this normalized Inventory; the report writer turns it into a plan +
// exported assets. Add new ESPs by implementing MigrationSource (see sources/).

export interface DomainItem {
  name: string;
  /** the source's verification status, verbatim */
  status: string;
  region?: string;
  createdAt?: string;
}

export interface ContactItem {
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed?: boolean;
}

export interface AudienceItem {
  id: string;
  name: string;
  contacts: ContactItem[];
}

/** A reusable email body (from a Resend broadcast / a stored template). */
export interface TemplateItem {
  id: string;
  name: string;
  subject?: string;
  from?: string;
  html?: string;
  text?: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  createdAt?: string;
}

// ---- Outreach-platform concepts (EMS retarget, E01-028) ----
// Cold-outreach tools organise work as campaigns → sequenced steps sent from
// mailboxes to lead lists, with platform-level suppression. These items let an
// outreach source (Instantly, Smartlead, …) express its account in EMS terms.
// ESP-sourced inventories leave these empty.

export interface SequenceStepItem {
  position: number;
  subject?: string;
  /** delay after the previous step, e.g. "2d" — verbatim from the source */
  delay?: string;
  hasVariant?: boolean;
}

export interface CampaignItem {
  id: string;
  name: string;
  /** the source's status, verbatim (active/paused/draft/…) */
  status: string;
  steps: SequenceStepItem[];
  /** sending mailbox addresses attached to the campaign, verbatim */
  mailboxes: string[];
}

export interface LeadListItem {
  id: string;
  name: string;
  contacts: ContactItem[];
}

export interface MailboxItem {
  /** full address, e.g. "ava@send.bootspring.com" */
  email: string;
  domain: string;
  /** the source's status, verbatim */
  status: string;
  /** daily sending limit declared by the source, if any */
  dailyCap?: number;
}

export interface SuppressionItem {
  email: string;
  /** reason verbatim from the source (bounce/complaint/unsub/…) */
  reason?: string;
}

export interface Inventory {
  /** source name, e.g. "resend" (ESP) or "instantly" (outreach) */
  source: string;
  /** ISO timestamp the inventory was captured */
  fetchedAt: string;
  domains: DomainItem[];
  audiences: AudienceItem[];
  templates: TemplateItem[];
  apiKeys: ApiKeyItem[];
  /** outreach campaigns with their sequenced steps */
  campaigns: CampaignItem[];
  /** outreach lead lists (import via EMS lead import) */
  leadLists: LeadListItem[];
  /** sending mailboxes (re-provision in EMS — credentials never export) */
  mailboxes: MailboxItem[];
  /** suppressions/unsubs (import FIRST — I1: no unsuppressed send) */
  suppressions: SuppressionItem[];
  /** human-readable warnings, skipped resources, and manual follow-ups */
  notes: string[];
}

export interface MigrationSource {
  /** lowercase ESP id used in output + the CLI (e.g. "resend") */
  readonly name: string;
  /** Read-only: pull everything migratable into a normalized Inventory. */
  inventory(): Promise<Inventory>;
}

export function emptyInventory(source: string, fetchedAt: string): Inventory {
  return {
    source,
    fetchedAt,
    domains: [],
    audiences: [],
    templates: [],
    apiKeys: [],
    campaigns: [],
    leadLists: [],
    mailboxes: [],
    suppressions: [],
    notes: [],
  };
}
