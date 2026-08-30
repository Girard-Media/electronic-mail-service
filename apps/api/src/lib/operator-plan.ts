import {
  OPERATOR_PLAN,
  effectivePlanId,
  planLimits,
  type PlanLimits,
} from "@ems/core";
import { prisma } from "@ems/db";

// God Mode operators run the platform — their own (top-level) workspaces must
// not be capped by the Free plan they signed up on. Sub-accounts stay on whatever
// plan they were given so a client org never silently becomes unlimited.

function topLevelOwnedIds(
  rows: Array<{ orgId: string; org: { parentOrgId: string | null; plan: string } }>,
): string[] {
  return rows
    .filter((m) => m.org.parentOrgId == null && m.org.plan !== OPERATOR_PLAN)
    .map((m) => m.orgId);
}

export async function grantOperatorPlan(userId: string): Promise<number> {
  const owned = await prisma.membership.findMany({
    where: { userId, role: "owner" },
    select: { orgId: true, org: { select: { parentOrgId: true, plan: true } } },
  });
  const ids = topLevelOwnedIds(owned);
  if (ids.length === 0) return 0;
  const { count } = await prisma.organization.updateMany({
    where: { id: { in: ids } },
    data: { plan: OPERATOR_PLAN },
  });
  return count;
}

export async function effectiveOrgPlan(orgId: string): Promise<{
  plan: string;
  limits: PlanLimits;
  operator: boolean;
}> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true, parentOrgId: true },
  });
  if (!org) {
    return { plan: "free", limits: planLimits("free"), operator: false };
  }
  if (org.parentOrgId) {
    const plan = effectivePlanId(org.plan, { parentOrgId: org.parentOrgId });
    return { plan, limits: planLimits(plan), operator: false };
  }
  if (org.plan === OPERATOR_PLAN) {
    return { plan: OPERATOR_PLAN, limits: planLimits(OPERATOR_PLAN), operator: true };
  }

  const owners = await prisma.membership.findMany({
    where: { orgId, role: "owner" },
    select: { userId: true },
  });
  const ownerIds = owners.map((o) => o.userId);
  const operatorOwner = ownerIds.length
    ? await prisma.platformAdmin.findFirst({
        where: { userId: { in: ownerIds } },
        select: { id: true },
      })
    : null;

  const plan = effectivePlanId(org.plan, {
    parentOrgId: org.parentOrgId,
    ownerIsPlatformAdmin: Boolean(operatorOwner),
  });
  const operator = Boolean(operatorOwner);

  if (operator && org.plan !== OPERATOR_PLAN) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { plan: OPERATOR_PLAN },
    });
  }

  return { plan, limits: planLimits(plan), operator };
}
