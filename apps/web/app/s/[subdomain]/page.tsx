import { notFound } from "next/navigation";
import { getOrgBySubdomain } from "@/lib/tenant";
import { TenantHomeView } from "@/components/TenantHomeView";

// Tenant landing (branded-before-login). Rendered on demand per subdomain and cached;
// branding changes are pushed via /api/revalidate. Public branding only.
export const revalidate = 300;

type Params = { params: Promise<{ subdomain: string }> };

export default async function TenantHome({ params }: Params) {
  const { subdomain } = await params;
  const org = await getOrgBySubdomain(subdomain);
  if (!org) notFound();
  return <TenantHomeView org={org} />;
}
