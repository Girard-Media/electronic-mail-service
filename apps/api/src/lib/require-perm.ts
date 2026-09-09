import type { Context, Next } from "hono";
import { can, errors, type Permission } from "@ems/core";
import type { SessionVars } from "../middleware/session.js";

type WriteDecision = Permission | "allow" | "deny";

function appPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (trimmed === "/app") return "/";
  return trimmed.startsWith("/app/") ? trimmed.slice(4) : trimmed;
}

/**
 * Map a dashboard mutation to the permission it needs. Nested routers that
 * already call `can()` (team / subaccounts / billing) are left alone. Unknown
 * writes fail closed so a new POST can't ship as owner-for-everyone.
 */
export function permForAppWrite(method: string, pathname: string): WriteDecision {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return "allow";
  const p = appPath(pathname);

  if (
    p.startsWith("/team") ||
    p.startsWith("/subaccounts") ||
    p.startsWith("/billing") ||
    p === "/privacy/delete"
  ) {
    return "allow";
  }
  // Read-like analysis — no tenant mutation.
  if (p === "/verify" || p === "/templates/preview") return "allow";

  if (p === "/test-email" || /^\/emails\/[^/]+\/cancel$/.test(p)) return "email:send";
  if (p === "/keys" || /^\/keys\/[^/]+$/.test(p)) return "key:write";
  if (
    p === "/domains" ||
    p === "/domains/bulk" ||
    p === "/domains/recheck-all" ||
    p === "/import" ||
    p === "/dns-provider-token" ||
    /^\/domains\/[^/]+/.test(p)
  ) {
    return "domain:write";
  }
  if (p === "/suppressions" || /^\/suppressions\/[^/]+$/.test(p) || p === "/verify/suppress") {
    return "suppression:write";
  }
  if (p === "/templates" || /^\/templates\/[^/]+$/.test(p)) return "template:write";
  if (p === "/branding") return "branding:write";
  if (p.startsWith("/mailboxes") || p.startsWith("/messages")) return "mailbox:write";
  if (p === "/webhooks" || /^\/webhooks\/[^/]+$/.test(p)) return "webhook:write";
  if (p.startsWith("/connected-accounts")) return "mailbox:write";
  if (p.startsWith("/campaigns")) return "email:send";
  if (p.startsWith("/fleet/domains")) return "domain:write";
  if (p.startsWith("/fleet/mailboxes") || p.startsWith("/fleet/personas")) return "mailbox:write";
  if (p.startsWith("/inbox")) return "mailbox:write";
  return "deny";
}

export function requirePerm(c: Context<{ Variables: SessionVars }>, perm: Permission): void {
  if (!can(c.get("orgRole"), perm)) {
    throw errors.forbidden("You don't have permission to do that.");
  }
}

export async function dashWriteGuard(c: Context<{ Variables: SessionVars }>, next: Next) {
  const decision = permForAppWrite(c.req.method, new URL(c.req.url, "http://local").pathname);
  if (decision === "allow") return next();
  if (decision === "deny") throw errors.forbidden("You don't have permission to do that.");
  requirePerm(c, decision);
  return next();
}
