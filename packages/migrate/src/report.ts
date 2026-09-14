// Turn an Inventory into an on-disk migration kit:
//   <outDir>/report.md           — the plan, checklist, and code-swap snippet
//   <outDir>/templates/*.html     — each broadcast/template body, ready to reuse
//   <outDir>/audiences/*.csv      — each contact list (email,first,last,unsub)
//   <outDir>/lead-lists/*.csv     — each outreach lead list (same shape)
//   <outDir>/suppressions.csv     — every suppressed address (import FIRST — I1)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContactItem, Inventory } from "./types.js";

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

function csvCell(v: string | boolean | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function contactsCsv(contacts: ContactItem[]): string {
  return [
    "email,first_name,last_name,unsubscribed",
    ...contacts.map((c) => [c.email, c.firstName, c.lastName, c.unsubscribed].map(csvCell).join(",")),
  ].join("\n");
}

export interface WriteResult {
  reportPath: string;
  files: string[];
}

export async function writeMigrationKit(inv: Inventory, outDir: string): Promise<WriteResult> {
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];

  // ---- Templates ----
  const withBody = inv.templates.filter((t) => t.html || t.text);
  if (withBody.length) {
    const dir = join(outDir, "templates");
    await mkdir(dir, { recursive: true });
    const seen = new Map<string, number>();
    for (const t of withBody) {
      let base = slug(t.name);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      if (n > 1) base = `${base}-${n}`;
      if (t.html) {
        const p = join(dir, `${base}.html`);
        await writeFile(p, t.html, "utf8");
        files.push(p);
      }
      if (t.text) {
        const p = join(dir, `${base}.txt`);
        await writeFile(p, t.text, "utf8");
        files.push(p);
      }
    }
  }

  // ---- Audiences → CSV ----
  if (inv.audiences.length) {
    const dir = join(outDir, "audiences");
    await mkdir(dir, { recursive: true });
    for (const a of inv.audiences) {
      const p = join(dir, `${slug(a.name)}.csv`);
      await writeFile(p, contactsCsv(a.contacts) + "\n", "utf8");
      files.push(p);
    }
  }

  // ---- Outreach lead lists → CSV (same shape as audiences) ----
  if (inv.leadLists.length) {
    const dir = join(outDir, "lead-lists");
    await mkdir(dir, { recursive: true });
    for (const l of inv.leadLists) {
      const p = join(dir, `${slug(l.name)}.csv`);
      await writeFile(p, contactsCsv(l.contacts) + "\n", "utf8");
      files.push(p);
    }
  }

  // ---- Suppressions → one CSV (import FIRST — I1: no unsuppressed send) ----
  if (inv.suppressions.length) {
    const rows = [
      "email,reason",
      ...inv.suppressions.map((s) => [s.email, s.reason].map(csvCell).join(",")),
    ].join("\n");
    const p = join(outDir, "suppressions.csv");
    await writeFile(p, rows + "\n", "utf8");
    files.push(p);
  }

  // ---- report.md ----
  const reportPath = join(outDir, "report.md");
  await writeFile(reportPath, renderReport(inv, withBody.length), "utf8");
  files.unshift(reportPath);

  return { reportPath, files };
}

