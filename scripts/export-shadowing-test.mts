/**
 * Star-export shadowing guard (E01-037).
 *
 * TypeScript does NOT error when a package's index.ts re-declares a name that a
 * star-exported module also exports — the local declaration silently wins and
 * consumers resolve the poorer type. It has bitten @ems/policy and @ems/verify
 * already, so it is now a build gate rather than a thing to remember.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const EXPORTED = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|class|function|const|let|enum)\s+([A-Za-z0-9_$]+)/gm;
const STAR = /^export\s+\*\s+from\s+["']\.\/([A-Za-z0-9_.-]+)\.js["']/gm;

for (const pkg of readdirSync("packages")) {
  const indexPath = join("packages", pkg, "src", "index.ts");
  if (!existsSync(indexPath)) continue;
  const index = readFileSync(indexPath, "utf8");

  const localNames = new Set<string>();
  for (const m of index.matchAll(EXPORTED)) if (m[1]) localNames.add(m[1]);

  const collisions: string[] = [];
  for (const s of index.matchAll(STAR)) {
    const mod = join("packages", pkg, "src", `${s[1]}.ts`);
    if (!existsSync(mod)) continue;
    const src = readFileSync(mod, "utf8");
    for (const m of src.matchAll(EXPORTED)) {
      if (m[1] && localNames.has(m[1])) collisions.push(`${m[1]} (./${s[1]}.ts)`);
    }
  }
  ok(`@ems/${pkg} index.ts shadows nothing it star-exports`, collisions.length === 0, collisions.join(", "));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
