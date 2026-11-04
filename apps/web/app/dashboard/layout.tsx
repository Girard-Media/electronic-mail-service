import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { workspacesFromSession } from "@/lib/dash-nav";
import { DashGate } from "@/components/DashGate";
import { DashNav } from "@/components/DashNav";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

// Next dashboard layout shell (E18-004): sidebar, top bar with workspace switcher,
// command palette (Cmd/Ctrl+K), keyboard shortcuts (E18-006) and light/dark toggle. The full dashboard is ported
// view by view; until parity the Hono static dashboard (apps/api/public/dashboard.html)
// stays primary and next.config.ts redirects /dashboard there. Per-user → force-dynamic.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session?.user) return <DashGate />;

  const orgName = session.branding?.name ?? session.account?.name ?? "Your org";
  const activeOrgId = session.account?.activeOrgId ?? session.orgId ?? null;
  const workspaces = workspacesFromSession(session.account);
  return (
    <div className="dash-shell">
      <a className="skip-link" href="#dash-main">
        Skip to content
      </a>
      <aside className="dash-side">
        <Link className="brand" href="/" style={{ marginBottom: 22 }}>
          <i className="ti ti-mail-fast" aria-hidden="true" />
          EMS
        </Link>
        <DashNav />
      </aside>
      <div className="dash-body">
        <header className="dash-top">
          <WorkspaceSwitcher workspaces={workspaces} activeOrgId={activeOrgId} activeName={orgName} role={session.role} />
          <div className="dash-top-tools">
            <CommandPalette workspaces={workspaces} activeOrgId={activeOrgId} />
            <KeyboardShortcuts />
            <ThemeToggle />
            <span className="muted dash-email">{session.user.email}</span>
          </div>
        </header>
        <main className="dash-main" id="dash-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
