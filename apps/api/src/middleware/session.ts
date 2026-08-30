import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { env, errors, isOrgRole, type OrgRole } from "@ems/core";
import { prisma } from "@ems/db";

export const SESSION_COOKIE = "um_session";
// Preserves the admin's own session while they impersonate a user, so the
// impersonation is reversible.
export const GOD_COOKIE = "um_god";
// Selects which org the session acts as (agency ↔ sub-account switching). Only
// ever honored when the user is a MEMBER of the named org — see sessionAuth.
export const ACTIVE_ORG_COOKIE = "um_activeorg";
export type SessionVars = {
  userId: string;
  orgId: string;
  projectId: string;
  // Membership role in the *active* org. Mutations consult this, not the UI.
  orgRole: OrgRole | null;
  // Set when the current session is a God Mode impersonation: the admin's id.
  impersonatorId?: string;
};

// Dashboard session auth: verify the signed cookie, check the token version
// (revocation), resolve the user's org + default project, attach tenant context.
export const sessionAuth = createMiddleware<{ Variables: SessionVars }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw errors.unauthorized();
    let payload: { sub?: string; ver?: number; imp?: string; impVer?: number };
    try {
      payload = (await verify(token, env.AUTH_SECRET, "HS256")) as unknown as {
        sub?: string;
        ver?: number;
        imp?: string;
        impVer?: number;
      };
    } catch {
      throw errors.unauthorized();
    }
    const userId = payload.sub ?? "";
    if (!userId) throw errors.unauthorized();

    // Impersonation: re-authorize the impersonating admin on EVERY request so
    // that demoting/removing the admin, or logging them out (tokenVersion bump),
    // immediately voids the live impersonation session — not just at mint time.
    if (payload.imp) {
      const [impAdmin, impUser] = await Promise.all([
        prisma.platformAdmin.findUnique({
          where: { userId: payload.imp },
          select: { role: true, scopes: true },
        }),
        prisma.user.findUnique({
          where: { id: payload.imp },
          select: { tokenVersion: true },
        }),
      ]);
      const stillAllowed =
        impAdmin &&
        (impAdmin.role === "superadmin" || impAdmin.scopes.includes("impersonate"));
      const adminNotRevoked =
        impUser && (payload.impVer ?? -1) === impUser.tokenVersion;
      if (!stillAllowed || !adminNotRevoked) throw errors.unauthorized();
      c.set("impersonatorId", payload.imp);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    if (!user || (payload.ver ?? 0) !== user.tokenVersion) {
      throw errors.unauthorized();
    }

    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: {
        org: {
          include: { projects: { take: 1, orderBy: { createdAt: "asc" } } },
        },
      },
    });
    const project = membership?.org.projects[0];
    if (!membership || !project) throw errors.unauthorized();

    // Active-org context: an agency member can switch the session into another org
    // they belong to (e.g. a sub-account). We ONLY honor the cookie when the user
    // is a member of the target org with a project — so a forged or stale cookie
    // can never reach another tenant; it silently falls back to the default org.
    // Skipped during impersonation (the impersonated user's own context applies).
    let activeOrgId = membership.orgId;
    let activeProjectId = project.id;
    let activeRole: OrgRole | null = isOrgRole(membership.role) ? membership.role : null;
    if (!payload.imp) {
      const wanted = getCookie(c, ACTIVE_ORG_COOKIE);
      if (wanted && wanted !== membership.orgId) {
        const alt = await prisma.membership.findFirst({
          where: { userId, orgId: wanted },
          include: { org: { include: { projects: { take: 1, orderBy: { createdAt: "asc" } } } } },
        });
        const altProject = alt?.org.projects[0];
        if (alt && altProject) {
          activeOrgId = alt.orgId;
          activeProjectId = altProject.id;
          activeRole = isOrgRole(alt.role) ? alt.role : null;
        }
      }
    }

    c.set("userId", userId);
    c.set("orgId", activeOrgId);
    c.set("projectId", activeProjectId);
    c.set("orgRole", activeRole);
    await next();
  },
);
