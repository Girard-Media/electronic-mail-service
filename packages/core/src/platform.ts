// Platform (God Mode) capability scopes. Sub-admins are granted a subset;
// a superadmin implicitly holds all of them and can manage other admins.

export const PLATFORM_SCOPES = [
  "metrics", // overview + analytics
  "profitability", // revenue / cost / margin views
  "users", // browse tenants + users
  "impersonate", // act as a user for support/debugging
  "logs", // platform-wide logs + audit trail
  "admins", // add/edit/remove other platform admins
] as const;

export type PlatformScope = (typeof PLATFORM_SCOPES)[number];

export const PLATFORM_SCOPE_LABELS: Record<PlatformScope, string> = {
  metrics: "Metrics & analytics",
  profitability: "Profitability",
  users: "Users & tenants",
  impersonate: "Impersonate users",
  logs: "Logs & audit trail",
  admins: "Manage admins",
};

export function isPlatformScope(s: string): s is PlatformScope {
  return (PLATFORM_SCOPES as readonly string[]).includes(s);
}
