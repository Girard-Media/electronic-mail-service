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

export interface Inventory {
  /** source ESP name, e.g. "resend" */
  source: string;
  /** ISO timestamp the inventory was captured */
  fetchedAt: string;
  domains: DomainItem[];
  audiences: AudienceItem[];
  templates: TemplateItem[];
  apiKeys: ApiKeyItem[];
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
  return { source, fetchedAt, domains: [], audiences: [], templates: [], apiKeys: [], notes: [] };
}
