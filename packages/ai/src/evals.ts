/**
 * Eval harness (E17-055..E17-068).
 *
 * Fixtures with expected outputs, scored with a confusion matrix, gated in CI.
 * A prompt or model change that regresses a task fails the build — that is the
 * entire point, and it is why prompts are versioned files rather than strings.
 *
 * The fixture set is designed to GROW from production: low-confidence and
 * human-corrected cases become fixtures, so the gate gets harder over time
 * rather than rotting.
 */

export interface Fixture<TIn, TOut> {
  id: string;
  input: TIn;
  expected: TOut;
  /** Why this case is in the set — so a future reader can judge whether it still matters. */
  note?: string;
}

export interface ClassificationEvalResult<T extends string> {
  taskId: string;
  total: number;
  correct: number;
  accuracy: number;
  /** actual → expected → count */
  confusion: Record<string, Record<string, number>>;
  perClassRecall: Record<string, number>;
  failures: Array<{ id: string; expected: T; got: T; note?: string }>;
}

export interface EvalGate {
  minAccuracy: number;
  minPerClassRecall: number;
}

/** planning/AI.md §5: ≥92% accuracy, no class below 80% recall. */
export const CLASSIFY_GATE: EvalGate = { minAccuracy: 0.92, minPerClassRecall: 0.8 };

export function evaluateClassification<TIn, T extends string>(
  taskId: string,
  fixtures: Array<Fixture<TIn, T>>,
  classify: (input: TIn) => T,
): ClassificationEvalResult<T> {
  const confusion: Record<string, Record<string, number>> = {};
  const perClassTotal: Record<string, number> = {};
  const perClassHit: Record<string, number> = {};
  const failures: ClassificationEvalResult<T>["failures"] = [];
  let correct = 0;

  for (const f of fixtures) {
    const got = classify(f.input);
    perClassTotal[f.expected] = (perClassTotal[f.expected] ?? 0) + 1;
    confusion[f.expected] ??= {};
    confusion[f.expected]![got] = (confusion[f.expected]![got] ?? 0) + 1;
    if (got === f.expected) {
      correct++;
      perClassHit[f.expected] = (perClassHit[f.expected] ?? 0) + 1;
    } else {
      failures.push({ id: f.id, expected: f.expected, got, note: f.note });
    }
  }

  const perClassRecall: Record<string, number> = {};
  for (const [cls, total] of Object.entries(perClassTotal)) {
    perClassRecall[cls] = total === 0 ? 1 : (perClassHit[cls] ?? 0) / total;
  }

  return {
    taskId,
    total: fixtures.length,
    correct,
    accuracy: fixtures.length === 0 ? 0 : correct / fixtures.length,
    confusion,
    perClassRecall,
    failures,
  };
}

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

export function checkGate<T extends string>(
  r: ClassificationEvalResult<T>,
  gate: EvalGate = CLASSIFY_GATE,
): GateResult {
  const reasons: string[] = [];
  if (r.accuracy < gate.minAccuracy) {
    reasons.push(`accuracy ${(r.accuracy * 100).toFixed(1)}% is below the ${(gate.minAccuracy * 100)}% gate`);
  }
  for (const [cls, recall] of Object.entries(r.perClassRecall)) {
    if (recall < gate.minPerClassRecall) {
      reasons.push(`${cls} recall ${(recall * 100).toFixed(0)}% is below the ${(gate.minPerClassRecall * 100)}% floor`);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

export function formatConfusion(r: ClassificationEvalResult<string>): string {
  const classes = Object.keys(r.confusion).sort();
  const width = Math.max(...classes.map((c) => c.length), 8);
  const head = ["expected".padEnd(width), ...classes.map((c) => c.slice(0, 6).padStart(7))].join("");
  const rows = classes.map((exp) =>
    [exp.padEnd(width), ...classes.map((got) => String(r.confusion[exp]?.[got] ?? 0).padStart(7))].join(""));
  return [head, ...rows].join("\n");
}

/**
 * Generation tasks cannot be scored on equality, so they get hard assertions
 * instead: things that must never appear, and things that must (E17-060/061).
 */
export interface GenerationAssertion {
  name: string;
  check(output: string): boolean;
}

export const NO_FAKE_REPLY_PREFIX: GenerationAssertion = {
  name: "never opens with RE: or FW:",
  check: (s) => !/^\s*(re|fwd?)\s*:/i.test(s),
};
export const NO_URGENCY: GenerationAssertion = {
  name: "no false urgency",
  check: (s) => !/\b(act now|limited time|urgent|last chance)\b/i.test(s),
};
export const NO_GUARANTEE: GenerationAssertion = {
  name: "no guarantee claim",
  check: (s) => !/\b(guarantee(d)?|100%|risk.?free)\b/i.test(s),
};
export const NO_SHOUTING: GenerationAssertion = {
  name: "no ALL CAPS and no multiple exclamation marks",
  check: (s) => !/!{2,}/.test(s) && !(s.length > 8 && s === s.toUpperCase()),
};

export const COPY_ASSERTIONS: GenerationAssertion[] = [
  NO_FAKE_REPLY_PREFIX, NO_URGENCY, NO_GUARANTEE, NO_SHOUTING,
];

export function runAssertions(output: string, assertions: GenerationAssertion[]): GateResult {
  const reasons = assertions.filter((a) => !a.check(output)).map((a) => `failed: ${a.name}`);
  return { passed: reasons.length === 0, reasons };
}
