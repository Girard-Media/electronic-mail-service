/**
 * @ems/ai — the single entry point to inference (planning/AI.md).
 *
 * RULES, enforced by CI lint rules:
 *  - No AI call from a route handler. Routes enqueue; workers call (E17-003/004).
 *  - Every task has a Zod output schema. Unvalidated output never returns.
 *  - AI is never the last word on a compliance or send decision. It advises;
 *    @ems/policy and @ems/router decide. An AI outage must not stop sending.
 */

export type TaskId =
  | "copy.sequence"
  | "copy.subjects"
  | "risk.content"
  | "personalize.line"
  | "classify.reply"
  | "classify.bounce"
  | "advise.deliverability"
  | "optimize.sequence"
  | "score.lead"
  | "check.compliance"
  | "narrate.anomaly"
  | "embed.text";

export type TaskClass = "classify" | "generate" | "reason" | "embed";

export const TASK_CLASS: Record<TaskId, TaskClass> = {
  "copy.sequence": "generate",
  "copy.subjects": "generate",
  "risk.content": "classify",
  "personalize.line": "generate",
  "classify.reply": "classify",
  "classify.bounce": "classify",
  "advise.deliverability": "reason",
  "optimize.sequence": "reason",
  "score.lead": "classify",
  "check.compliance": "classify",
  "narrate.anomaly": "reason",
  "embed.text": "embed",
};

/**
 * Every task states what happens when inference is unavailable. There is no
 * task whose degraded mode is "fail" — that is what keeps an AI outage from
 * stopping the product (E17-022, E17-023).
 */
export const DEGRADED_MODE: Record<TaskId, string> = {
  "copy.sequence": "template library",
  "copy.subjects": "template library plus the rules scorer",
  "risk.content": "rspamd score alone",
  "personalize.line": "skip the token; send without",
  "classify.reply": "keyword rules; route ambiguous to a human",
  "classify.bounce": "taxonomy table only (it is the primary classifier anyway)",
  "advise.deliverability": "show the raw metrics",
  "optimize.sequence": "disabled",
  "score.lead": "firmographic rules",
  "check.compliance": "rules checklist (the primary gate regardless)",
  "narrate.anomaly": "raw event list",
  "embed.text": "disabled",
};

export interface AiTaskConfig {
  taskId: TaskId;
  model: string;
  fallbackChain: string[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  promptVersion: string;
  enabled: boolean;
  cacheTtlSec: number;
}

export interface RunContext {
  orgId: string | null;
  /** Per-org AI opt-out disables the feature visibly, never silently (E17-035). */
  aiEnabled: boolean;
  budgetRemainingTokens: number;
}

export interface RunResult<T> {
  output: T;
  degraded: boolean;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  confidence: number | null;
}

/**
 * Inbound replies and scraped enrichment text are UNTRUSTED. Wrap them so the
 * system prompt can state that content inside is data, never instructions
 * (planning/AI.md §7). Classification outputs are constrained enums, so an
 * injected instruction cannot produce an out-of-schema value.
 */
export function wrapUntrusted(content: string, label = "UNTRUSTED_CONTENT"): string {
  const fence = `<<<${label}>>>`;
  return `${fence}\n${content.replaceAll(fence, "")}\n${fence}`;
}

export class NotImplemented extends Error {
  constructor(task: string) {
    super(`not implemented — see ${task} in planning/TODO.md`);
    this.name = "NotImplemented";
  }
}

export async function run<T>(_taskId: TaskId, _input: unknown, _ctx: RunContext): Promise<RunResult<T>> {
  throw new NotImplemented("E17-001..E17-035");
}