function renderReport(inv: Inventory, templatesExported: number): string {
  const totalContacts =
    inv.audiences.reduce((n, a) => n + a.contacts.length, 0) +
    inv.leadLists.reduce((n, l) => n + l.contacts.length, 0);
  const L: string[] = [];
  L.push(`# Migrating from ${cap(inv.source)} → ems`);
  L.push("");
  L.push(`Captured ${inv.fetchedAt} (read-only — your ${cap(inv.source)} account was not modified).`);
  L.push("");
  L.push("## What we found");
  L.push("");
  L.push("| Resource | Count | Migrates to ems as |");
  L.push("| --- | --- | --- |");
  L.push(`| Domains | ${inv.domains.length} | Re-verify in ems (new DKIM) |`);
  L.push(`| Audiences | ${inv.audiences.length} (${totalContacts} contacts) | Exported to \`audiences/*.csv\` |`);
  L.push(`| Templates/broadcasts | ${inv.templates.length} (${templatesExported} with a body) | Exported to \`templates/*.html\` |`);
  L.push(`| API keys | ${inv.apiKeys.length} | Create fresh keys in ems |`);
  L.push(`| Campaigns | ${inv.campaigns.length} | Recreate as EMS sequences (steps below) |`);
  L.push(`| Lead lists | ${inv.leadLists.length} | Exported to \`lead-lists/*.csv\` |`);
  L.push(`| Mailboxes | ${inv.mailboxes.length} | Re-provision in ems (credentials never export) |`);
  L.push(`| Suppressions | ${inv.suppressions.length} | \`suppressions.csv\` — import FIRST (I1) |`);
  L.push("");

  if (inv.suppressions.length) {
    L.push("> **Import `suppressions.csv` before anything else.** I1 (no unsuppressed");
    L.push("> send) means a single launch to a stale list is a Sev-1. Suppression first,");
    L.push("> warmup second, volume last.");
    L.push("");
  }

  if (inv.campaigns.length) {
    L.push("## Campaigns → EMS sequences");
    L.push("");
    for (const c of inv.campaigns) {
      L.push(`- **${c.name}** — source status: \`${c.status}\` · ${c.steps.length} step(s)`);
      for (const s of c.steps.sort((a, b) => a.position - b.position)) {
        L.push(
          `  - Step ${s.position}${s.delay ? ` (after ${s.delay})` : ""}` +
            `${s.subject ? `: ${s.subject}` : ""}${s.hasVariant ? " [has variants]" : ""}`,
        );
      }
      if (c.mailboxes.length) L.push(`  - Mailboxes: ${c.mailboxes.join(", ")}`);
    }
    L.push("");
  }

  if (inv.mailboxes.length) {
    L.push("## Mailboxes (re-provision — passwords/OAuth do not migrate)");
    L.push("");
    for (const m of inv.mailboxes) {
      L.push(`- **${m.email}** — \`${m.status}\`${m.dailyCap ? ` · cap ${m.dailyCap}/day` : ""}`);
    }
    L.push("");
    L.push(
      "Create each mailbox on an EMS domain, then warm it on its own curve before",
    );
    L.push("attaching it to a campaign. Never move a warmup pool across clients (D4).");
    L.push("");
  }

  if (inv.domains.length) {
    L.push("## Domains");
    L.push("");
    for (const d of inv.domains) {
      L.push(`- **${d.name}** — ${inv.source} status: \`${d.status}\`${d.region ? ` · region ${d.region}` : ""}`);
    }
    L.push("");
    L.push(
      "> DNS records differ between providers — ems signs with its own DKIM, so you can't copy " +
        "the old records. Add each domain in the ems dashboard to get **your** records, publish " +
        "them, then flip sending. Keep both providers live until ems shows **verified**.",
    );
    L.push("");
  }

  if (inv.apiKeys.length) {
    L.push("## API keys (names only — secrets are never exportable)");
    L.push("");
    for (const k of inv.apiKeys) L.push(`- ${k.name}${k.createdAt ? ` (created ${k.createdAt})` : ""}`);
    L.push("");
    L.push("Recreate the equivalents in ems → **API keys**, then update your env/secrets.");
    L.push("");
  }

  L.push("## Switch your code (the seamless part)");
  L.push("");
  L.push("ems speaks Resend's wire format, so it's a one-line change:");
  L.push("");
  L.push("```diff");
  L.push("- import { Resend } from \"resend\";");
  L.push("+ import { Resend } from \"ems/compat\";");
  L.push("");
  L.push("  const resend = new Resend(process.env.EMS_API_KEY);");
  L.push("  await resend.emails.send({ from, to, subject, html });");
  L.push("```");
  L.push("");
  L.push("Prefer the native client? `import { EMS } from \"ems\"` — same methods, no envelope.");
  L.push("");

  L.push("## Checklist");
  L.push("");
  L.push("- [ ] Import `suppressions.csv` FIRST (I1 — before any send)");
  L.push("- [ ] Add + verify each domain in ems (publish the new DKIM/SPF/DMARC records)");
  L.push("- [ ] Provision mailboxes on EMS domains and warm each on its own curve");
  L.push("- [ ] Import `lead-lists/*.csv` / `audiences/*.csv` via EMS lead import");
  L.push("- [ ] Recreate each campaign as an EMS sequence (steps above), attach the mailbox pool");
  L.push("- [ ] Create ems API keys and update your environment");
  L.push("- [ ] Swap the import (above) and deploy to a staging/canary first");
  L.push("- [ ] Recreate webhook endpoints in the ems dashboard");
  L.push("- [ ] Reuse `templates/*.html` in your code / templates");
  L.push("- [ ] Run a canary send, confirm delivery, then cut over 100%");
  L.push("");

  if (inv.notes.length) {
    L.push("## Notes");
    L.push("");
    for (const n of inv.notes) L.push(`- ${n}`);
    L.push("");
  }
  return L.join("\n");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
