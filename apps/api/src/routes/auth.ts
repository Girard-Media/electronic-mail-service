import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import {
  env,
  errors,
  ApiError,
  hashPassword,
  verifyPassword,
  enforceFixedWindow,
  verifyInvite,
  can,
  grantedPermissions,
  isOrgRole,
} from "@ems/core";
import { prisma } from "@ems/db";
import {
  sessionAuth,
  SESSION_COOKIE,
  GOD_COOKIE,
  type SessionVars,
} from "../middleware/session.js";
import { grantOperatorPlan, effectiveOrgPlan } from "../lib/operator-plan.js";
import { enqueueEmail } from "../lib/send.js";

export const auth = new Hono<{ Variables: SessionVars }>();

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Outbound (emailed) links MUST be built from the TRUSTED configured origin, never
// the inbound Host header. @hono/node-server derives `new URL(c.req.url).origin`
// from the request's Host, so a spoofed Host would point a legitimate user's
// emailed link at an attacker domain and leak the bound token on click — the
// classic password-reset host-header-injection. The dashboard is served by this
// API, so API_URL is the right base (matches the billing route). Internal
// redirects that must echo the current host intentionally keep using c.req.url.
const TRUSTED_ORIGIN = new URL(env.API_URL).origin;

// Send the "verify your email" message via our own sending path (system domain).
async function sendVerification(
  projectId: string,
  email: string,
  token: string,
): Promise<void> {
  const link = `${TRUSTED_ORIGIN}/auth/verify?token=${token}`;
  try {
    await enqueueEmail(
      projectId,
      {
        from: "ems <hello@electronicmailservices.com>",
        to: email,
        subject: "Verify your ems email",
        html: `<p>Welcome to ems. Confirm this address to finish setting up your account:</p><p><a href="${link}">Verify my email</a></p><p>Or paste this link: ${link}</p>`,
        text: `Welcome to ems. Verify your email: ${link}`,
      } as Parameters<typeof enqueueEmail>[1],
      null,
      { internal: true },
    );
  } catch {
    // Best-effort — never block signup/login on the verification send.
  }
}

// Password-reset token: stateless + single-use. The HMAC key folds in the user's
// CURRENT passwordHash, so once the password changes the token stops verifying —
// no DB column or migration needed. Expires after 1 hour.
function resetKey(pwHash: string | null): string {
  return `${env.AUTH_SECRET}:reset:${pwHash ?? ""}`;
}
function signReset(userId: string, pwHash: string | null): string {
  const payload = `${userId}:${Date.now() + 3_600_000}`;
  const sig = createHmac("sha256", resetKey(pwHash)).update(payload).digest("base64url").slice(0, 32);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}
async function verifyReset(token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [userId, expStr] = payload.split(":");
  if (!userId || !expStr || Date.now() > Number(expStr)) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return null;
  const expect = createHmac("sha256", resetKey(user.passwordHash)).update(payload).digest("base64url").slice(0, 32);
  const got = token.slice(dot + 1);
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? user.id : null;
}

async function userProjectId(userId: string): Promise<string | null> {
  const m = await prisma.membership.findFirst({ where: { userId }, select: { orgId: true } });
  if (!m) return null;
  const p = await prisma.project.findFirst({ where: { orgId: m.orgId }, select: { id: true } });
  return p?.id ?? null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
}

