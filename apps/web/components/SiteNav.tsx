import Link from "next/link";

// Shared marketing top nav. Server component — the only interactivity is CSS hover and
// the >820px nav reveal, so no client JS. Mirrors apps/api/public/*.html header.
export function SiteNav() {
  return (
    <header className="nav">
      <div className="wrap">
        <Link className="brand" href="/">
          <i className="ti ti-mail-fast" />
          EMS
        </Link>
        <nav>
          <Link href="/features">Features</Link>
          <Link href="/deliverability">Deliverability</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <div className="right">
          {/* /dashboard is still served by the Hono app until the Phase 5 port. */}
          <a href="/dashboard" style={{ color: "var(--tx2)", fontSize: "14.5px", fontWeight: 500 }}>
            Dashboard
          </a>
          <a className="btn pri" href="/dashboard">
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}
