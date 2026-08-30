import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@ems/db";
import {
  env,
  errors,
  ApiError,
  enforceFixedWindow,
  can,
  canManageRole,
  assignableRoles,
  isOrgRole,
  ROLE_META,
  withinLimit,
  signInvite,
  type OrgRole,
} from "@ems/core";
import { sessionAuth, type SessionVars } from "../middleware/session.js";
import { enqueueEmail } from "../lib/send.js";
import { effectiveOrgPlan } from "../lib/operator-plan.js";

// Team management for the active org. Mounted under /app/team (session-authed via
// the parent dash router). Every mutation is RBAC-gated by the actor's role in
// the *session* org — never a client-supplied org id — and protected against
// privilege escalation (can't assign a role above your own) and orphaning the
// org (can't remove or demote the last owner).
export const team = new Hono<{ Variables: SessionVars }>();

// Self-contained auth so the router is correct whether or not the parent applies
// it. sessionAuth is idempotent (re-validates the cookie); the cost is one extra
// lookup on these low-frequency admin calls.
team.use("*", sessionAuth);

// The acting user's role in the session org, or null if (somehow) not a member.
async function actorRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const m = await prisma.membership.findFirst({
    where: { orgId, userId },
    select: { role: true },
  });
  return m && isOrgRole(m.role) ? m.role : null;
}

// GET /app/team — roster + pending invites + the caller's capabilities (so the
// dashboard can render the right controls; the server still re-checks every op).
team.get("/", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const myRole = await actorRole(orgId, userId);
  if (!myRole) throw errors.forbidden("You are not a member of this organization.");

  const [members, invites, org] = await Promise.all([
    prisma.membership.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.invite.findMany({
      where: { orgId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    effectiveOrgPlan(orgId),
  ]);

  const limits = org.limits;
  const manage = can(myRole, "team:invite");

  return c.json({
    myRole,
    canManage: manage,
    assignableRoles: assignableRoles(myRole),
    roleMeta: ROLE_META,
    seats: { used: members.length + invites.length, limit: limits.teamSeats },
    members: members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      joinedAt: m.createdAt,
      isYou: m.user.id === userId,
      // The caller may act on this member only when they outrank-or-equal them and
      // it isn't themselves. (Server re-validates on PATCH/DELETE.)
      canManage:
        m.user.id !== userId &&
        can(myRole, "team:role") &&
        isOrgRole(m.role) &&
        canManageRole(myRole, m.role),
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedAt: i.createdAt,
    })),
  });
});

