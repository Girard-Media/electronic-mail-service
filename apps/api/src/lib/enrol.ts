import { prisma } from "@ems/db";
import {
  enrolDecision,
  assignVariant,
  scheduleStep,
  resolveTimezone,
  isDeceptiveFirstTouch,
  type EnrollmentState,
} from "@ems/sequence";

export type EnrolResult = {
  leadId: string;
  enrollmentId: string;
  state: EnrollmentState;
  intentId: string | null;
  reason: string | null;
};

export async function enrolLeads(input: {
  orgId: string;
  projectId: string;
  campaignId: string;
  leadIds: string[];
  now?: Date;
}): Promise<{ enrolled: EnrolResult[]; errors: Array<{ leadId: string; message: string }> }> {
  const now = input.now ?? new Date();
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, orgId: input.orgId },
    include: {
      steps: { orderBy: { position: "asc" }, take: 1, include: { variants: true } },
    },
  });
  if (!campaign) throw new Error("campaign missing");

  const first = campaign.steps[0] ?? null;
  const variants = first?.variants ?? [];
  const enrolled: EnrolResult[] = [];
  const errors: Array<{ leadId: string; message: string }> = [];

  for (const leadId of input.leadIds) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, orgId: input.orgId } });
    if (!lead) {
      errors.push({ leadId, message: "Lead not found." });
      continue;
    }
    const existing = await prisma.campaignLead.findUnique({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId } },
    });
    const suppressed = await prisma.suppression.findFirst({
      where: { projectId: input.projectId, address: lead.email.toLowerCase() },
      select: { id: true },
    });
    const weights = variants.map((v) => v.weight);
    const variantIdx = first && variants.length ? assignVariant(lead.id, first.id, weights) : 0;
    const variant = variants[variantIdx] ?? variants[0] ?? null;
    const decision = enrolDecision({
      existingState: (existing?.state as EnrollmentState | undefined) ?? null,
      frozen: Boolean(lead.frozenAt),
      suppressed: Boolean(suppressed),
      hasFirstStep: Boolean(first),
      hasVariant: Boolean(variant),
      isFirstTouch: first?.isFirstTouch,
      firstTouchSubject: variant?.subject,
    });

    if (existing) {
      errors.push({ leadId, message: decision.ok ? "Already enrolled." : decision.message });
      continue;
    }
    if (!decision.ok && (decision.code === "no-first-step" || decision.code === "no-variant" || decision.code === "deceptive-first-touch")) {
      errors.push({ leadId, message: decision.message });
      continue;
    }

    if (!decision.ok && (decision.code === "lead-frozen" || decision.code === "lead-suppressed")) {
      const row = await prisma.campaignLead.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          state: "BLOCKED_BY_POLICY",
          stoppedReason: decision.code,
        },
      });
      enrolled.push({ leadId: lead.id, enrollmentId: row.id, state: "BLOCKED_BY_POLICY", intentId: null, reason: decision.message });
      continue;
    }
    if (!decision.ok) {
      errors.push({ leadId, message: decision.message });
      continue;
    }
    if (!first || !variant) {
      errors.push({ leadId, message: "Add a sequence step before enrolling." });
      continue;
    }
    if (isDeceptiveFirstTouch(variant.subject, first.isFirstTouch)) {
      errors.push({ leadId, message: "A first-touch step cannot use a RE:/FW: subject." });
      continue;
    }

    const tz = resolveTimezone(lead.timezone, lead.country, campaign.fixedTimezone ?? "America/New_York");
    const due = scheduleStep(now, first.delayDays, first.delayHours, {
      window: {
        start: campaign.sendWindowStart,
        end: campaign.sendWindowEnd,
        days: campaign.sendDays,
        timezone: tz.timezone,
      },
      jitterKey: `${lead.id}:${first.id}`,
    });

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.campaignLead.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          state: "ACTIVE",
          currentStep: first.position,
          nextDueAt: due.sendAt,
        },
      });
      const intent = await tx.sendIntent.create({
        data: {
          orgId: input.orgId,
          campaignId: campaign.id,
          stepId: first.id,
          variantId: variant.id,
          leadId: lead.id,
          state: "PENDING",
          dueAt: due.sendAt,
        },
      });
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: "ENROLLED" },
      });
      return { row, intent };
    });

    enrolled.push({
      leadId: lead.id,
      enrollmentId: result.row.id,
      state: "ACTIVE",
      intentId: result.intent.id,
      reason: null,
    });
  }

  return { enrolled, errors };
}
