import { prisma } from "@ems/db";

/** Org owner has a verified login email — the abuse gate for platform-hosted From. */
export async function orgOwnerEmailVerified(orgId: string): Promise<boolean> {
  const owner = await prisma.membership.findFirst({
    where: { orgId, role: "owner" },
    select: { user: { select: { emailVerifiedAt: true } } },
  });
  return Boolean(owner?.user.emailVerifiedAt);
}
