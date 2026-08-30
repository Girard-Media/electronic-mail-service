import { Hono } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie } from "hono/cookie";
import { prisma, Prisma } from "@ems/db";
import { errors, can, isOrgRole, computeBill, type OrgRole } from "@ems/core";
import { sessionAuth, type SessionVars, ACTIVE_ORG_COOKIE } from "../middleware/session.js";
import { effectiveOrgPlan } from "../lib/operator-plan.js";

// Sub-accounts (agency / reseller layer). A sub-account is a child org with
// parentOrgId = the agency. The agency lists/creates them and switches the active
// session context into one to manage it. Mounted under /app/subaccounts.
//
// Security model: every read/write is scoped to the SESSION org (the active org),
// never a client-supplied id. Switching is the only way to change context, and it
// is membership-checked OR parent-checked (an agency admin may switch into a child
// of their org; doing so provisions an owner membership so all downstream RBAC is
// uniform — there is no "ghost" access without a real membership row).
export const subaccounts = new Hono<{ Variables: SessionVars }>();
subaccounts.use("*", sessionAuth);

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matches the session cookie

async function actorRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const m = await prisma.membership.findFirst({
    where: { orgId, userId },
    select: { role: true },
  });
  return m && isOrgRole(m.role) ? m.role : null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "team";
}

// Reseller-compliance audit trail. Records a privileged action an agency member
// took on a client sub-account, scoped to the agency org (orgId) with the child as
// the target. Mirrors the platform `audit()` helper but writes the org-scoped table
// so the agency itself can read its own trail. Per-org, not platform-admin.
async function auditOrg(
  orgId: string,
  actorUserId: string,
  action: string,
  target: { id: string; type?: string; meta?: Record<string, unknown> },
) {
  await prisma.orgAuditLog.create({
    data: {
      orgId,
      actorUserId,
      action,
      targetType: target.type ?? "org",
      targetId: target.id,
      meta: (target.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

// GET /app/subaccounts — the active (agency) org's children + light usage.
subaccounts.get("/", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const role = await actorRole(orgId, userId);
  if (!can(role, "subaccount:manage")) {
    throw errors.forbidden("Only an owner or admin can manage sub-accounts.");
  }
  const [agency, resolved, children] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { parentOrgId: true },
    }),
    effectiveOrgPlan(orgId),
    prisma.organization.findMany({
      where: { parentOrgId: orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        plan: true,
        createdAt: true,
        _count: { select: { memberships: true } },
        projects: { select: { _count: { select: { domains: true } } } },
      },
    }),
  ]);
  const period = new Date().toISOString().slice(0, 7);
  const ids = children.map((ch) => ch.id);
  const usage = ids.length
    ? await prisma.usageRecord.groupBy({
        by: ["orgId"],
        where: { orgId: { in: ids }, period },
        _sum: { sends: true },
      })
    : [];
  const sends = new Map(usage.map((u) => [u.orgId, u._sum.sends ?? 0]));
  const mine = ids.length
    ? await prisma.membership.findMany({
        where: { userId, orgId: { in: ids } },
        select: { orgId: true },
      })
    : [];
  const member = new Set(mine.map((m) => m.orgId));
  return c.json({
    // The agency itself can only spawn sub-accounts if its plan allows and it isn't
    // already a sub-account (one level of nesting).
    canCreate: Boolean(resolved.limits.subAccounts) && !agency?.parentOrgId,
    data: children.map((ch) => ({
      id: ch.id,
      name: ch.name,
      plan: ch.plan,
      createdAt: ch.createdAt,
      members: ch._count.memberships,
      domains: ch.projects.reduce((n, p) => n + p._count.domains, 0),
      sends: sends.get(ch.id) ?? 0,
      isMember: member.has(ch.id),
    })),
  });
});

// GET /app/subaccounts/audit — the active (agency) org's reseller-compliance trail:
// who opened or created which client sub-account, and when. Read-only.
subaccounts.get("/audit", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const role = await actorRole(orgId, userId);
  if (!can(role, "subaccount:manage")) {
    throw errors.forbidden("Only an owner or admin can view the audit log.");
  }
  const rows = await prisma.orgAuditLog.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
  const targetIds = [...new Set(rows.map((r) => r.targetId).filter((x): x is string => Boolean(x)))];
  const [actors, targets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }),
    prisma.organization.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } }),
  ]);
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));
  const targetName = new Map(targets.map((t) => [t.id, t.name]));
  return c.json({
    data: rows.map((r) => {
      // Prefer the live org name; fall back to the name captured in meta at the time
      // (so a since-deleted client still reads sensibly), then the raw id.
      const captured = (r.meta as { name?: string } | null)?.name;
      return {
        id: r.id,
        actor: actorEmail.get(r.actorUserId) ?? r.actorUserId,
        action: r.action,
        target: (r.targetId && targetName.get(r.targetId)) || captured || r.targetId,
        createdAt: r.createdAt,
      };
    }),
  });
});

