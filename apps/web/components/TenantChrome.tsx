import type { ReactNode } from "react";
import { safeAccent, safeLogoUrl, type TenantBrand } from "@/lib/tenant";

// Branded chrome shared by the subdomain (/s/[subdomain]) and custom-domain
// (/domain/[host]) tenant surfaces. The org is already resolved + authorized by the
// caller; this only renders public branding. Accent is hex-guarded, logo is https-only.
export function TenantChrome({ org, children }: { org: TenantBrand; children: ReactNode }) {
  const accent = safeAccent(org.primaryColor);
  const logo = safeLogoUrl(org.logoUrl);
  return (
    <div style={{ ["--brand" as string]: accent, minHeight: "100vh" }}>
      <header className="nav">
        <div className="wrap">
          <span className="brand" style={{ gap: 10 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant URL (https-only, validated)
              <img
                src={logo}
                alt={org.name}
                style={{ height: 26, width: "auto", borderRadius: 6 }}
              />
            ) : (
              <i className="ti ti-mail-fast" style={{ color: accent }} />
            )}
            {org.name}
          </span>
        </div>
      </header>
      {children}
      {org.poweredBy ? (
        <footer style={{ textAlign: "center" }}>
          <div className="wrap muted" style={{ fontSize: 13 }}>
            Powered by EMS
          </div>
        </footer>
      ) : null}
    </div>
  );
}
