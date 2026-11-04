// Dashboard shell navigation and command-palette model (E18-004). Pure data and
// functions so the shell's behaviour is testable without a browser.

// The Hono dashboard stays primary until each view is ported (see next.config.ts).
export const LEGACY_DASHBOARD_URL = "https://app.electronicmailservices.com/dashboard";

export type NavItem = { id: string; href: string; label: string; icon: string; ready: boolean };

// `ready: false` items are not links yet: they render as disabled entries so the
// shell shows the final information architecture without dead-end navigation.
export const DASH_NAV: NavItem[] = [
  { id: "overview", href: "/dashboard", label: "Overview", icon: "ti-layout-dashboard", ready: true },
  { id: "domains", href: "/dashboard/domains", label: "Domains", icon: "ti-world", ready: false },
  { id: "logs", href: "/dashboard/logs", label: "Logs", icon: "ti-list-search", ready: false },
  { id: "keys", href: "/dashboard/keys", label: "API keys", icon: "ti-key", ready: false },
  { id: "team", href: "/dashboard/team", label: "Team", icon: "ti-users", ready: false },
  { id: "billing", href: "/dashboard/billing", label: "Billing", icon: "ti-credit-card", ready: false },
];

export type Workspace = { orgId: string; name: string; role: string };

export type Command =
  | { id: string; group: "Navigate"; label: string; icon: string; kind: "href"; href: string }
  | { id: string; group: "Workspace"; label: string; icon: string; kind: "switch"; orgId: string }
  | { id: string; group: "Preferences"; label: string; icon: string; kind: "theme" };

export function buildCommands(opts: {
  workspaces: Workspace[];
  activeOrgId: string | null;
  theme: "light" | "dark";
}): Command[] {
  const cmds: Command[] = [];
  for (const item of DASH_NAV) {
    if (!item.ready) continue;
    cmds.push({ id: `nav:${item.id}`, group: "Navigate", label: `Go to ${item.label}`, icon: item.icon, kind: "href", href: item.href });
  }
  cmds.push({
    id: "nav:legacy",
    group: "Navigate",
    label: "Open the full dashboard (domains, logs, keys, team, billing)",
    icon: "ti-external-link",
    kind: "href",
    href: LEGACY_DASHBOARD_URL,
  });
  for (const ws of opts.workspaces) {
    if (ws.orgId === opts.activeOrgId) continue;
    cmds.push({ id: `ws:${ws.orgId}`, group: "Workspace", label: `Switch to ${ws.name}`, icon: "ti-building", kind: "switch", orgId: ws.orgId });
  }
  cmds.push({
    id: "theme",
    group: "Preferences",
    label: opts.theme === "light" ? "Switch to dark theme" : "Switch to light theme",
    icon: opts.theme === "light" ? "ti-moon" : "ti-sun",
    kind: "theme",
  });
  return cmds;
}

// Case-insensitive match on every whitespace-separated query word; labels that
// start with the query rank first, otherwise the original order is kept. Full
// fuzzy search across every entity is E18-005.
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  const q = words.join(" ");
  return commands
    .map((cmd, index) => ({ cmd, index, label: cmd.label.toLowerCase() }))
    .filter(({ label }) => words.every((w) => label.includes(w)))
    .sort((a, b) => Number(b.label.startsWith(q)) - Number(a.label.startsWith(q)) || a.index - b.index)
    .map(({ cmd }) => cmd);
}

// Listbox keyboard movement: arrows wrap, Home/End jump. Returns the new index.
export function moveActive(key: string, index: number, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}

// Workspaces from the /auth/me session. Names fall back to a short id so an
// unnamed org is still distinguishable.
export function workspacesFromSession(account?: {
  memberships?: { orgId: string; role: string; name?: string | null }[];
}): Workspace[] {
  return (account?.memberships ?? []).map((m) => ({
    orgId: m.orgId,
    role: m.role,
    name: m.name?.trim() || `Workspace ${m.orgId.slice(0, 8)}`,
  }));
}
