// SendGrid → ems source. Read-only: every call is a GET against the
// SendGrid v3 API with the user's API key (Bearer SG.xxx). We never mutate the
// SendGrid account. Each resource is fetched defensively — a missing scope or
// unavailable endpoint adds a note and continues rather than aborting the whole
// migration.
import {
  emptyInventory,
  type Inventory,
  type MigrationSource,
  type AudienceItem,
  type TemplateItem,
} from "../types.js";

const SENDGRID_BASE = "https://api.sendgrid.com";

/** SendGrid wraps most list responses as `{ result: [...] }`; some are bare arrays. */
function unwrapList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const result = (body as { result?: unknown })?.result;
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

export interface SendGridSourceOptions {
  apiKey: string;
  /** override fetch (tests) */
  fetch?: typeof fetch;
  /** override base url (tests) */
  baseUrl?: string;
  /** ISO timestamp for the inventory; defaults to now. */
  now?: string;
}

export class SendGridSource implements MigrationSource {
  readonly name = "sendgrid";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly now: string;

  constructor(opts: SendGridSourceOptions) {
    if (!opts.apiKey) throw new Error("SendGridSource: apiKey is required.");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.base = (opts.baseUrl ?? SENDGRID_BASE).replace(/\/$/, "");
    this.now = opts.now ?? new Date().toISOString();
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GET ${path} → ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  async inventory(): Promise<Inventory> {
    const inv = emptyInventory(this.name, this.now);

    // ---- Domains (authenticated/"whitelabel" domains — the core migratable resource) ----
    try {
      for (const d of unwrapList(await this.get("/v3/whitelabel/domains"))) {
        const domain = String(d.domain ?? "");
        const subdomain = d.subdomain ? String(d.subdomain) : "";
        inv.domains.push({
          name: subdomain ? `${subdomain}.${domain}` : domain,
          status: Boolean(d.valid) ? "verified" : "pending",
          createdAt: undefined,
        });
      }
    } catch (e) {
      inv.notes.push(`Could not read domains: ${msg(e)}`);
    }

    // ---- Templates (legacy + dynamic; export the active version's body) ----
    try {
      const path = "/v3/templates?generations=legacy,dynamic&page_size=200";
      for (const t of unwrapList(await this.get(path))) {
        const versions = Array.isArray(t.versions)
          ? (t.versions as Record<string, unknown>[])
          : [];
        const active = versions.find((v) => Boolean(v?.active)) ?? versions?.[0];
        const tmpl: TemplateItem = {
          id: String(t.id ?? ""),
          name: String(t.name ?? t.id ?? ""),
          subject: active?.subject ? String(active.subject) : undefined,
          html: active?.html_content ? String(active.html_content) : undefined,
          text: active?.plain_content ? String(active.plain_content) : undefined,
        };
        inv.templates.push(tmpl);
        if (!tmpl.html && !tmpl.text) {
          inv.notes.push(`Template "${tmpl.name}" had no version body to export.`);
        }
      }
    } catch (e) {
      inv.notes.push(`Could not read templates: ${msg(e)}`);
    }

    // ---- Audiences (Marketing lists) — contact export is async, so contacts stay empty ----
    try {
      for (const l of unwrapList(await this.get("/v3/marketing/lists"))) {
        const id = String(l.id ?? "");
        const name = String(l.name ?? id);
        const count = l.contact_count ?? 0;
        const audience: AudienceItem = { id, name, contacts: [] };
        inv.audiences.push(audience);
        inv.notes.push(
          `SendGrid list "${name}" has ${String(count)} contacts — full export is async (POST /v3/marketing/contacts/exports); not pulled.`,
        );
      }
    } catch (e) {
      inv.notes.push(`Could not read marketing lists: ${msg(e)}`);
    }

    // ---- API keys (names only — secrets are never exposed by any ESP) ----
    try {
      for (const k of unwrapList(await this.get("/v3/api_keys"))) {
        inv.apiKeys.push({
          id: String(k.api_key_id ?? ""),
          name: String(k.name ?? "unnamed"),
        });
      }
    } catch (e) {
      inv.notes.push(`Could not read API keys: ${msg(e)}`);
    }

    // Suppressions aren't pulled here — review them for the ems suppression import.
    inv.notes.push(
      "SendGrid suppressions (bounces/spam/unsubscribes) are available at /v3/suppression/* and should be reviewed for ems suppression import.",
    );

    return inv;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
