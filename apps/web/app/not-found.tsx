import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "../components/SiteNav";
import { SiteFooter } from "../components/SiteFooter";

// Root 404. Lives outside the (marketing) group — Next only applies the root
// layout to not-found — so it pulls in the shared nav/footer chrome itself.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-mail-question" /> 404
          </span>
          <h1>This address doesn&apos;t exist</h1>
          <p className="muted">
            The page you asked for isn&apos;t here — it may have moved, or the link may
            have a typo. Your email is unaffected.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
              marginTop: 28,
            }}
          >
            <Link className="btn pri" href="/">
              <i className="ti ti-home" /> Back home
            </Link>
            <Link className="btn" href="/docs">
              <i className="ti ti-book-2" /> Read the docs
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