async function issueSession(
  c: Context,
  userId: string,
  tokenVersion: number,
): Promise<void> {
  const token = await sign(
    {
      sub: userId,
      ver: tokenVersion,
      exp: Math.floor(Date.now() / 1000) + MAX_AGE,
    },
    env.AUTH_SECRET,
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

auth.post("/signup", async (c) => {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  await enforceFixedWindow(`signup:ip:${ip}`, 5, 60);
  const p = z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
      // When present, the new user joins the inviting org (at the invited role)
      // instead of getting a fresh org — the team-invite acceptance path.
      inviteToken: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) {
    throw errors.validation(p.error.issues.map((i) => i.message).join("; "));
  }
  const email = p.data.email.toLowerCase();
  await enforceFixedWindow(`signup:email:${email}`, 3, 3600);
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new ApiError(409, "email_taken", "An account with that email already exists.");
  }
  const verifyToken = randomBytes(24).toString("hex");

  // ---- Invite path: join the inviting org, don't create a new one. ----
  if (p.data.inviteToken) {
    const v = verifyInvite(p.data.inviteToken);
    if (!v) throw new ApiError(400, "invalid_invite", "This invite link is invalid or has expired.");
    if (email !== v.email.toLowerCase()) {
      throw new ApiError(400, "invite_email_mismatch", "Sign up with the exact email the invite was sent to.");
    }
    const invite = await prisma.invite.findUnique({
      where: { id: v.inviteId },
      select: { id: true, orgId: true, email: true, role: true, acceptedAt: true },
    });
    // The token's email must match the invite row (the invite is only ever for the
    // exact email it was minted for), and an invite never confers ownership.
    if (
      !invite ||
      invite.acceptedAt ||
      invite.email.toLowerCase() !== email ||
      invite.email.toLowerCase() !== v.email.toLowerCase() ||
      invite.role === "owner"
    ) {
      throw new ApiError(400, "invalid_invite", "This invite is no longer valid — ask for a new one.");
    }
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: p.data.name ?? null,
          passwordHash: hashPassword(p.data.password),
          verifyToken,
        },
      });
      await tx.membership.create({
        data: { orgId: invite.orgId, userId: user.id, role: invite.role },
      });
      // Conditional update = atomic single-use: if another request already accepted
      // this invite, count is 0 and we roll back (the new user is undone).
      const used = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (used.count === 0) {
        throw new ApiError(400, "invalid_invite", "This invite was just used — ask for a new one.");
      }
      return { user };
    });
    const proj = await prisma.project.findFirst({
      where: { orgId: invite.orgId },
      select: { id: true },
    });
    if (proj) await sendVerification(proj.id, email, verifyToken);
    await issueSession(c, created.user.id, created.user.tokenVersion);
    return c.json({
      user: { id: created.user.id, email },
      joinedOrgId: invite.orgId,
      // Dev/e2e only — production never returns the raw token.
      ...(env.NODE_ENV === "production" ? {} : { verifyToken }),
    });
  }

  // ---- Default path: a brand-new org owned by this user. ----
  const orgName = p.data.name || email.split("@")[0] || "org";
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: p.data.name ?? null,
        passwordHash: hashPassword(p.data.password),
        verifyToken,
      },
    });
    const org = await tx.organization.create({
      data: { name: orgName, slug: `${slugify(orgName)}-${Math.random().toString(36).slice(2, 7)}` },
    });
    await tx.membership.create({
      data: { orgId: org.id, userId: user.id, role: "owner" },
    });
    const project = await tx.project.create({
      data: { orgId: org.id, name: "default", slug: "default" },
    });
    return { user, org, project };
  });
  await sendVerification(created.project.id, email, verifyToken);
  await issueSession(c, created.user.id, created.user.tokenVersion);
  return c.json({
    user: { id: created.user.id, email },
    org: { id: created.org.id, name: created.org.name },
    // Dev/e2e only — production never returns the raw token.
    ...(env.NODE_ENV === "production" ? {} : { verifyToken }),
  });
});

// Accept a team invite while already signed in. The session user's email must
// match the invited email (case-insensitive) — preventing invite-stealing — and
// the invite must be unaccepted. Idempotent if already a member.
auth.post("/accept-invite", sessionAuth, async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Invites can't be accepted during an impersonation session.");
  }
  const p = z
    .object({ token: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("An invite token is required.");
  const v = verifyInvite(p.data.token);
  if (!v) throw new ApiError(400, "invalid_invite", "This invite link is invalid or has expired.");
  const invite = await prisma.invite.findUnique({
    where: { id: v.inviteId },
    select: { id: true, orgId: true, email: true, role: true, acceptedAt: true },
  });
  // The token's email must match the invite row, and an invite never grants ownership.
  if (
    !invite ||
    invite.acceptedAt ||
    invite.email.toLowerCase() !== v.email.toLowerCase() ||
    invite.role === "owner"
  ) {
    throw new ApiError(400, "invalid_invite", "This invite is no longer valid — ask for a new one.");
  }
  const user = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { email: true },
  });
  if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new ApiError(
      403,
      "invite_email_mismatch",
      "This invite was sent to a different email. Sign in with that address to accept it.",
    );
  }
  const existing = await prisma.membership.findFirst({
    where: { orgId: invite.orgId, userId: c.get("userId") },
    select: { id: true },
  });
  if (existing) {
    await prisma.invite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    return c.json({ ok: true, orgId: invite.orgId, alreadyMember: true });
  }
  await prisma.$transaction(async (tx) => {
    await tx.membership.create({
      data: { orgId: invite.orgId, userId: c.get("userId"), role: invite.role },
    });
    // Atomic single-use (see signup path): 0 rows updated → someone else took it → roll back.
    const used = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (used.count === 0) {
      throw new ApiError(400, "invalid_invite", "This invite was just used — ask for a new one.");
    }
  });
  return c.json({ ok: true, orgId: invite.orgId });
});

