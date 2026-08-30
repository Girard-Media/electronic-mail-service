"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SiteNav } from "../components/SiteNav";
import { SiteFooter } from "../components/SiteFooter";

// Root error boundary (the branded 500). Must be a Client Component — Next
// requires that for error boundaries. `reset()` retries the failed render.
// SiteNav/SiteFooter are purely presentational (Link + static JSX only), so
// pulling them into the client bundle here is safe and keeps the page on-brand.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the server log with the digest so a report can be traced back.
    console.error("Unhandled marketing-site error:", error);
  }, [error]);

  return (
    <>
      <SiteNav />
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-alert-triangle" /> Something broke
          </span>
          <h1>That didn&apos;t load</h1>
          <p className="muted">
            An unexpected error hit this page. Sending and delivery run on
            separate infrastructure and are not affected by a fault on this
            site.
          </p>
          {error.digest ? (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              Reference <span className="mono">{error.digest}</span> — include
              this if you get in touch.
            </p>
          ) : null}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
              marginTop: 28,
            }}
          >
            <button className="btn pri" onClick={reset} type="button">
              <i className="ti ti-refresh" /> Try again
            </button>
            <Link className="btn" href="/">
              <i className="ti ti-home" /> Back home
            </Link>
            <Link className="btn" href="/status">
              <i className="ti ti-activity-heartbeat" /> Service status
            </Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
