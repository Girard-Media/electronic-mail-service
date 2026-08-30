import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrgBySubdomain } from "@/lib/tenant";
import { TenantChrome } from "@/components/TenantChrome";

// White-label tenant surface (reached via proxy.ts rewrite of tenant.electronicmailservices.com).
// Outside the (marketing) group → no EMS nav/footer; the tenant gets its own
// branded chrome, rendered BEFORE login.
type Params = { params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { subdomain } = await params;
  const org = await getOrgBySubdomain(subdomain);
  if (!org) return { title: "Not found", robots: { index: false } };
  return {
    title: { default: org.name, template: `%s · ${org.name}` },
    // Tenant subdomains are app surfaces, not SEO targets — keep them out of the index.
    robots: { index: false, follow: false },
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const org = await getOrgBySubdomain(subdomain);
  if (!org) notFound();
  return <TenantChrome org={org}>{children}</TenantChrome>;
}
