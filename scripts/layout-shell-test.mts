// Dashboard layout shell (E18-004): theme selection, command-palette model, workspace
// switch validation, and the accessibility contract of the shell components.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  otherTheme,
  resolveTheme,
} from "../apps/web/lib/theme.ts";
import {
  DASH_NAV,
  LEGACY_DASHBOARD_URL,
  buildCommands,
  filterCommands,
  moveActive,
  workspacesFromSession,
} from "../apps/web/lib/dash-nav.ts";
import { checkSwitchRequest } from "../apps/web/lib/workspace-switch.ts";
import { SHORTCUTS, isEditableTarget, resolveShortcut } from "../apps/web/lib/shortcuts.ts";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const web = (p: string) => readFileSync(resolve("apps/web", p), "utf8");

console.log("layout shell (E18-004)");

t("theme: dark unless the user explicitly chose light", () => {
  assert.equal(resolveTheme(null), "dark");
  assert.equal(resolveTheme(undefined), "dark");
  assert.equal(resolveTheme("dark"), "dark");
  assert.equal(resolveTheme("LIGHT"), "dark");
  assert.equal(resolveTheme("light"), "light");
  assert.equal(otherTheme("dark"), "light");
  assert.equal(otherTheme("light"), "dark");
});

t("theme: boot script applies a stored light choice and tolerates storage errors", () => {
  const run = (stored: string | null, throws = false) => {
    const el = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem: (k: string) => {
        if (throws) throw new Error("denied");
        return k === THEME_STORAGE_KEY ? stored : null;
      },
    };
    new Function("localStorage", "document", THEME_BOOT_SCRIPT)(localStorage, { documentElement: el });
    return el.dataset.theme;
  };
  assert.equal(run("light"), "light");
  assert.equal(run("dark"), undefined);
  assert.equal(run(null), undefined);
  assert.equal(run("light", true), undefined);
});

