import Link from "next/link";

// Shared marketing footer. Mirrors apps/api/public/*.html footer.
export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="cols">
          <div style={{ maxWidth: 300 }}>
            <Link className="brand" href="/">
              <i className="ti ti-mail-fast" />
              EMS
            </Link>
            <p className="muted" style={{ marginTop: 14 }}>
              Application email on infrastructure you control. Transactional today,
              lifecycle &amp; automation tomorrow — on one event stream.
            </p>
          </div>
          <div>
            <b>Product</b>
            <Link href="/features">Features</Link>
            <Link href="/deliverability">Deliverability</Link>
            <Link href="/pricing">Pricing</Link>
            <a href="/dashboard">Dashboard</a>
          </div>
          <div>
            <b>Developers</b>
            <Link href="/docs">Docs</Link>
            <Link href="/docs/dev#quickstart">Quickstart</Link>
            <Link href="/docs/dev#api">API reference</Link>
            <Link href="/docs/user#inbox">Inbox</Link>
            <Link href="/docs/dev#inbound">Inbound</Link>
            <Link href="/docs/dev#migrate">Migration guide</Link>
          </div>
          <div>
            <b>Company</b>
            <Link href="/blog">Blog</Link>
            <Link href="/status">Status</Link>
            <Link href="/security">Security</Link>
            {/* hello@ is the only address the codebase treats as ours (dashboard
                default From). Swap if a dedicated support inbox is set up. */}
            <a href="mailto:hello@electronicmailservices.com">Contact</a>
          </div>
        </div>
        <div className="bot">
          <span>© 2026 EMS</span>
          <span className="muted">
            <Link href="/privacy">Privacy</Link>
            {" · "}
            <Link href="/terms">Terms</Link>
            {" · "}
            Built on independent, self-hosted infrastructure.
          </span>
        </div>
      </div>
    </footer>
  );
}
