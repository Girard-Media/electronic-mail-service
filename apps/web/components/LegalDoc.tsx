import type { ReactNode } from "react";

/** Shared chrome for /privacy /terms /security. Copy is claims-clean (G3). */
export function LegalDoc({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className="hero" style={{ padding: "72px 0 24px" }}>
        <div className="wrap" style={{ maxWidth: 780 }}>
          <span className="eyebrow">{eyebrow}</span>
          <h1 style={{ marginTop: 14 }}>{title}</h1>
          <p className="muted" style={{ marginTop: 12 }}>
            Last updated {updated}. Prepared for counsel review — not legal advice.
          </p>
        </div>
      </section>
      <section style={{ paddingTop: 0 }}>
        <div className="wrap post-body">{children}</div>
      </section>
    </>
  );
}
