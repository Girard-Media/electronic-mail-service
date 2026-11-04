import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

// Shared marketing top nav. Server component; the only client island is the
// light/dark ThemeToggle (E18-004). Mirrors apps/api/public/*.html header.
export function SiteNav() {
  return (
    <header className="nav">
      <div className="wrap">
        <Link className="brand" href="/">
          <i className="ti ti-mail-fast" />
          EMS
        </Link>
        <nav>
          <Link href="/blog">Blog</Link>
          <Link href="/status">Status</Link>
          <Link href="/security">Security</Link>
        </nav>
        <div className="right">
          <ThemeToggle />
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
