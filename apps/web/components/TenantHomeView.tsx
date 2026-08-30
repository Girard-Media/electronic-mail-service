import { safeAccent, type TenantBrand } from "@/lib/tenant";

// Tenant landing view, shared by the subdomain + custom-domain surfaces. Public
// branding only; auth lives on the Hono app until the Phase 5 dashboard port.
export function TenantHomeView({ org }: { org: TenantBrand }) {
  const accent = safeAccent(org.primaryColor);
  return (
    <section className="hero">
      <div className="wrap">
        <span className="pill" style={{ color: accent, borderColor: accent }}>
          <i className="ti ti-shield-lock" style={{ fontSize: 15 }} /> Secure email portal
        </span>
        <h1 style={{ marginTop: 18 }}>
          Welcome to <span style={{ color: accent }}>{org.name}</span>
        </h1>
        <p className="sub">
          This is the {org.name} email portal. Sign in to manage your domains, send
          application email, and view delivery logs.
        </p>
        <div className="cta">
          <a className="btn pri lg" href="https://app.electronicmailservices.com/dashboard">
            <i className="ti ti-login" /> Sign in
          </a>
        </div>
      </div>
    </section>
  );
}
