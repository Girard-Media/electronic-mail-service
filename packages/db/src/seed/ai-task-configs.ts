/**
 * AI task routing (E02-068). Model ids are config so an operator can re-route a
 * task without a deploy, and a model deprecation is a config change.
 *
 * Classify-class tasks run high volume and go to a small fast model; only the
 * hardest reasoning tasks get the expensive tier. Every task has a documented
 * degraded mode in packages/ai — none of them fail hard.
 */
export interface AiTaskConfigSeed {
  taskId: string;
  model: string;
  fallbackChain: string[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  promptVersion: string;
  cacheTtlSec: number;
}

const FAST = "anthropic/claude-haiku-4.5";
const STRONG = "anthropic/claude-sonnet-5";
const STRONGEST = "anthropic/claude-opus-5";

export const AI_TASK_CONFIGS: AiTaskConfigSeed[] = [
  { taskId: "copy.sequence",          model: STRONG,    fallbackChain: [FAST],   temperature: 0.7, maxTokens: 2048, timeoutMs: 60000, promptVersion: "v1", cacheTtlSec: 0 },
  { taskId: "copy.subjects",          model: STRONG,    fallbackChain: [FAST],   temperature: 0.8, maxTokens: 1024, timeoutMs: 30000, promptVersion: "v1", cacheTtlSec: 0 },
  { taskId: "risk.content",           model: FAST,      fallbackChain: [],       temperature: 0.0, maxTokens: 512,  timeoutMs: 15000, promptVersion: "v1", cacheTtlSec: 86400 },
  { taskId: "personalize.line",       model: STRONG,    fallbackChain: [FAST],   temperature: 0.6, maxTokens: 256,  timeoutMs: 30000, promptVersion: "v1", cacheTtlSec: 604800 },
  { taskId: "classify.reply",         model: FAST,      fallbackChain: [STRONG], temperature: 0.0, maxTokens: 256,  timeoutMs: 15000, promptVersion: "v1", cacheTtlSec: 604800 },
  { taskId: "classify.bounce",        model: FAST,      fallbackChain: [],       temperature: 0.0, maxTokens: 256,  timeoutMs: 15000, promptVersion: "v1", cacheTtlSec: 2592000 },
  { taskId: "advise.deliverability",  model: STRONGEST, fallbackChain: [STRONG], temperature: 0.2, maxTokens: 2048, timeoutMs: 90000, promptVersion: "v1", cacheTtlSec: 3600 },
  { taskId: "optimize.sequence",      model: STRONGEST, fallbackChain: [STRONG], temperature: 0.3, maxTokens: 2048, timeoutMs: 90000, promptVersion: "v1", cacheTtlSec: 3600 },
  { taskId: "score.lead",             model: FAST,      fallbackChain: [],       temperature: 0.0, maxTokens: 256,  timeoutMs: 15000, promptVersion: "v1", cacheTtlSec: 604800 },
  { taskId: "check.compliance",       model: FAST,      fallbackChain: [STRONG], temperature: 0.0, maxTokens: 512,  timeoutMs: 20000, promptVersion: "v1", cacheTtlSec: 86400 },
  { taskId: "narrate.anomaly",        model: STRONG,    fallbackChain: [FAST],   temperature: 0.3, maxTokens: 1024, timeoutMs: 45000, promptVersion: "v1", cacheTtlSec: 900 },
  { taskId: "embed.text",             model: "openai/text-embedding-3-small", fallbackChain: [], temperature: 0, maxTokens: 0, timeoutMs: 20000, promptVersion: "v1", cacheTtlSec: 2592000 },
];
