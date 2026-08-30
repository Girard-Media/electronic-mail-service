/**
 * Idempotent seed runner (E02-073). Safe to run on production, every deploy.
 *
 *   pnpm db:seed
 *
 * Everything here is reference data the send path depends on: without the
 * jurisdiction rows the policy gate blocks everything (correctly), and without
 * the bounce rules every response classifies as UNKNOWN.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "../generated/index.js";
import { JURISDICTION_POLICIES } from "./jurisdiction-policy.js";
import { BOUNCE_RULES } from "./bounce-rules.js";
import { WARMUP_PLANS } from "./warmup-plans.js";
import { AI_TASK_CONFIGS } from "./ai-task-configs.js";
import { GLOBAL_SUPPRESSIONS } from "./global-suppression.js";

export function suppressionHash(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export async function seed(prisma: PrismaClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // ── Jurisdiction policy. Versioned: a change writes a new version rather than
  //    mutating history, so a past decision still resolves the rule then in force.
  for (const j of JURISDICTION_POLICIES) {
    await prisma.jurisdictionPolicy.upsert({
      where: { countryCode_version: { countryCode: j.countryCode, version: 1 } },
      create: {
        countryCode: j.countryCode,
        regime: j.regime,
        outcome: j.outcome,
        allowedBases: j.allowedBases,
        citation: j.citation,
        notes: j.notes ?? null,
        version: 1,
      },
      update: {
        regime: j.regime,
        outcome: j.outcome,
        allowedBases: j.allowedBases,
        citation: j.citation,
        notes: j.notes ?? null,
      },
    });
  }
  counts.jurisdictionPolicy = JURISDICTION_POLICIES.length;

  // ── Bounce rules. Keyed on the tuple that makes a rule unique so re-running
  //    updates in place instead of duplicating the table.
  for (const r of BOUNCE_RULES) {
    const existing = await prisma.bounceRule.findFirst({
      where: {
        espFamily: r.espFamily,
        smtpCode: r.smtpCode,
        enhancedCode: r.enhancedCode,
        matchSubstr: r.matchSubstr,
      },
    });
    const data = {
      espFamily: r.espFamily,
      smtpCode: r.smtpCode,
      enhancedCode: r.enhancedCode,
      matchSubstr: r.matchSubstr,
      classify: r.classify,
      suppress: r.suppress,
      backoffMin: r.backoffMin,
      priority: r.priority,
      notes: r.notes ?? null,
      approved: true,
    };
    if (existing) await prisma.bounceRule.update({ where: { id: existing.id }, data });
    else await prisma.bounceRule.create({ data });
  }
  counts.bounceRule = BOUNCE_RULES.length;

  for (const w of WARMUP_PLANS) {
    await prisma.warmupPlan.upsert({ where: { name: w.name }, create: w, update: w });
  }
  counts.warmupPlan = WARMUP_PLANS.length;

  for (const t of AI_TASK_CONFIGS) {
    await prisma.aiTaskConfig.upsert({
      where: { taskId: t.taskId },
      create: { ...t, enabled: true },
      // Model routing is operator-editable at runtime, so a re-seed must not
      // silently revert a deliberate re-route. Only the prompt version moves.
      update: { promptVersion: t.promptVersion },
    });
  }
  counts.aiTaskConfig = AI_TASK_CONFIGS.length;

  // ── Global suppression. Hashed so a GDPR erasure can drop the plaintext and
  //    keep the protection (planning/COMPLIANCE.md §4).
  for (const g of GLOBAL_SUPPRESSIONS) {
    const addressHash = suppressionHash(`domain:${g.domain}`);
    await prisma.globalSuppression.upsert({
      where: { addressHash },
      create: { addressHash, domain: g.domain, reason: g.reason, source: g.source },
      update: { reason: g.reason, source: g.source },
    });
  }
  counts.globalSuppression = GLOBAL_SUPPRESSIONS.length;

  return counts;
}

export {
  JURISDICTION_POLICIES,
  BOUNCE_RULES,
  WARMUP_PLANS,
  AI_TASK_CONFIGS,
  GLOBAL_SUPPRESSIONS,
};
