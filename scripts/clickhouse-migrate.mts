/**
 * ClickHouse migration runner. Plain SQL files, forward-only, checksummed.
 * Backlog: E02-038.
 *
 *   pnpm ch:migrate            apply pending migrations
 *   pnpm ch:migrate --status   show what is applied and what is pending
 *   pnpm ch:migrate --check    exit 1 if anything is pending (for CI)
 *
 * A checksum mismatch on an already-applied file is a hard error: editing an
 * applied migration silently diverges environments, so we refuse rather than
 * guess. Write a new file instead.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "packages/db/clickhouse/migrations";
const URL_ = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";
const DB = process.env.CLICKHOUSE_DB ?? "ems";
const USER = process.env.CLICKHOUSE_USER ?? "ems";
const PASS = process.env.CLICKHOUSE_PASSWORD ?? "ems";

async function q(sql: string, useDb = true): Promise<string> {
  const url = new URL(URL_);
  if (useDb) url.searchParams.set("database", DB);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": USER,
      "X-ClickHouse-Key": PASS,
      "Content-Type": "text/plain",
    },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${text.trim()}`);
  return text;
}

/**
 * Split on semicolons that end a statement. ClickHouse's HTTP interface takes
 * one statement per request, and a MATERIALIZED VIEW body contains no bare
 * semicolons, so this is sufficient for our migrations.
 */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

function checksum(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

async function main() {
  const args = process.argv.slice(2);
  const status = args.includes("--status");
  const check = args.includes("--check");

  await q(`CREATE DATABASE IF NOT EXISTS ${DB}`, false);
  await q(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name String, checksum String, applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY name
  `);

  const appliedRaw = await q("SELECT name, checksum FROM schema_migrations FORMAT TSV");
  const applied = new Map<string, string>(
    appliedRaw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", sum = ""] = line.split("\t");
        return [name, sum] as [string, string];
      }),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const pending: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const sum = checksum(sql);
    const prev = applied.get(file);

    if (prev === undefined) {
      pending.push(file);
      continue;
    }
    if (prev !== sum) {
      console.error(
        `\n  CHECKSUM MISMATCH: ${file}\n` +
          `  applied ${prev}, on disk ${sum}\n\n` +
          `  An applied migration was edited. That silently diverges environments.\n` +
          `  Write a new migration file instead of changing this one.\n`,
      );
      process.exit(1);
    }
  }

  if (status || check) {
    for (const f of files) {
      console.log(`  ${applied.has(f) ? "[x]" : "[ ]"} ${f}`);
    }
    console.log(`\n  ${applied.size} applied · ${pending.length} pending`);
    process.exit(check && pending.length > 0 ? 1 : 0);
  }

  if (pending.length === 0) {
    console.log("  clickhouse: up to date");
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(DIR, file), "utf8");
    process.stdout.write(`  applying ${file} ... `);
    for (const stmt of statements(sql)) {
      await q(stmt);
    }
    await q(
      `INSERT INTO schema_migrations (name, checksum) VALUES ('${file}', '${checksum(sql)}')`,
    );
    console.log("ok");
  }
  console.log(`\n  clickhouse: ${pending.length} migration(s) applied`);
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
