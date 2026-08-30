import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { env, ApiError, PLATFORM_SCOPES, type PlatformScope } from "@ems/core";
import { prisma, Prisma } from "@ems/db";
import type { SessionVars } from "./session.js";
import { grantOperatorPlan } from "../lib/operator-plan.js";

export type GodVars = SessionVars & {
  platformRole: "superadmin" | "admin";
  platformScopes: string[];
};

const forbidden = (msg: string) => new ApiError(403, "forbidden", msg);

// Requires the session user to be a platform admin. Auto-promotes the
// configured GOD_SUPERADMIN_EMAIL on first access. Impersonation sessions are
// refused — you can't reach God Mode while wearing a tenant's identity.
export const requirePlatformAdmin = createMiddleware<{ Variables: GodVars }>(
  async (c, next) => {
    if (c.get("impersonatorId")) {
      throw forbidden("Exit impersonation before using God Mode.");
    }
    const userId = c.get("userId");
    let admin = await prisma.platformAdmin.findUnique({ where: { userId } });
    if (!admin) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      });
      const god = env.GOD_SUPERADMIN_EMAIL?.toLowerCase();
      if (
        god &&
        user?.email &&
        user.email.toLowerCase() === god &&
        user.emailVerifiedAt // must prove ownership of the god email
      ) {
        // Bootstrap only: auto-promote the configured (verified) email solely
        // when NO superadmin exists yet. Once one is established, further
        // promotion goes through the admin UI (superadmin-gated). The verified-
        // email requirement closes the pre-registration takeover: an attacker
        // who squats the address can't confirm it, so can't be promoted.
        const superCount = await prisma.platformAdmin.count({
          where: { role: "superadmin" },
        });
        if (superCount === 0) {
          admin = await prisma.platformAdmin.create({
            data: { userId, role: "superadmin", scopes: [...PLATFORM_SCOPES] },
          });
        }
      }
    }
    if (!admin) throw forbidden("God Mode is restricted to platform admins.");
    c.set("platformRole", admin.role);
    c.set(
      "platformScopes",
      admin.role === "superadmin" ? [...PLATFORM_SCOPES] : admin.scopes,
    );
    // Operator orgs stay on the unlimited plan so God Mode isn't capped at Free.
    await grantOperatorPlan(userId);
    await next();
  },
);

export function requireScope(c: Context<{ Variables: GodVars }>, scope: PlatformScope) {
  if (c.get("platformRole") === "superadmin") return;
  if (!c.get("platformScopes")?.includes(scope)) {
    throw forbidden(`Your admin role is missing the "${scope}" scope.`);
  }
}

// Admin management (grant/edit/remove admins + privileges) is reserved to the
// superadmin — delegating it to a scoped admin would let that admin grant
// itself any capability (incl. impersonate), defeating the scope model.
export function requireSuperadmin(c: Context<{ Variables: GodVars }>) {
  if (c.get("platformRole") !== "superadmin") {
    throw forbidden("This action requires the superadmin role.");
  }
}

export async function audit(
  actorUserId: string,
  action: string,
  target?: { type?: string; id?: string; meta?: Record<string, unknown> },
) {
  await prisma.platformAuditLog.create({
    data: {
      actorUserId,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      meta: (target?.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
