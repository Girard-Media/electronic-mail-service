// E18-002/003: the design tokens exist in one place, both palettes define the
// same colour tokens, and every text/surface pair meets the documented WCAG AA
// contrast floor. Parses apps/web/app/tokens.css directly so the test cannot
// drift from what the browser actually loads.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "apps/web/app/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const globals = readFileSync(join(root, "apps/web/app/globals.css"), "utf8");

export function block(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return new Map();
  const body = source.slice(start + selector.length + 2, source.indexOf("}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Self-check the maths against known WCAG reference values.
ok("contrast maths: black on white is 21:1", Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
ok("contrast maths: #767676 on white is 4.54:1", Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.01);

const dark = block(css, ":root");
const light = block(css, ':root[data-theme="light"]');
const HEX = /^#[0-9a-f]{6}$/i;
const SURFACES = ["--bg", "--bg2", "--surface", "--surface2"];
const TEXT = ["--tx", "--tx2", "--tx3", "--brand2", "--ok", "--warn", "--danger"];
const isColour = (v: string) => HEX.test(v) || v.startsWith("rgba(");

ok("dark palette is on :root", dark.size > 0);
ok("light palette is on :root[data-theme=light]", light.size > 0);
ok("dark sets color-scheme: dark", /:root\s*{[^}]*color-scheme:\s*dark/.test(css));
ok("light sets color-scheme: light", /data-theme="light"\]\s*{[^}]*color-scheme:\s*light/.test(css));

const darkColours = [...dark].filter(([, v]) => isColour(v)).map(([k]) => k).sort();
const lightColours = [...light].filter(([, v]) => isColour(v)).map(([k]) => k).sort();
ok("both palettes define the same colour tokens", JSON.stringify(darkColours) === JSON.stringify(lightColours),
  `dark-only: ${darkColours.filter((k) => !light.has(k)).join(",") || "-"}; light-only: ${lightColours.filter((k) => !dark.has(k)).join(",") || "-"}`);

for (const [name, palette] of [["dark", dark], ["light", light]] as const) {
  for (const key of [...SURFACES, ...TEXT, "--brand", "--brand-hover", "--on-brand", "--focus"]) {
    ok(`${name}: ${key} is a 6-digit hex`, HEX.test(palette.get(key) ?? ""), palette.get(key));
  }
  for (const t of TEXT) {
    const worst = Math.min(...SURFACES.map((s) => contrast(palette.get(t)!, palette.get(s)!)));
    ok(`${name}: ${t} ≥ 4.5:1 on every surface`, worst >= 4.5, worst.toFixed(2));
  }
  for (const fill of ["--brand", "--brand-hover"]) {
    const ratio = contrast(palette.get("--on-brand")!, palette.get(fill)!);
    ok(`${name}: --on-brand ≥ 4.5:1 on ${fill}`, ratio >= 4.5, ratio.toFixed(2));
  }
  const focus = Math.min(...SURFACES.map((s) => contrast(palette.get("--focus")!, palette.get(s)!)));
  ok(`${name}: --focus ≥ 3:1 on every surface`, focus >= 3, focus.toFixed(2));
}

for (const group of ["--font-sans", "--font-mono", "--fs-base", "--lh-body", "--sp-4", "--radius-md", "--elev-2"]) {
  ok(`scale token ${group} defined`, dark.has(group) || light.has(group));
}
for (const name of ["--r", "--rl", "--rxl", "--max"]) ok(`legacy token ${name} still defined`, dark.has(name));

ok("globals.css imports tokens.css", /@import\s+"\.\/tokens\.css";/.test(globals));
ok("globals.css no longer declares its own :root palette", !/:root\s*{/.test(globals));
ok("filled buttons use the token pair the floor covers",
  /\.btn\.pri\s*{[^}]*color:\s*var\(--on-brand\)/.test(globals) && /\.btn\.pri:hover\s*{[^}]*var\(--brand-hover\)/.test(globals));

// apps/api/public/site.css is the Hono-served dashboard/marketing palette (still
// primary until the Next port reaches parity). It keeps its own compact :root,
// so hold its text tokens to the same 4.5:1 floor on its own surfaces.
const site = readFileSync(join(root, "apps/api/public/site.css"), "utf8");
const siteRoot = new Map<string, string>();
const siteBody = /:root\s*{([^}]*)}/.exec(site)?.[1] ?? "";
for (const m of siteBody.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) siteRoot.set(m[1], m[2].trim());
for (const t of ["--tx", "--tx2", "--tx3", "--brand2", "--ok", "--warn"]) {
  const worst = Math.min(...SURFACES.map((s) => contrast(siteRoot.get(t)!, siteRoot.get(s)!)));
  ok(`site.css: ${t} ≥ 4.5:1 on every surface`, worst >= 4.5, worst.toFixed(2));
}

if (fail) {
  console.error(`\n${fail} design-token check(s) failed`);
  process.exit(1);
}
console.log("\ndesign tokens: all checks passed");
