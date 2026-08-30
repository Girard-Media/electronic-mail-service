import { notFound } from "next/navigation";
import { getOrgByCustomDomain } from "@/lib/tenant";
import { TenantHomeView } from "@/components/TenantHomeView";

// Custom-domain landing (branded-before-login). Rendered on demand per host and cached;
// branding changes are pushed via /api/revalidate. Public branding only.
export const revalidate = 300;

type Params = { params: Promise<{ host: string }> };

export default async function CustomDomainHome({ params }: Params) {
  const { host } = await params;
  const org = await getOrgByCustomDomain(host);
  if (!org) notFound();
  return <TenantHomeView org={org} />;
}
