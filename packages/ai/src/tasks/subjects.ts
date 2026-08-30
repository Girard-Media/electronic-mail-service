/**
 * Task 2: copy.subjects — subject variants with a deterministic risk score.
 *
 * The rules scorer is the primary gate, not the model: an AI risk score may
 * lower a subject's priority, but only deterministic rules reject one.
 */
import { stringListSchema, type TaskDefinition } from "../gateway.js";

export interface SubjectsInput {
  offer: string;
  icp: string;
  count: number;
}

/** Phrases that measurably hurt placement or read as bulk. */
const RISKY_PHRASES: Array<[RegExp, number, string]> = [
  [/\bfree\b/i, 2, "the word 'free'"],
  [/\bguarantee(d)?\b/i, 2, "a guarantee claim"],
  // Separate patterns on purpose: a subject stacking several urgency cues is
  // worse than one, and a single alternation would score them identically.
  [/\bact now\b/i, 3, "'act now'"],
  [/\blimited time\b|\bexpires (today|soon)\b/i, 3, "a limited-time claim"],
  [/\burgent\b|\blast chance\b|\bfinal (notice|reminder)\b/i, 3, "urgency language"],
  [/\b100%\b|\brisk.?free\b/i, 3, "an absolute claim"],
  [/\bclick here\b/i, 2, "'click here'"],
  [/\$\d|\bcash\b|\bincome\b|\bearn \$/i, 2, "a money claim"],
  [/!{2,}/, 3, "multiple exclamation marks"],
  [/^[^a-z]*$/, 3, "ALL CAPS"],
  [/\bre:\s/i, 4, "a fake reply prefix"],
  [/\bfwd?:\s/i, 4, "a fake forward prefix"],
];

export interface SubjectRisk {
  score: number;
  reasons: string[];
  /** Above this the composer refuses the subject outright. */
  blocked: boolean;
}

export const SUBJECT_BLOCK_THRESHOLD = 4;

export function scoreSubject(subject: string): SubjectRisk {
  const reasons: string[] = [];
  let score = 0;
  for (const [re, weight, why] of RISKY_PHRASES) {
    if (re.test(subject)) { score += weight; reasons.push(why); }
  }
  if (subject.length > 60) { score += 1; reasons.push("over 60 characters — truncated on mobile"); }
  if (subject.length < 3) { score += 4; reasons.push("effectively empty"); }
  return { score, reasons, blocked: score >= SUBJECT_BLOCK_THRESHOLD };
}

export const copySubjects: TaskDefinition<SubjectsInput, string[]> = {
  id: "copy.subjects",
  promptVersion: "v1",
  schema: stringListSchema("SubjectList", { min: 1, max: 20, maxLen: 120 }),
  system: () =>
    [
      "You write subject lines for cold business email.",
      "",
      "Hard rules, no exceptions:",
      "- Never begin with RE: or FW: — the message is a first contact and pretending",
      "  otherwise is a deceptive subject line, which is illegal under CAN-SPAM.",
      "- No urgency, no guarantees, no ALL CAPS, no exclamation marks.",
      "- Under 60 characters.",
      "- Make no claim about the recipient you were not given.",
      "",
      'Reply with ONLY a JSON array of strings.',
    ].join("\n"),
  user: (input) =>
    `Offer: ${input.offer}\nAudience: ${input.icp}\nWrite ${input.count} subject lines.`,
  // No template library exists yet, so the honest degraded mode is "none" —
  // the composer prompts the user to write their own rather than inventing copy.
  fallback: () => null,
};
