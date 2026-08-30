import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { DashGate } from "@/components/DashGate";

// Next dashboard FOUNDATION. The full dashboard is ported incrementally; until parity,
// the Hono static dashboard (apps/api/public/dashboard.html) remains primary and this
// route is not yet the production /dashboard (apps/web isn't deployed). Per-user →
// force-dynamic, never cached.
export const dynamic = "force-dynamic";

// Sidebar sections. `soon` items land as the corresponding views are ported over.
const NAV = [
  { href: "/dashboard", label: "Overview", icon: "ti-layout-dashboard", soon: false },
  { href: "/dashboard", label: "Domains", icon: "ti-world", soon: true },
  { href: "/dashboard", label: "Logs", icon: "ti-list-search", soon: true },
  { href: "/dashboard", label: "API keys", icon: "ti-key", soon: true },
  { href: "/dashboard", label: "Team", icon: "ti-users", soon: true },
  { href: "/dashboard", label: "Billing", icon: "ti-credit-card", soon: true },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session?.user) return <DashGate />;

  const orgName = session.branding?.name ?? session.account?.name ?? "Your org";
  return (
    <div className="dash-shell">
      <aside className="dash-side">
        <Link className="brand" href="/" style={{ marginBottom: 22 }}>
          <i className="ti ti-mail-fast" />
          EMS
        </Link>
        <nav className="dash-nav">
          {NAV.map((item) => (
            <span
              key={item.label}
              className={`dash-nav-item${item.soon ? " soon" : " active"}`}
            >
              <i className={`ti ${item.icon}`} />
              {item.label}
              {item.soon ? <span className="dash-soon">soon</span> : null}
            </span>
          ))}
        </nav>
      </aside>
      <div className="dash-body">
        <header className="dash-top">
          <div className="dash-org">
            <i className="ti ti-building" />
            <strong>{orgName}</strong>
            {session.role ? <span className="dash-role">{session.role}</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{session.user.email}</div>
        </header>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