t("theme: tokens.css defines the light palette behind data-theme", () => {
  const tokens = web("app/tokens.css");
  assert.match(tokens, /:root\[data-theme="light"\]\s*\{/);
  assert.match(web("app/layout.tsx"), /THEME_BOOT_SCRIPT/);
  assert.match(web("app/layout.tsx"), /suppressHydrationWarning/);
});

t("theme: shell surfaces use tokens, not hardcoded dark colours", () => {
  const css = web("app/globals.css");
  for (const sel of [".nav {", ".dash-top {", ".btn:hover {"]) {
    const rule = css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    assert.ok(rule.length > 0, `${sel} rule present`);
    assert.doesNotMatch(rule, /rgba\(10, 13, 20|#36405a/, `${sel} must follow the theme`);
  }
});

t("toggle: rendered in the marketing nav and dashboard top bar, exposed as a pressed button", () => {
  const toggle = web("components/ThemeToggle.tsx");
  assert.match(toggle, /aria-pressed=\{light\}/);
  assert.match(toggle, /aria-label="Light theme"/);
  assert.match(web("components/SiteNav.tsx"), /<ThemeToggle \/>/);
  assert.match(web("app/dashboard/layout.tsx"), /<ThemeToggle \/>/);
});

const workspaces = workspacesFromSession({
  memberships: [
    { orgId: "org_a", role: "owner", name: "Acme" },
    { orgId: "org_b", role: "member", name: "  " },
  ],
});

t("nav: unique ids, Overview is the only ready section today", () => {
  assert.equal(new Set(DASH_NAV.map((n) => n.id)).size, DASH_NAV.length);
  assert.deepEqual(DASH_NAV.filter((n) => n.ready).map((n) => n.id), ["overview"]);
  assert.equal(workspaces[1].name, "Workspace org_b");
});

t("palette: commands cover navigation, other workspaces, and the theme", () => {
  const cmds = buildCommands({ workspaces, activeOrgId: "org_a", theme: "dark" });
  const ids = cmds.map((c) => c.id);
  assert.ok(ids.includes("nav:overview"));
  assert.ok(!ids.includes("nav:domains"), "unported sections are not offered");
  assert.ok(ids.includes("ws:org_b"));
  assert.ok(!ids.includes("ws:org_a"), "the active workspace is not offered");
  const legacy = cmds.find((c) => c.id === "nav:legacy");
  assert.ok(legacy && legacy.kind === "href" && legacy.href === LEGACY_DASHBOARD_URL);
  assert.equal(cmds.find((c) => c.id === "theme")?.label, "Switch to light theme");
  assert.equal(
    buildCommands({ workspaces, activeOrgId: "org_a", theme: "light" }).find((c) => c.id === "theme")?.label,
    "Switch to dark theme",
  );
});

t("palette: filter matches every word case-insensitively, prefix first", () => {
  const cmds = buildCommands({ workspaces, activeOrgId: "org_a", theme: "dark" });
  assert.equal(filterCommands(cmds, "").length, cmds.length);
  assert.deepEqual(filterCommands(cmds, "  THEME light ").map((c) => c.id), ["theme"]);
  assert.deepEqual(filterCommands(cmds, "zzz"), []);
  const sw = filterCommands(cmds, "switch to").map((c) => c.id);
  assert.deepEqual(sw, ["ws:org_b", "theme"]);
  const go = filterCommands(cmds, "dashboard").map((c) => c.id);
  assert.deepEqual(go, ["nav:legacy"]);
});

t("palette: arrow keys wrap, Home/End jump, other keys hold", () => {
  assert.equal(moveActive("ArrowDown", 0, 3), 1);
  assert.equal(moveActive("ArrowDown", 2, 3), 0);
  assert.equal(moveActive("ArrowUp", 0, 3), 2);
  assert.equal(moveActive("Home", 2, 3), 0);
  assert.equal(moveActive("End", 0, 3), 2);
  assert.equal(moveActive("a", 1, 3), 1);
  assert.equal(moveActive("ArrowDown", 0, 0), -1);
});

t("palette: dialog/combobox/listbox semantics and Cmd/Ctrl+K", () => {
  const src = web("components/CommandPalette.tsx");
  for (const needle of [
    'role="dialog"',
    'aria-modal="true"',
    'role="combobox"',
    'role="listbox"',
    'role="option"',
    "aria-activedescendant",
    "aria-selected",
    "e.metaKey || e.ctrlKey",
    'e.key === "Escape"',
    "returnFocus.current?.focus",
  ]) {
    assert.ok(src.includes(needle), `CommandPalette has ${needle}`);
  }
});

t("sidebar: labelled nav, aria-current on the page, unported sections disabled", () => {
  const src = web("components/DashNav.tsx");
  assert.match(src, /aria-label="Dashboard"/);
  assert.match(src, /aria-current=\{current \? "page" : undefined\}/);
  assert.match(src, /aria-disabled="true"/);
  assert.match(web("app/dashboard/layout.tsx"), /skip-link/);
});

const same = { origin: "https://electronicmailservices.com", host: "electronicmailservices.com", hasSession: true };

t("workspace switch: forwards a same-origin, signed-in request with a valid org id", () => {
  assert.deepEqual(checkSwitchRequest({ ...same, body: { orgId: "cm1abc_DEF-9" } }), { ok: true, orgId: "cm1abc_DEF-9" });
});

t("workspace switch: refuses signed-out, cross-origin and malformed requests", () => {
  const st = (input: Parameters<typeof checkSwitchRequest>[0]) => {
    const r = checkSwitchRequest(input);
    return r.ok ? 200 : r.status;
  };
  assert.equal(st({ ...same, hasSession: false, body: { orgId: "a" } }), 401);
  assert.equal(st({ ...same, origin: "https://evil.example", body: { orgId: "a" } }), 403);
  assert.equal(st({ ...same, origin: null, body: { orgId: "a" } }), 403);
  assert.equal(st({ ...same, origin: "not a url", body: { orgId: "a" } }), 403);
  assert.equal(st({ ...same, host: null, body: { orgId: "a" } }), 403);
  assert.equal(st({ ...same, body: null }), 400);
  assert.equal(st({ ...same, body: { orgId: 42 } }), 400);
  assert.equal(st({ ...same, body: { orgId: "" } }), 400);
  assert.equal(st({ ...same, body: { orgId: "../admin" } }), 400);
  assert.equal(st({ ...same, body: { orgId: "x".repeat(65) } }), 400);
});

t("workspace switch: route forwards cookies to the API and relays Set-Cookie", () => {
  const src = web("app/api/workspace/switch/route.ts");
  assert.match(src, /\/app\/subaccounts\/switch/);
  assert.match(src, /getSetCookie\(\)/);
  assert.match(src, /checkSwitchRequest/);
});

console.log("keyboard shortcuts (E18-006)");

t("shortcuts: single keys, the g-o sequence, and nothing while typing or with modifiers", () => {
  assert.deepEqual(resolveShortcut({ key: "?" }, null), { action: "help", pending: null });
  assert.deepEqual(resolveShortcut({ key: "/" }, null), { action: "palette", pending: null });
  assert.deepEqual(resolveShortcut({ key: "T" }, null), { action: "theme", pending: null });
  assert.deepEqual(resolveShortcut({ key: "g" }, null), { action: null, pending: "g" });
  assert.deepEqual(resolveShortcut({ key: "o" }, "g"), { action: "go-overview", pending: null });
  assert.deepEqual(resolveShortcut({ key: "x" }, "g"), { action: null, pending: null });
  assert.deepEqual(resolveShortcut({ key: "o" }, null), { action: null, pending: null });
  assert.deepEqual(resolveShortcut({ key: "t", editable: true }, null), { action: null, pending: null });
  assert.deepEqual(resolveShortcut({ key: "t", ctrlKey: true }, null), { action: null, pending: null });
  assert.deepEqual(resolveShortcut({ key: "t", metaKey: true }, null), { action: null, pending: null });
});

t("shortcuts: text fields and contenteditable count as typing; buttons and checkboxes don't", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isEditableTarget({ tagName: "input" }), true);
  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isEditableTarget({ tagName: "BUTTON" }), false);
  assert.equal(isEditableTarget(null), false);
});

t("shortcuts: every action in the help sheet is reachable by a key the handler resolves", () => {
  const reachable = new Set(
    [["?"], ["/"], ["t"], ["g", "o"]].map((seq) => {
      let pending: string | null = null;
      let action = null;
      for (const key of seq) ({ action, pending } = resolveShortcut({ key }, pending));
      return action;
    }),
  );
  for (const s of SHORTCUTS) assert.ok(reachable.has(s.action), `${s.label} is wired`);
  const cmds = buildCommands({ workspaces, activeOrgId: "org_a", theme: "dark" });
  assert.ok(cmds.some((c) => c.kind === "shortcuts"), "the palette offers the help sheet");
  const src = web("components/KeyboardShortcuts.tsx");
  for (const needle of ['role="dialog"', 'aria-modal="true"', "aria-labelledby", 'aria-label="Keyboard shortcuts"', "SHORTCUTS.map"]) {
    assert.ok(src.includes(needle), `KeyboardShortcuts has ${needle}`);
  }
  assert.match(web("app/dashboard/layout.tsx"), /<KeyboardShortcuts \/>/);
});

console.log(`layout-shell-test: ${passed} passed`);
