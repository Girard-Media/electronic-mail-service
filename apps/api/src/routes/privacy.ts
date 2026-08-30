import { Hono } from "hono";
import { z } from "zod";
import { deleteCookie } from "hono/cookie";
import { prisma } from "@ems/db";
import {
  errors,
  enforceFixedWindow,
  verifyPassword,
  accountDeleteDecision,
  accountDeleteBlockedMessage,
} from "@ems/core";
import { sessionAuth, SESSION_COOKIE, type SessionVars } from "../middleware/session.js";

// GDPR stubs: export the signed-in user's account inventory, or delete the
// user (and sole-owned orgs). Mounted under /app/privacy.
export const privacy = new Hono<{ Variables: SessionVars }>();

privacy.use("*", sessionAuth);

privacy.get("/export", async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Not available during an impersonation session.");
  }
  const userId = c.get("userId");
  await enforceFixedWindow(`privacy-export:${userId}`, 10, 3600);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      createdAt: true,
    },
  });
  if (!user) throw errors.unauthorized();

  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      createdAt: true,
      org: {
        select: {
          id: true,
          name: true,
          plan: true,
          createdAt: true,
          projects: {
            select: {
              id: true,
              name: true,
              slug: true,
              createdAt: true,
              _count: {
                select: {
                  domains: true,
                  apiKeys: true,
                  emails: true,
                  suppressions: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const projectIds = memberships.flatMap((m) => m.org.projects.map((p) => p.id));
  const [domainRows, mailboxRows, emailRows, suppressionRows, webhookRows] = projectIds.length
    ? await Promise.all([
        prisma.domain.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, name: true, status: true, createdAt: true },
        }),
        prisma.mailbox.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, address: true, status: true, createdAt: true },
        }),
        prisma.email.findMany({
          where: { projectId: { in: projectIds } },
          orderBy: { createdAt: "desc" },
          take: 500,
          select: {
            id: true, projectId: true, from: true, to: true, subject: true,
            status: true, createdAt: true,
          },
        }),
        prisma.suppression.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, address: true, reason: true, createdAt: true },
        }),
        prisma.webhookEndpoint.findMany({
          where: { projectId: { in: projectIds } },
          select: { projectId: true, url: true, enabled: true, createdAt: true },
        }),
      ])
    : [[], [], [], [], []];

  return c.json({
    exportedAt: new Date().toISOString(),
    note: "Message bodies, API keys, DKIM material, and webhook signing secrets are omitted.",
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    },
    memberships: memberships.map((m) => ({
      orgId: m.org.id,
      orgName: m.org.name,
      plan: m.org.plan,
      role: m.role,
      memberSince: m.createdAt,
      orgCreatedAt: m.org.createdAt,
      projects: m.org.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        createdAt: p.createdAt,
        counts: p._count,
        domains: domainRows.filter((d) => d.projectId === p.id).map(({ projectId: _p, ...rest }) => rest),
        mailboxes: mailboxRows.filter((d) => d.projectId === p.id).map(({ projectId: _p, ...rest }) => rest),
        emails: emailRows.filter((d) => d.projectId === p.id).map(({ projectId: _p, ...rest }) => rest),
        suppressions: suppressionRows.filter((d) => d.projectId === p.id).map(({ projectId: _p, ...rest }) => rest),
        webhooks: webhookRows.filter((d) => d.projectId === p.id).map(({ projectId: _p, ...rest }) => rest),
      })),
    })),
  });
});

privacy.post("/delete", async (c) => {
  if (c.get("impersonatorId")) {
    throw errors.validation("Not available during an impersonation session.");
  }
  const userId = c.get("userId");
  await enforceFixedWindow(`privacy-delete:${userId}`, 5, 3600);

  const p = z
    .object({ password: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Confirm with your password.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash || !verifyPassword(p.data.password, user.passwordHash)) {
    throw errors.validation("That password is incorrect.");
  }

  if (await prisma.platformAdmin.findUnique({ where: { userId }, select: { id: true } })) {
    throw errors.conflict(
      "account_not_deletable",
      "Platform admin accounts can't self-delete. Remove the admin grant first.",
    );
  }

  const owned = await prisma.membership.findMany({
    where: { userId, role: "owner" },
    select: {
      orgId: true,
      org: { select: { name: true, _count: { select: { memberships: true, subTenants: true } } } },
    },
  });
  const decision = accountDeleteDecision(
    owned.map((m) => ({
      orgId: m.orgId,
      name: m.org.name,
      otherMemberCount: Math.max(0, m.org._count.memberships - 1),
      subaccountCount: m.org._count.subTenants,
    })),
  );
  if (decision.action === "blocked") {
    throw errors.conflict("account_has_members", accountDeleteBlockedMessage(decision.orgNames));
  }

  await prisma.$transaction(async (tx) => {
    if (decision.deleteOrgIds.length) {
      await tx.organization.deleteMany({ where: { id: { in: decision.deleteOrgIds } } });
    }
    await tx.user.delete({ where: { id: userId } });
  });

  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true, deleted: true });
});
