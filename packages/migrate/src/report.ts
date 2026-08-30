// Turn an Inventory into an on-disk migration kit:
//   <outDir>/report.md           — the plan, checklist, and code-swap snippet
//   <outDir>/templates/*.html     — each broadcast/template body, ready to reuse
//   <outDir>/audiences/*.csv      — each contact list (email,first,last,unsub)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Inventory } from "./types.js";

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
      const rows = [
        "email,first_name,last_name,unsubscribed",
        ...a.contacts.map((c) =>
          [c.email, c.firstName, c.lastName, c.unsubscribed].map(csvCell).join(","),
        ),
      ].join("\n");
      const p = join(dir, `${slug(a.name)}.csv`);
      await writeFile(p, rows + "\n", "utf8");
      files.push(p);
    }
  }

  // ---- report.md ----
  const reportPath = join(outDir, "report.md");
  await writeFile(reportPath, renderReport(inv, withBody.length), "utf8");
  files.unshift(reportPath);

  return { reportPath, files };
}

function renderReport(inv: Inventory, templatesExported: number): string {
  const totalContacts = inv.audiences.reduce((n, a) => n + a.contacts.length, 0);
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
  L.push("");

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
  L.push("- [ ] Add + verify each domain in ems (publish the new DKIM/SPF/DMARC records)");
  L.push("- [ ] Create ems API keys and update your environment");
  L.push("- [ ] Swap the import (above) and deploy to a staging/canary first");
  L.push("- [ ] Recreate webhook endpoints in the ems dashboard");
  L.push("- [ ] Import `audiences/*.csv` once ems audiences ship (transactional-first today)");
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
