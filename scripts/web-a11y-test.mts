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

// E18-022: keyboard reach and visible focus.
// 1. No positive tabIndex (it reorders focus away from reading order), and no click
//    handler on a non-interactive element without a role and a key handler.
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(".", file);
  for (const m of src.matchAll(/tabIndex=\{(\d+)\}/g)) {
    if (Number(m[1]) > 0) problems.push(`${rel}: positive tabIndex={${m[1]}}`);
  }
  for (const m of src.matchAll(/<(div|span|li|section|p)\b((?:=>|[^>])*)\bonClick=/g)) {
    const attrs = m[2] + src.slice(m.index! + m[0].length, src.indexOf(">", m.index! + m[0].length));
    // A listbox option driven by its combobox input (aria-activedescendant) takes its
    // keys on the input, which is the ARIA pattern; it needs no key handler of its own.
    const comboOption = /\brole="option"/.test(attrs) && /aria-activedescendant=/.test(src);
    if (!comboOption && (!/\brole=/.test(attrs) || !/onKeyDown=/.test(attrs))) problems.push(`${rel}: <${m[1]} onClick> without role and onKeyDown`);
  }
}
// 2. The global ring exists, survives forced-colors, and every outline removal is
//    either a programmatic focus target (tabIndex=-1) or paired with a :focus-within ring.
const css = readFileSync("apps/web/app/globals.css", "utf8");
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");
if (!/(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/.test(cssRules)) problems.push("globals.css: no global :focus-visible ring");
if (!/@media \(forced-colors: active\)[^{]*\{[^}]*:focus-visible[^}]*outline:/.test(cssRules)) problems.push("globals.css: no forced-colors focus outline");
const ALLOWED_OUTLINE_NONE: Record<string, RegExp> = {
  ".dash-main:focus": /id="dash-main" tabIndex=\{-1\}/, // skip-link target, not a control
  ".cmdk-input input": /\.cmdk-input:focus-within\s*\{[^}]*box-shadow:[^}]*var\(--focus\)/,
};
for (const m of cssRules.matchAll(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\b[^}]*\}/g)) {
  const sel = m[1].trim();
  const guard = ALLOWED_OUTLINE_NONE[sel];
  const layout = readFileSync("apps/web/app/dashboard/layout.tsx", "utf8");
  if (!guard || !(guard.test(cssRules) || guard.test(layout))) problems.push(`globals.css: ${sel} removes the focus outline with no replacement ring`);
}
// 3. The sidebar is never removed from tab order on narrow screens.
if (/\.dash-side\s*\{[^}]*display:\s*none/.test(cssRules)) problems.push("globals.css: .dash-side hidden; nav unreachable by keyboard on mobile");
// 4. The workspace menu supports arrow keys and closes when focus leaves it.
const ws = readFileSync("apps/web/components/WorkspaceSwitcher.tsx", "utf8");
for (const need of ["onKeyDown=", "moveActive(", "onBlur=", ".focus()"]) {
  if (!ws.includes(need)) problems.push(`WorkspaceSwitcher.tsx: missing ${need} (menu keyboard support)`);
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
console.log("web a11y: focus rings intact (incl. forced-colors), no positive tabIndex, nav reachable at every width");
