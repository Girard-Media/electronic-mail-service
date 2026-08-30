/**
 * pnpm ai:eval — the CI gate for AI task quality (E17-058, E17-063).
 *
 * Runs against the DETERMINISTIC fallback classifier by default, so the gate is
 * meaningful with no API key and no spend. With OPENROUTER_API_KEY set it also
 * evaluates the live model, and that result is what gates a prompt change.
 *
 * The rules-only floor is deliberately lower than the model gate: the rules are
 * the degraded mode, not the product. What matters is that the degraded mode is
 * good enough to be honest about.
 */
import {
  evaluateClassification, checkGate, formatConfusion, CLASSIFY_GATE,
  classifyByRules, Gateway, classifyReply, providerFromEnv,
  runAssertions, COPY_ASSERTIONS, scoreSubject,
  type ReplyIntent,
} from "../packages/ai/src/index.js";
import { CLASSIFY_REPLY_FIXTURES } from "../packages/ai/evals/classify-reply.js";
import { AI_TASK_CONFIGS } from "../packages/db/src/seed/ai-task-configs.js";

let failed = false;

// The rules fallback is not expected to hit the model gate — it is the fallback.
// It IS expected to be respectable, and never to miss an unsubscribe.
const RULES_FLOOR = { minAccuracy: 0.8, minPerClassRecall: 0.6 };

console.log("\n=== classify.reply — deterministic fallback ===\n");
const rules = evaluateClassification<Parameters<typeof classifyByRules>[0], ReplyIntent>(
  "classify.reply (rules)",
  CLASSIFY_REPLY_FIXTURES,
  (input) => classifyByRules(input).value,
);
console.log(formatConfusion(rules));
console.log(`\naccuracy ${(rules.accuracy * 100).toFixed(1)}%  (${rules.correct}/${rules.total})`);
for (const f of rules.failures) console.log(`  miss ${f.id}: expected ${f.expected}, got ${f.got}`);

const rulesGate = checkGate(rules, RULES_FLOOR);
if (!rulesGate.passed) { failed = true; for (const r of rulesGate.reasons) console.log(`  ✗ ${r}`); }
else console.log("  ✓ meets the fallback floor");

// Under-suppressing is illegal, so this is a hard gate at any tier.
const unsubRecall = rules.perClassRecall.UNSUBSCRIBE ?? 0;
if (unsubRecall < 1) {
  failed = true;
  console.log(`  ✗ UNSUBSCRIBE recall is ${(unsubRecall * 100).toFixed(0)}% — must be 100%, missing one is illegal`);
} else {
  console.log("  ✓ UNSUBSCRIBE recall is 100%");
}

console.log("\n=== generation assertions ===\n");
const badCopy = [
  "RE: our call last week",
  "ACT NOW — LIMITED TIME OFFER",
  "Guaranteed 100% risk-free results!!",
];
for (const s of badCopy) {
  const r = runAssertions(s, COPY_ASSERTIONS);
  const blocked = scoreSubject(s).blocked;
  console.log(`  ${!r.passed || blocked ? "✓" : "✗"} rejected: "${s.slice(0, 40)}"`);
  if (r.passed && !blocked) failed = true;
}
const goodCopy = "Quick question about your onboarding flow";
const good = runAssertions(goodCopy, COPY_ASSERTIONS);
console.log(`  ${good.passed && !scoreSubject(goodCopy).blocked ? "✓" : "✗"} accepted: "${goodCopy}"`);
if (!good.passed || scoreSubject(goodCopy).blocked) failed = true;

console.log("\n=== task configuration ===\n");
const configured = new Set(AI_TASK_CONFIGS.map((c) => c.taskId));
console.log(`  ${configured.has("classify.reply") ? "✓" : "✗"} classify.reply is routed`);
if (!configured.has("classify.reply")) failed = true;

// ── Live model, only when a key is present.
const provider = providerFromEnv();
if (!provider) {
  console.log("\n(no OPENROUTER_API_KEY — live model eval skipped; the gate above still ran)\n");
} else {
  console.log("\n=== classify.reply — live model ===\n");
  const cfg = AI_TASK_CONFIGS.find((c) => c.taskId === "classify.reply")!;
  const gw = new Gateway({
    provider,
    configFor: () => ({
      model: cfg.model, fallbackChain: cfg.fallbackChain, temperature: cfg.temperature,
      maxTokens: cfg.maxTokens, timeoutMs: cfg.timeoutMs, enabled: true, cacheTtlSec: 0,
    }),
  });
  const results: ReplyIntent[] = [];
  for (const f of CLASSIFY_REPLY_FIXTURES) {
    const r = await gw.run(classifyReply, f.input, { orgId: null, aiEnabled: true });
    results.push(r.output?.value ?? "OTHER");
  }
  let i = 0;
  const live = evaluateClassification("classify.reply (live)", CLASSIFY_REPLY_FIXTURES, () => results[i++]!);
  console.log(formatConfusion(live));
  console.log(`\naccuracy ${(live.accuracy * 100).toFixed(1)}%  (${live.correct}/${live.total})`);
  const liveGate = checkGate(live, CLASSIFY_GATE);
  if (!liveGate.passed) { failed = true; for (const r of liveGate.reasons) console.log(`  ✗ ${r}`); }
  else console.log("  ✓ meets the model gate (92% / 80% per class)");
}

console.log(failed ? "\nEVAL GATE FAILED\n" : "\nEVAL GATE PASSED\n");
process.exit(failed ? 1 : 0);
