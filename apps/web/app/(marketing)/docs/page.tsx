import type { Metadata } from "next";
import Link from "next/link";

// Docs index. Static + ISR (regenerated at most hourly). No DB / no @ems/core
// import here, so `next build` prerenders it without any env or DB connection. Ported
// 1:1 from apps/api/public/docs.html onto the shared (marketing) chrome.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Docs",
  description:
    "EMS documentation — a user guide for the dashboard (sending domains, verification, deliverability) and developer docs for the API, SDK, and MCP.",
};

export default function Docs() {
  return (
    <>
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-book-2" /> Documentation
          </span>
          <h1>Pick your path</h1>
          <p className="muted">
            Two ways in — a step-by-step guide for using EMS from the dashboard, and
            a developer reference for the API and the Resend drop-in.
          </p>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 40 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 20,
            maxWidth: 840,
            margin: "0 auto",
          }}
        >
          <Link href="/docs/user" className="card" style={{ display: "block", textDecoration: "none" }}>
            <div className="ic">
              <i className="ti ti-user-heart" />
            </div>
            <h3>User guide</h3>
            <p>
              Send from your own domain, host inboxes at{" "}
              <span className="mono">you@yourdomain.com</span>, verify lists, watch
              deliverability, and manage suppressions — all from the dashboard. No code
              required.
            </p>
            <p style={{ color: "var(--brand2)", marginTop: 14, fontWeight: 600 }}>
              Open the user guide <i className="ti ti-arrow-right" />
            </p>
          </Link>
          <Link href="/docs/dev" className="card" style={{ display: "block", textDecoration: "none" }}>
            <div className="ic">
              <i className="ti ti-code" />
            </div>
            <h3>Developer docs</h3>
            <p>
              Quickstart with curl, the Resend drop-in (
              <span className="mono">RESEND_BASE_URL</span>), the verify API, signed
              webhooks, idempotency, and the full API reference.
            </p>
            <p style={{ color: "var(--brand2)", marginTop: 14, fontWeight: 600 }}>
              Open the developer docs <i className="ti ti-arrow-right" />
            </p>
          </Link>
        </div>
        <p className="muted center" style={{ marginTop: 28, fontSize: 14 }}>
          Already using a transactional client? It&apos;s a one-line base-URL change — point
          it at <span className="mono">https://api.electronicmailservices.com</span> and see the{" "}
          <Link href="/docs/dev" style={{ color: "var(--brand2)" }}>
            migration guide
          </Link>
          .
        </p>
      </section>
    </>
  );
}
