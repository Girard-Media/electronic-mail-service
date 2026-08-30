import { cache } from "react";
import { headers } from "next/headers";

// Dashboard auth bridge. Rather than re-implement the Hono API's session-cookie crypto
// in Next, we forward the request's cookies to the API's /auth/me and let the API stay
// the single source of truth for "who is this user". Reads happen server-side only;
// writes still go to the Hono API. cache() dedups the call across layout + page within
// one request. force-dynamic on the dashboard routes keeps it per-user (never cached).
const API_URL = (
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8787"
).replace(/\/$/, "");

export type DashSession = {
  user: { id: string; email: string; name: string | null; createdAt: string } | null;
  emailVerified: boolean;
  role: string | null;
  orgId: string | null;
  projectId: string | null;
  branding: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    poweredBy: boolean;
  } | null;
  account?: {
    activeOrgId: string | null;
    name: string | null;
    memberships?: { orgId: string; role: string; name?: string | null }[];
    isSubAccount?: boolean;
    canManageSubaccounts?: boolean;
  };
};

export const getSession = cache(async (): Promise<DashSession | null> => {
  const cookie = (await headers()).get("cookie") ?? "";
  // Fast path: no session cookie at all → signed out, skip the round-trip.
  if (!/(?:^|;\s*)um_session=/.test(cookie)) return null;
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DashSession;
  } catch {
    // API unreachable → treat as signed out (render the gate) rather than 500.
    return null;
  }
});