// POST /app/team/invite — invite by email at a chosen role. Existing users with
// an account are added straight to the team; otherwise an invite row + emailed
// link is created. Seat-limited by plan; role-capped by the inviter's own rank.
team.post("/invite", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const myRole = await actorRole(orgId, userId);
  if (!can(myRole, "team:invite")) {
    throw errors.forbidden("Only an owner or admin can invite teammates.");
  }

  const p = z
    .object({
      email: z.string().email(),
      role: z.enum(["admin", "developer", "viewer"]).default("developer"),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid email and role are required.");

  const role = p.data.role as OrgRole;
  if (!canManageRole(myRole, role)) {
    throw errors.forbidden("You can't invite someone at a role above your own.");
  }
  const email = p.data.email.toLowerCase();

  // Throttle invite blasts (spam / email-reputation protection).
  await enforceFixedWindow(`invite:${orgId}`, 30, 3600);

  const [memberCount, pendingCount, org, { limits }] = await Promise.all([
    prisma.membership.count({ where: { orgId } }),
    prisma.invite.count({ where: { orgId, acceptedAt: null } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    effectiveOrgPlan(orgId),
  ]);
  if (!withinLimit(memberCount + pendingCount, limits.teamSeats)) {
    throw errors.planLimit(
      "You've used all your team seats. Upgrade your plan to invite more teammates.",
    );
  }

  // Already a member? (Look up by email → membership in this org.)
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const already = await prisma.membership.findFirst({
      where: { orgId, userId: existingUser.id },
      select: { id: true },
    });
    if (already) throw new ApiError(409, "already_member", "That person is already on the team.");
  }

  // Upsert the invite (re-inviting refreshes the role + clears any prior accept).
  const invite = await prisma.invite.upsert({
    where: { orgId_email: { orgId, email } },
    update: { role, invitedById: userId, acceptedAt: null, createdAt: new Date() },
    create: { orgId, email, role, invitedById: userId },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  // Email the invite link (best-effort — the invite still stands if the send fails;
  // an existing user can also accept from inside their own dashboard).
  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  // Build the emailed invite link from the TRUSTED configured origin, never the
  // inbound Host header — a spoofed Host would point the invite (and its bound
  // token) at an attacker domain (host-header injection). The dashboard is served
  // by this API, so API_URL is the right base (matches auth + billing routes).
  const origin = new URL(env.API_URL).origin;
  const link = `${origin}/dashboard?invite=${signInvite(invite.id, email)}`;
  const orgName = org?.name || "a team";
  const who = inviter?.name || inviter?.email || "A teammate";
  try {
    await enqueueEmail(
      c.get("projectId"),
      {
        from: "EMS <hello@electronicmailservices.com>",
        to: email,
        subject: `You've been invited to ${orgName} on EMS`,
        html: `<p>${escapeHtml(who)} invited you to join <strong>${escapeHtml(orgName)}</strong> on EMS as a ${escapeHtml(ROLE_META[role].label.toLowerCase())}.</p><p><a href="${escapeHtml(link)}">Accept the invitation</a></p><p>Or paste this link into your browser: ${escapeHtml(link)}</p><p>This invite expires in 7 days.</p>`,
        text: `${who} invited you to join ${orgName} on EMS. Accept: ${link} (expires in 7 days)`,
      } as Parameters<typeof enqueueEmail>[1],
      null,
      { internal: true },
    );
  } catch {
    /* best-effort */
  }

  return c.json({ ok: true, invite, addedExisting: false });
});

// PATCH /app/team/:userId/role — change a member's role.
team.patch("/:userId/role", async (c) => {
  const orgId = c.get("orgId");
  const actorId = c.get("userId");
  const targetUserId = c.req.param("userId");
  const myRole = await actorRole(orgId, actorId);
  if (!can(myRole, "team:role")) {
    throw errors.forbidden("Only an owner or admin can change roles.");
  }

  const p = z
    .object({ role: z.enum(["owner", "admin", "developer", "viewer"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid role is required.");
  const newRole = p.data.role as OrgRole;

  if (targetUserId === actorId) {
    throw errors.validation("You can't change your own role.");
  }

  const target = await prisma.membership.findFirst({
    where: { orgId, userId: targetUserId },
    select: { id: true, role: true },
  });
  if (!target || !isOrgRole(target.role)) throw errors.notFound("That member was not found.");

  // Outrank both the current role and the new role — so you can't elevate someone
  // above yourself, nor demote someone who outranks you.
  if (!canManageRole(myRole, target.role) || !canManageRole(myRole, newRole)) {
    throw errors.forbidden("You can't assign a role above your own authority.");
  }

  // Never strip the last owner — the org would be left with no one who can manage it.
  if (target.role === "owner" && newRole !== "owner") {
    const owners = await prisma.membership.count({ where: { orgId, role: "owner" } });
    if (owners <= 1) {
      throw errors.validation("This is the last owner — promote another owner first.");
    }
  }

  await prisma.membership.update({ where: { id: target.id }, data: { role: newRole } });
  return c.json({ ok: true, userId: targetUserId, role: newRole });
});

// DELETE /app/team/:userId — remove a member (or leave, if it's yourself).
team.delete("/:userId", async (c) => {
  const orgId = c.get("orgId");
  const actorId = c.get("userId");
  const targetUserId = c.req.param("userId");
  const myRole = await actorRole(orgId, actorId);
  const removingSelf = targetUserId === actorId;

  // Anyone may leave; removing someone else needs the remove permission.
  if (!removingSelf && !can(myRole, "team:remove")) {
    throw errors.forbidden("Only an owner or admin can remove teammates.");
  }

  const target = await prisma.membership.findFirst({
    where: { orgId, userId: targetUserId },
    select: { id: true, role: true },
  });
  if (!target || !isOrgRole(target.role)) throw errors.notFound("That member was not found.");

  if (!removingSelf && !canManageRole(myRole, target.role)) {
    throw errors.forbidden("You can't remove a member who outranks you.");
  }

  if (target.role === "owner") {
    const owners = await prisma.membership.count({ where: { orgId, role: "owner" } });
    if (owners <= 1) {
      throw errors.validation(
        removingSelf
          ? "You're the last owner — transfer ownership before leaving."
          : "This is the last owner — promote another owner first.",
      );
    }
  }

  await prisma.membership.delete({ where: { id: target.id } });
  return c.json({ ok: true, userId: targetUserId, leftSelf: removingSelf });
});

// DELETE /app/team/invites/:id — revoke a pending invite (scoped to the org).
team.delete("/invites/:id", async (c) => {
  const orgId = c.get("orgId");
  const myRole = await actorRole(orgId, c.get("userId"));
  if (!can(myRole, "team:invite")) {
    throw errors.forbidden("Only an owner or admin can manage invites.");
  }
  const id = c.req.param("id");
  // deleteMany scoped by orgId so an id from another tenant can't be revoked.
  const res = await prisma.invite.deleteMany({ where: { id, orgId } });
  if (res.count === 0) throw errors.notFound("That invite was not found.");
  return c.json({ ok: true });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
  );
}
