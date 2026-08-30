// Postmark → ems source. Read-only: every call is a GET against the
// Postmark API. We never mutate the source account. Postmark uses TWO token
// types that hit different resources: an Account API token (domains) and a
// Server API token (templates) — we accept either/both and build the right
// per-request auth header. Each resource is fetched defensively — a missing
// token or unavailable endpoint adds a note and continues rather than aborting
// the whole migration.
import {
  emptyInventory,
  type Inventory,
  type MigrationSource,
  type TemplateItem,
} from "../types.js";

const POSTMARK_BASE = "https://api.postmarkapp.com";

/** Postmark wraps list responses under a capitalized key (Domains/Templates). */
function unwrapList(body: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const data = (body as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

export interface PostmarkSourceOptions {
  /** Server API token — used for templates (X-Postmark-Server-Token). */
  serverToken?: string;
  /** Account API token — used for domains (X-Postmark-Account-Token). */
  accountToken?: string;
  /** override fetch (tests) */
  fetch?: typeof fetch;
  /** override base url (tests) */
  baseUrl?: string;
  /** ISO timestamp for the inventory; defaults to now. */
  now?: string;
}

export class PostmarkSource implements MigrationSource {
  readonly name = "postmark";
  private readonly serverToken: string | undefined;
  private readonly accountToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly now: string;

  constructor(opts: PostmarkSourceOptions) {
    if (!opts.serverToken && !opts.accountToken) {
      throw new Error(
        "PostmarkSource: at least one of serverToken or accountToken is required.",
      );
    }
    this.serverToken = opts.serverToken;
    this.accountToken = opts.accountToken;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.base = (opts.baseUrl ?? POSTMARK_BASE).replace(/\/$/, "");
    this.now = opts.now ?? new Date().toISOString();
  }

  /** GET with the auth header for the resource being read ("account"|"server"). */
  private async get(path: string, auth: "account" | "server"): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth === "account") {
      headers["X-Postmark-Account-Token"] = this.accountToken ?? "";
    } else {
      headers["X-Postmark-Server-Token"] = this.serverToken ?? "";
    }
    const res = await this.fetchImpl(`${this.base}${path}`, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GET ${path} → ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  async inventory(): Promise<Inventory> {
    const inv = emptyInventory(this.name, this.now);

    // ---- Domains (Account API token — X-Postmark-Account-Token) ----
    if (this.accountToken) {
      try {
        const body = await this.get("/domains?count=500&offset=0", "account");
        for (const d of unwrapList(body, "Domains")) {
          const spf = Boolean(d.SPFVerified);
          const dkim = Boolean(d.DKIMVerified);
          inv.domains.push({
            name: String(d.Name ?? ""),
            status: spf && dkim ? "verified" : "pending",
          });
        }
      } catch (e) {
        inv.notes.push(`Could not read domains: ${msg(e)}`);
      }
    } else {
      inv.notes.push(
        "Postmark domains need an Account API token (X-Postmark-Account-Token).",
      );
    }

    // ---- Templates (Server API token — X-Postmark-Server-Token) ----
    if (this.serverToken) {
      try {
        const list = await this.get("/templates?count=500&offset=0", "server");
        for (const t of unwrapList(list, "Templates")) {
          const id = String(t.TemplateId ?? "");
          let full: Record<string, unknown> = t;
          try {
            const single = (await this.get(
              `/templates/${id}`,
              "server",
            )) as Record<string, unknown>;
            full = single ?? t;
          } catch {
            // list entry may not include the body — keep what we have
          }
          const tpl: TemplateItem = {
            id,
            name: String(full.Name ?? t.Name ?? id),
            subject: full.Subject ? String(full.Subject) : undefined,
            html: full.HtmlBody ? String(full.HtmlBody) : undefined,
            text: full.TextBody ? String(full.TextBody) : undefined,
          };
          inv.templates.push(tpl);
          if (!tpl.html && !tpl.text) {
            inv.notes.push(`Template "${tpl.name}" had no body to export.`);
          }
        }
      } catch (e) {
        inv.notes.push(`Could not read templates: ${msg(e)}`);
      }
    } else {
      inv.notes.push(
        "Postmark templates need a Server API token (X-Postmark-Server-Token).",
      );
    }

    // ---- Audiences (Postmark is transactional-only — no contacts/lists) ----
    inv.notes.push("Postmark has no audiences/contacts (transactional-only).");

    // ---- API keys (Postmark tokens aren't listable via API) ----
    inv.notes.push("Postmark tokens aren't listable via API.");

    // Suppressions aren't part of the inventory model — flag where they live.
    inv.notes.push(
      "Postmark suppressions live at /message-streams/{id}/suppressions/dump (server token).",
    );

    return inv;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