// Public invite preview — lets the sign-in gate show "you've been invited to X"
// and prefill the (non-secret) invited email. Reveals nothing beyond the org name
// and the email the invite was already sent to.
auth.get("/invite", async (c) => {
  const token = c.req.query("token") ?? "";
  const v = verifyInvite(token);
  if (!v) return c.json({ valid: false });
  const invite = await prisma.invite.findUnique({
    where: { id: v.inviteId },
    select: { email: true, role: true, acceptedAt: true, org: { select: { name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.email.toLowerCase() !== v.email.toLowerCase()) {
    return c.json({ valid: false });
  }
  const hasAccount = Boolean(
    await prisma.user.findUnique({
      where: { email: invite.email.toLowerCase() },
      select: { id: true },
    }),
  );
  return c.json({
    valid: true,
    email: invite.email,
    role: invite.role,
    orgName: invite.org?.name ?? "a team",
    hasAccount,
  });
});

auth.post("/login", async (c) => {
  const p = z
    .object({ email: z.string().email(), password: z.string() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Email and password are required.");
  // Brute-force protection: cap attempts per IP and per target email (fixed
  // 1-minute windows). Behind Cloudflare the real client IP is cf-connecting-ip.
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const emailKey = p.data.email.toLowerCase();
  await enforceFixedWindow(`login:ip:${ip}`, 15, 60);
  await enforceFixedWindow(`login:email:${emailKey}`, 7, 60);
  await enforceFixedWindow(`login:email-hour:${emailKey}`, 20, 3600);
  const user = await prisma.user.findUnique({
    where: { email: emailKey },
  });
  if (!user?.passwordHash || !verifyPassword(p.data.password, user.passwordHash)) {
    throw errors.unauthorized();
  }
  await issueSession(c, user.id, user.tokenVersion);
  return c.json({ user: { id: user.id, email: user.email } });
});

// Forgot password: email a reset link. Always 200 (never reveal whether the
// address has an account), rate-limited per IP.
auth.post("/forgot", async (c) => {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  await enforceFixedWindow(`forgot:ip:${ip}`, 8, 60);
  const p = z.object({ email: z.string().email() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Enter your email.");
  const email = p.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });
  if (user) {
    const projectId = await userProjectId(user.id);
    if (projectId) {
      const link = `${TRUSTED_ORIGIN}/dashboard?reset=${signReset(user.id, user.passwordHash)}`;
      try {
        await enqueueEmail(
          projectId,
          {
            from: "EMS <hello@electronicmailservices.com>",
            to: email,
            subject: "Reset your EMS password",
            html: `<p>We received a request to reset your EMS password.</p><p><a href="${link}">Set a new password</a></p><p>Or paste this link: ${link}</p><p>The link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
            text: `Reset your EMS password: ${link} (expires in 1 hour)`,
          } as Parameters<typeof enqueueEmail>[1],
          null,
          { internal: true },
        );
      } catch {
        /* best-effort */
      }
    }
  }
  return c.json({ ok: true });
});

// Complete the reset: set a new password + invalidate existing sessions.
auth.post("/reset", async (c) => {
  const p = z
    .object({ token: z.string().min(1), password: z.string().min(8) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A reset token and a password of at least 8 characters are required.");
  const userId = await verifyReset(p.data.token);
  if (!userId) throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired.");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(p.data.password), tokenVersion: { increment: 1 } },
  });
  return c.json({ ok: true });
});

// Change password while signed in. Verifies the current password, sets the new
// one, and bumps tokenVersion (signing out every OTHER session) — then re-issues
// THIS session so the current tab stays signed in. Blocked during impersonation:
// re-issuing here would mint a non-impersonation cookie and orphan the admin's
// preserved session.
auth.post("/change-password", sessionAuth, async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Password can't be changed during an impersonation session.");
  }
  const p = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) {
    throw errors.validation("Your current password and a new password of at least 8 characters are required.");
  }
  if (p.data.currentPassword === p.data.newPassword) {
    throw errors.validation("Choose a new password that's different from your current one.");
  }
  // Blunt online guessing of the current password.
  await enforceFixedWindow(`chpw:${c.get("userId")}`, 10, 60);
  const user = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { id: true, passwordHash: true },
  });
  if (!user?.passwordHash || !verifyPassword(p.data.currentPassword, user.passwordHash)) {
    throw new ApiError(400, "invalid_password", "Your current password is incorrect.");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(p.data.newPassword), tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  await issueSession(c, user.id, updated.tokenVersion);
  return c.json({ ok: true });
});

// Logout invalidates ALL sessions for the user (bumps tokenVersion) + clears cookie.
auth.post("/logout", sessionAuth, async (c) => {
  await prisma.user.update({
    where: { id: c.get("userId") },
    data: { tokenVersion: { increment: 1 } },
  });
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Sign out everywhere ELSE: bump tokenVersion (kills all sessions) then re-issue
// only the current one, so the user stays signed in here but every other device
// is logged out. Blocked during impersonation (would clobber the admin session).
auth.post("/signout-others", sessionAuth, async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Not available during an impersonation session.");
  }
  const updated = await prisma.user.update({
    where: { id: c.get("userId") },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  await issueSession(c, c.get("userId"), updated.tokenVersion);
  return c.json({ ok: true });
});

auth.get("/me", sessionAuth, async (c) => {
  const user = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, createdAt: true },
  });
  const impersonatorId = c.get("impersonatorId");
  let impersonating: { by: string } | null = null;
  if (impersonatorId) {
    const admin = await prisma.user.findUnique({
      where: { id: impersonatorId },
      select: { email: true },
    });
    impersonating = { by: admin?.email ?? "an admin" };
  } else if (user) {
    // God Mode operators land on Free at signup; lift their own workspace to
    // the unlimited operator plan before we read branding / sub-account gates.
    const admin = await prisma.platformAdmin.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (admin) await grantOperatorPlan(user.id);
  }
  // Per-tenant white-label branding — the dashboard applies this on boot.
  const [org, resolved] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: c.get("orgId") },
      select: { name: true, logoUrl: true, primaryColor: true, poweredBy: true, parentOrgId: true },
    }),
    effectiveOrgPlan(c.get("orgId")),
  ]);
  // The caller's role in the active org — drives which controls the dashboard
  // shows (the server still re-checks every privileged operation).
  const membership = await prisma.membership.findFirst({
    where: { orgId: c.get("orgId"), userId: c.get("userId") },
    select: { role: true },
  });
  // Every org the user belongs to — powers the header org-switcher.
  const memberships = await prisma.membership.findMany({
    where: { userId: c.get("userId") },
    orderBy: { createdAt: "asc" },
    select: { orgId: true, role: true, org: { select: { name: true, parentOrgId: true } } },
  });
  const role = membership?.role ?? null;
  const isSubAccount = Boolean(org?.parentOrgId);
  // Can this user manage sub-accounts here? Needs the permission AND a plan that
  // includes them, and the active org must not itself be a sub-account (one level).
  const canManageSubaccounts =
    isOrgRole(role) &&
    can(role, "subaccount:manage") &&
    resolved.limits.subAccounts &&
    !isSubAccount;
  return c.json({
    user: user
      ? { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }
      : null,
    emailVerified: Boolean(user?.emailVerifiedAt),
    role,
    permissions: grantedPermissions(isOrgRole(role) ? role : null),
    orgId: c.get("orgId"),
    projectId: c.get("projectId"),
    branding: org
      ? {
          name: org.name,
          logoUrl: org.logoUrl,
          primaryColor: org.primaryColor,
          poweredBy: org.poweredBy,
        }
      : null,
    // Org-hierarchy context for the switcher + sub-accounts UI.
    account: {
      activeOrgId: c.get("orgId"),
      name: org?.name ?? null,
      isSubAccount,
      canManageSubaccounts,
      memberships: memberships.map((m) => ({
        orgId: m.orgId,
        name: m.org.name,
        role: m.role,
        isSubAccount: Boolean(m.org.parentOrgId),
      })),
    },
    impersonating,
  });
});

// Click-through email verification. Lands on the dashboard either way.
auth.get("/verify", async (c) => {
  const token = c.req.query("token");
  if (token) {
    const user = await prisma.user.findFirst({ where: { verifyToken: token } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(), verifyToken: null },
      });
      return c.redirect(`${TRUSTED_ORIGIN}/dashboard?verified=1`);
    }
  }
  return c.redirect(`${TRUSTED_ORIGIN}/dashboard?verified=0`);
});

auth.post("/resend-verification", sessionAuth, async (c) => {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  await enforceFixedWindow(`reverify:ip:${ip}`, 8, 60);
  await enforceFixedWindow(`reverify:user:${c.get("userId")}`, 3, 3600);
  const user = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user) throw errors.unauthorized();
  if (user.emailVerifiedAt) return c.json({ ok: true, alreadyVerified: true });
  const verifyToken = randomBytes(24).toString("hex");
  await prisma.user.update({ where: { id: user.id }, data: { verifyToken } });
  await sendVerification(c.get("projectId"), user.email, verifyToken);
  return c.json({ ok: true });
});

// Exit a God Mode impersonation: restore the admin's preserved session. Only
// valid from inside an impersonation session (carries the `imp` claim).
auth.post("/stop-impersonate", sessionAuth, async (c) => {
  const impersonatorId = c.get("impersonatorId");
  if (!impersonatorId) throw errors.validation("Not currently impersonating.");
  const adminToken = getCookie(c, GOD_COOKIE);
  deleteCookie(c, GOD_COOKIE, { path: "/" });
  await prisma.platformAuditLog.create({
    data: {
      actorUserId: impersonatorId,
      action: "impersonate.stop",
      targetType: "user",
      targetId: c.get("userId"),
    },
  });
  if (!adminToken) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true, restored: false });
  }
  setCookie(c, SESSION_COOKIE, adminToken, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return c.json({ ok: true, restored: true });
});
