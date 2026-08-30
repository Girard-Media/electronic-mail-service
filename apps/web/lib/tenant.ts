import { cache } from "react";
import { prisma } from "@ems/db";
import { isValidSubdomain, isValidHostname } from "./subdomains";

const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  logoUrl: true,
  primaryColor: true,
  poweredBy: true,
} as const;

// Tenant resolution for the white-label surface. Server-only (imports Prisma). The
// branding fields are PUBLIC (shown before login), so reading them unauthenticated is
// fine — but anything tenant-PRIVATE must be scoped by the returned `org.id`, never
// trusted from the URL. `cache()` dedups the lookup within a single request (layout +
// page + generateMetadata all resolve the same org once).
export type TenantBrand = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  logoUrl: string | null;
  primaryColor: string | null;
  poweredBy: boolean;
};

export const getOrgBySubdomain = cache(
  async (subdomain: string): Promise<TenantBrand | null> => {
    const sub = subdomain.trim().toLowerCase();
    // Defense in depth: reject anything that isn't a legal, non-reserved label before
    // it ever reaches the DB (proxy already filters, but the segment is user-facing).
    if (!isValidSubdomain(sub)) return null;
    try {
      return await prisma.organization.findUnique({
        where: { subdomain: sub },
        select: TENANT_SELECT,
      });
    } catch {
      // DB unreachable → treat as not-found (the page will 404) rather than 500.
      return null;
    }
  },
);

// Resolve a tenant by its verified custom domain (e.g. mail.acme.com). The host is
// re-validated before the DB lookup since the route segment is attacker-controlled.
export const getOrgByCustomDomain = cache(
  async (host: string): Promise<TenantBrand | null> => {
    const h = host.trim().toLowerCase();
    if (!isValidHostname(h)) return null;
    try {
      return await prisma.organization.findUnique({
        where: { customDomain: h },
        select: TENANT_SELECT,
      });
    } catch {
      return null;
    }
  },
);

// A safe accent color: only allow #rgb / #rrggbb so a stored value can't break out of
// the style attribute. Falls back to the brand purple.
export function safeAccent(color: string | null): string {
  if (color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) {
    return color.trim();
  }
  return "#6d5efc";
}

// A safe logo URL: only https:// (tenant logos belong on our CDN/R2). Rejects http,
// data:, and anything malformed so a tenant can't turn its pre-login portal into an
// off-origin tracking beacon or point <img> at arbitrary infrastructure.
export function safeLogoUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
