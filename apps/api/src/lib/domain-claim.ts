import { prisma } from "@ems/db";
import { errors } from "@ems/core";

/** A verified sending domain is globally unique — whoever proves DKIM first keeps it. */
export async function assertVerifiedNameFree(
  name: string,
  exceptProjectId: string,
): Promise<void> {
  const taken = await prisma.domain.findFirst({
    where: { name, status: "verified", NOT: { projectId: exceptProjectId } },
    select: { id: true },
  });
  if (taken) throw errors.domainTaken(name);
}

export async function markDomainVerified(id: string, name: string, projectId: string): Promise<void> {
  await assertVerifiedNameFree(name, projectId);
  try {
    await prisma.domain.update({
      where: { id },
      data: { status: "verified", verifiedAt: new Date() },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") throw errors.domainTaken(name);
    throw e;
  }
}