// GET /app/subaccounts/billing — this period's usage→cost rollup for the agency
// and each client sub-account, so the agency can invoice. Reuses the same
// usageRecord/period machinery as /plan, over [agency, ...children] in one query.
// Read-only; scoped to the active org; gated by subaccount:manage.
subaccounts.get("/billing", async (c) => {
  const orgId = c.get("orgId");
  const role = await actorRole(orgId, c.get("userId"));
  if (!can(role, "subaccount:manage")) {
    throw errors.forbidden("Only an owner or admin can view billing.");
  }
  const [agency, children, resolved] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.organization.findMany({
      where: { parentOrgId: orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, plan: true },
    }),
    effectiveOrgPlan(orgId),
  ]);
  const period = new Date().toISOString().slice(0, 7);
  const allIds = [orgId, ...children.map((ch) => ch.id)];
  const usage = await prisma.usageRecord.groupBy({
    by: ["orgId"],
    where: { orgId: { in: allIds }, period },
    _sum: { sends: true },
  });
  const sendsBy = new Map(usage.map((u) => [u.orgId, u._sum.sends ?? 0]));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const line = (id: string, name: string, plan: string | null | undefined) => ({
    orgId: id,
    name,
    ...computeBill(plan, sendsBy.get(id) ?? 0),
  });

  const childLines = children.map((ch) => line(ch.id, ch.name, ch.plan));
  // Sum only list-priced children — enterprise/custom lines are quotes, surfaced
  // via hasCustom rather than folded into an auto-total.
  const totals = childLines.reduce(
    (t, l) => ({
      // Billable summary: exclude custom (quote) lines from every total, volume included.
      usedSends: t.usedSends + (l.custom ? 0 : l.usedSends),
      monthlyUsd: round2(t.monthlyUsd + (l.custom ? 0 : l.monthlyUsd)),
      overageUsd: round2(t.overageUsd + (l.custom ? 0 : l.overageUsd)),
      totalUsd: round2(t.totalUsd + (l.custom ? 0 : l.totalUsd)),
    }),
    { usedSends: 0, monthlyUsd: 0, overageUsd: 0, totalUsd: 0 },
  );
  return c.json({
    period,
    currency: "USD",
    agency: line(orgId, agency?.name ?? "My account", resolved.plan),
    children: childLines,
    totals,
    hasCustom: childLines.some((l) => l.custom),
  });
});

// POST /app/subaccounts — create a child org (+ default project + creator as owner).
subaccounts.post("/", async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const [role, agency, resolved] = await Promise.all([
    actorRole(orgId, userId),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { parentOrgId: true },
    }),
    effectiveOrgPlan(orgId),
  ]);
  if (!can(role, "subaccount:manage")) {
    throw errors.forbidden("Only an owner or admin can create sub-accounts.");
  }
  if (!resolved.limits.subAccounts) {
    throw errors.planLimit("Sub-accounts need the white-label plan. Upgrade to manage client accounts.");
  }
  if (agency?.parentOrgId) {
    throw errors.forbidden("A sub-account can't create its own sub-accounts.");
  }
  const p = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A name (1–80 characters) is required.");
  const name = p.data.name;
  const child = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`,
        plan: "free",
        parentOrgId: orgId,
      },
    });
    await tx.project.create({ data: { orgId: org.id, name: "default", slug: "default" } });
    await tx.membership.create({ data: { orgId: org.id, userId, role: "owner" } });
    return org;
  });
  await auditOrg(orgId, userId, "subaccount.create", {
    id: child.id,
    meta: { name: child.name },
  });
  return c.json({ id: child.id, name: child.name });
});

// POST /app/subaccounts/switch { orgId } — change the active org. Membership- OR
// parent-checked; a parent-checked switch lazily provisions an admin membership so
// the user truly belongs to the org they're now acting as, and is audited.
subaccounts.post("/switch", async (c) => {
  const userId = c.get("userId");
  if (c.get("impersonatorId")) {
    throw errors.validation("Account switching isn't available during an impersonation session.");
  }
  const p = z
    .object({ orgId: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("An org id is required.");
  const targetId = p.data.orgId;

  let allowed = Boolean(
    await prisma.membership.findFirst({
      where: { userId, orgId: targetId },
      select: { id: true },
    }),
  );

  // Parent-check: is the actor opening this as the managing agency? The target must
  // be a child of an org the user can manage, AND that parent's plan must still
  // include sub-accounts (so a downgraded agency can't keep self-provisioning into
  // clients). This both grants access and flags the open as an agency action to
  // audit — evaluated even when a membership already exists, so every agency open
  // (not just the first, provisioning one) leaves a compliance record.
  const target = await prisma.organization.findUnique({
    where: { id: targetId },
    select: { parentOrgId: true },
  });
  let asAgency = false;
  if (target?.parentOrgId) {
    const parent = await effectiveOrgPlan(target.parentOrgId);
    const parentRole = await actorRole(target.parentOrgId, userId);
    asAgency = parent.limits.subAccounts && can(parentRole, "subaccount:manage");
    if (!allowed && asAgency) {
      // Lazily provision an ADMIN membership — full operational control, but NOT
      // owner: the agency can't seize billing, delete the client org, or remove the
      // client's real owner. ("Only an owner grants owner.")
      await prisma.membership.upsert({
        where: { orgId_userId: { orgId: targetId, userId } },
        update: {},
        create: { orgId: targetId, userId, role: "admin" },
      });
      allowed = true;
    }
  }
  if (!allowed) throw errors.forbidden("You don't have access to that account.");

  // Record the agency opening a client account, scoped to the agency (parent) org.
  if (asAgency && target?.parentOrgId) {
    await auditOrg(target.parentOrgId, userId, "subaccount.open", { id: targetId });
  }

  setCookie(c, ACTIVE_ORG_COOKIE, targetId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return c.json({ ok: true, orgId: targetId });
});

// POST /app/subaccounts/exit — clear the active-org cookie (back to the home org).
subaccounts.post("/exit", async (c) => {
  deleteCookie(c, ACTIVE_ORG_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
