import { prisma } from "@ems/db";
import { haltEnrollment, haltTargetForIntent, shouldCancelIntent, type HaltTo } from "@ems/sequence";

export async function haltLeadAcrossCampaigns(input: {
  orgId: string;
  leadId: string;
  to: HaltTo;
  reason: string;
}): Promise<{ halted: number; cancelledIntents: number }> {
  const rows = await prisma.campaignLead.findMany({
    where: { leadId: input.leadId, campaign: { orgId: input.orgId }, state: { in: ["PENDING", "ACTIVE"] } },
  });
  let halted = 0;
  let cancelledIntents = 0;
  for (const row of rows) {
    const next = haltEnrollment(row.state, input.to);
    if (!next) continue;
    await prisma.campaignLead.update({
      where: { id: row.id },
      data: { state: next, stoppedReason: input.reason },
    });
    halted += 1;
    const intents = await prisma.sendIntent.findMany({
      where: { campaignId: row.campaignId, leadId: row.leadId },
    });
    const cancelable = intents.filter((i) => shouldCancelIntent(i.state));
    if (cancelable.length) {
      await prisma.sendIntent.updateMany({
        where: { id: { in: cancelable.map((i) => i.id) } },
        data: { state: "CANCELLED" },
      });
      cancelledIntents += cancelable.length;
    }
  }
  if (input.to === "UNSUBSCRIBED") {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: { status: "UNSUBSCRIBED" },
    });
  } else if (input.to === "REPLIED") {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: { status: "REPLIED" },
    });
  }
  return { halted, cancelledIntents };
}

export { haltTargetForIntent };
