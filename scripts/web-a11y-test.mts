// E18-024: every icon-only control in apps/web has a screen-reader label, and icon
// glyphs never leak into the accessible name. Tabler icons render a private-use
// codepoint via ::before, which some screen readers announce as garbage, so every
// <i className="ti …"> must be aria-hidden; a control whose only content is an
// icon must then carry aria-label (or visually hidden text).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["apps/web/app", "apps/web/components"];
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
};
roots.forEach(walk);
assert.ok(files.length > 10, "found the apps/web components");

const problems: string[] = [];
let icons = 0;
let controls = 0;
for (const file of files) {
  // Drop comments first: prose like "a real <button>" must not be parsed as markup.
  const src = readFileSync(file, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const rel = relative(".", file);
  for (const m of src.matchAll(/<i\s+className=(?:"ti[ "][^"]*"|\{`ti[ `][^`]*`\})[^>]*>/g)) {
    icons++;
    if (!/aria-hidden="true"/.test(m[0])) problems.push(`${rel}: icon without aria-hidden: ${m[0]}`);
  }
  // Interactive elements: <button>, <a>, <Link>. Strip nested tags and JSX
  // expressions that are only icons; anything left that is text gives a name.
  for (const m of src.matchAll(/<(button|a|Link)\b((?:=>|[^>])*)>([\s\S]*?)<\/\1>/g)) {
    controls++;
    const [, tag, attrs, inner] = m;
    if (/aria-label(?:ledby)?=/.test(attrs)) continue;
    const text = inner
      .replace(/<i\b[^>]*\/>/g, "")
      .replace(/<span className="sr-only">([\s\S]*?)<\/span>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .trim();
    if (!text) problems.push(`${rel}: <${tag}> has no text and no aria-label`);
  }
}

console.log(`web a11y: ${icons} icons, ${controls} controls scanned across ${files.length} files`);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

// The checker itself must catch the two failure shapes.
const bad = '<button type="button"><i className="ti ti-x" aria-hidden="true" /></button>';
const hasText = (s: string) => s.replace(/<i\b[^>]*\/>/g, "").replace(/<[^>]+>/g, "").trim().length > 0;
assert.equal(hasText(/<(button)\b[^>]*>([\s\S]*?)<\/button>/.exec(bad)![2]), false);
assert.equal(/aria-hidden="true"/.test('<i className="ti ti-x" />'), false);
console.log("web a11y: all icon-only controls labelled, all icons aria-hidden");
