// Resend → ems source. Read-only: every call is a GET against the Resend
// API with the user's key. We never mutate the Resend account. Each resource is
// fetched defensively — a missing scope or unavailable endpoint adds a note and
// continues rather than aborting the whole migration.
import {
  emptyInventory,
  type Inventory,
  type MigrationSource,
  type ContactItem,
  type TemplateItem,
} from "../types.js";

const RESEND_BASE = "https://api.resend.com";

/** Resend wraps list responses as `{ data: [...] }`; singles are bare objects. */
function unwrapList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const data = (body as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

export interface ResendSourceOptions {
  apiKey: string;
  /** override fetch (tests) */
  fetch?: typeof fetch;
  /** override base url (tests) */
  baseUrl?: string;
  /** ISO timestamp for the inventory; defaults to now. */
  now?: string;
}

export class ResendSource implements MigrationSource {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly now: string;

  constructor(opts: ResendSourceOptions) {
    if (!opts.apiKey) throw new Error("ResendSource: apiKey is required.");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.base = (opts.baseUrl ?? RESEND_BASE).replace(/\/$/, "");
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

    // ---- Domains (the core migratable resource) ----
    try {
      for (const d of unwrapList(await this.get("/domains"))) {
        inv.domains.push({
          name: String(d.name ?? ""),
          status: String(d.status ?? "unknown"),
          region: d.region ? String(d.region) : undefined,
          createdAt: d.created_at ? String(d.created_at) : undefined,
        });
      }
    } catch (e) {
      inv.notes.push(`Could not read domains: ${msg(e)}`);
    }

    // ---- API keys (names only — secrets are never exposed by any ESP) ----
    try {
      for (const k of unwrapList(await this.get("/api-keys"))) {
        inv.apiKeys.push({
          id: String(k.id ?? ""),
          name: String(k.name ?? "unnamed"),
          createdAt: k.created_at ? String(k.created_at) : undefined,
        });
      }
    } catch (e) {
      inv.notes.push(`Could not read API keys: ${msg(e)}`);
    }

    // ---- Audiences + their contacts (exported to CSV; no native store yet) ----
    try {
      for (const a of unwrapList(await this.get("/audiences"))) {
        const id = String(a.id ?? "");
        const contacts: ContactItem[] = [];
        try {
          for (const c of unwrapList(await this.get(`/audiences/${id}/contacts`))) {
            contacts.push({
              email: String(c.email ?? ""),
              firstName: c.first_name ? String(c.first_name) : undefined,
              lastName: c.last_name ? String(c.last_name) : undefined,
              unsubscribed: Boolean(c.unsubscribed),
            });
          }
        } catch (e) {
          inv.notes.push(`Audience "${a.name ?? id}" contacts unreadable: ${msg(e)}`);
        }
        inv.audiences.push({ id, name: String(a.name ?? id), contacts });
      }
    } catch (e) {
      inv.notes.push(`Could not read audiences: ${msg(e)}`);
    }

    // ---- Broadcasts → templates (HTML exported for reuse in your code) ----
    try {
      for (const b of unwrapList(await this.get("/broadcasts"))) {
        const id = String(b.id ?? "");
        let full: Record<string, unknown> = b;
        try {
          const single = (await this.get(`/broadcasts/${id}`)) as Record<string, unknown>;
          full = (single?.data as Record<string, unknown>) ?? single ?? b;
        } catch {
          // list entry may not include the body — keep what we have
        }
        const t: TemplateItem = {
          id,
          name: String(full.name ?? b.name ?? id),
          subject: full.subject ? String(full.subject) : undefined,
          from: full.from ? String(full.from) : undefined,
          html: full.html ? String(full.html) : undefined,
          text: full.text ? String(full.text) : undefined,
        };
        inv.templates.push(t);
        if (!t.html && !t.text) {
          inv.notes.push(`Broadcast "${t.name}" had no inline body to export.`);
        }
      }
    } catch (e) {
      inv.notes.push(`Could not read broadcasts/templates: ${msg(e)}`);
    }

    // Webhooks aren't exposed by Resend's public API — flag for manual recreation.
    inv.notes.push(
      "Webhooks can't be exported via Resend's API — recreate your endpoints in the ems dashboard (Webhooks).",
    );

    return inv;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
