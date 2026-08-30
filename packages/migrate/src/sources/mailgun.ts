// Mailgun → ems source. Read-only: every call is a GET against the Mailgun
// API. We never mutate the source account. Mailgun differs from the others:
//   • HTTP Basic auth (username "api", password = the API key), not Bearer.
//   • Region-specific hosts — US (api.mailgun.net) vs EU (api.eu.mailgun.net).
//   • Templates are PER DOMAIN, and the body lives on the active version, so we
//     iterate domains → templates → active version.
// Each resource is fetched defensively — a failure adds a note and continues.
import {
  emptyInventory,
  type Inventory,
  type MigrationSource,
  type ContactItem,
  type TemplateItem,
} from "../types.js";

const HOSTS = {
  us: "https://api.mailgun.net",
  eu: "https://api.eu.mailgun.net",
} as const;

/** Mailgun wraps list responses under `items`. */
function unwrapItems(body: unknown): Record<string, unknown>[] {
  const items = (body as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

export interface MailgunSourceOptions {
  apiKey: string;
  /** Mailgun region — keys are region-bound. Defaults to "us". */
  region?: "us" | "eu";
  /** override fetch (tests) */
  fetch?: typeof fetch;
  /** override base url (tests) — wins over region. */
  baseUrl?: string;
  /** ISO timestamp for the inventory; defaults to now. */
  now?: string;
  /** Cap on template bodies fetched (per-template GETs) to bound large accounts. */
  templateBodyCap?: number;
}

export class MailgunSource implements MigrationSource {
  readonly name = "mailgun";
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly now: string;
  private readonly cap: number;

  constructor(opts: MailgunSourceOptions) {
    if (!opts.apiKey) throw new Error("MailgunSource: apiKey is required.");
    // Basic api:<key>
    this.auth =
      "Basic " + Buffer.from(`api:${opts.apiKey}`).toString("base64");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.base = (opts.baseUrl ?? HOSTS[opts.region ?? "us"]).replace(/\/$/, "");
    this.now = opts.now ?? new Date().toISOString();
    this.cap = opts.templateBodyCap ?? 200;
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { Authorization: this.auth, Accept: "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GET ${path} → ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  async inventory(): Promise<Inventory> {
    const inv = emptyInventory(this.name, this.now);
    const domainNames: string[] = [];

    // ---- Domains ----
    try {
      for (const d of unwrapItems(await this.get("/v4/domains?limit=1000"))) {
        const name = String(d.name ?? "");
        if (name) domainNames.push(name);
        inv.domains.push({
          name,
          status: d.state === "active" ? "verified" : "pending",
          createdAt: d.created_at ? String(d.created_at) : undefined,
        });
      }
    } catch (e) {
      inv.notes.push(`Could not read domains: ${msg(e)}`);
    }

    // ---- Templates (per domain → active version body) ----
    let bodiesFetched = 0;
    let cappedHit = false;
    for (const domain of domainNames) {
      try {
        for (const t of unwrapItems(
          await this.get(`/v3/${domain}/templates?limit=1000`),
        )) {
          const tname = String(t.name ?? "");
          if (!tname) continue;
          let html: string | undefined;
          if (bodiesFetched < this.cap) {
            bodiesFetched++;
            try {
              const full = (await this.get(
                `/v3/${domain}/templates/${encodeURIComponent(tname)}?active=yes`,
              )) as { template?: { version?: { template?: unknown } } };
              const body = full.template?.version?.template;
              if (body) html = String(body);
            } catch {
              // version body unavailable — keep the metadata
            }
          } else {
            cappedHit = true;
          }
          const tpl: TemplateItem = { id: `${domain}/${tname}`, name: tname, html };
          inv.templates.push(tpl);
          if (!html && bodiesFetched <= this.cap) {
            inv.notes.push(`Template "${domain}/${tname}" had no active-version body to export.`);
          }
        }
      } catch (e) {
        inv.notes.push(`Could not read templates for ${domain}: ${msg(e)}`);
      }
    }
    if (cappedHit) {
      inv.notes.push(
        `Stopped fetching template bodies after ${this.cap} — re-run with a higher cap to export the rest.`,
      );
    }

    // ---- Mailing lists + members (account-level) ----
    try {
      for (const l of unwrapItems(await this.get("/v3/lists/pages?limit=1000"))) {
        const address = String(l.address ?? "");
        if (!address) continue;
        const contacts: ContactItem[] = [];
        try {
          for (const m of unwrapItems(
            await this.get(`/v3/lists/${address}/members/pages?limit=1000`),
          )) {
            contacts.push({
              email: String(m.address ?? ""),
              firstName: m.name ? String(m.name) : undefined,
              unsubscribed: m.subscribed === false,
            });
          }
        } catch (e) {
          inv.notes.push(`List "${l.name ?? address}" members unreadable: ${msg(e)}`);
        }
        inv.audiences.push({ id: address, name: String(l.name ?? address), contacts });
      }
    } catch (e) {
      inv.notes.push(`Could not read mailing lists: ${msg(e)}`);
    }

    // Mailgun doesn't expose an API-key listing endpoint.
    inv.notes.push("Mailgun API keys aren't listable via API — create fresh keys in ems.");
    inv.notes.push(
      "Mailgun suppressions live per domain at /v3/{domain}/bounces, /unsubscribes, /complaints — review them for ems suppression import.",
    );

    return inv;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
