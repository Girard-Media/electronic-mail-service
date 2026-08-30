import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrgByCustomDomain } from "@/lib/tenant";
import { TenantChrome } from "@/components/TenantChrome";

// Custom-domain tenant surface (reached via proxy.ts rewrite of a verified custom
// hostname like mail.acme.com → /domain/<host>). Same branded chrome as the subdomain
// surface; the only difference is how the org is resolved (by customDomain).
type Params = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host } = await params;
  const org = await getOrgByCustomDomain(host);
  if (!org) return { title: "Not found", robots: { index: false } };
  return {
    title: { default: org.name, template: `%s · ${org.name}` },
    // A tenant's custom domain is their own brand surface — don't index it under us.
    robots: { index: false, follow: false },
  };
}

export default async function CustomDomainLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ host: string }>;
}) {
  const { host } = await params;
  const org = await getOrgByCustomDomain(host);
  if (!org) notFound();
  return <TenantChrome org={org}>{children}</TenantChrome>;
}
