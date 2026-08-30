/**
 * @ems/deliverability — bounce taxonomy, placement, DMARC and TLS-RPT.
 *
 * The taxonomy is DETERMINISTIC and table-driven. AI runs only on responses the
 * table does not match, and its output becomes a *proposed* rule row for
 * operator approval — so the system gets deterministically better over time
 * instead of permanently depending on inference (planning/AI.md §3).
 */

export type BounceClass =
  | "HARD"
  | "SOFT"
  | "BLOCK_REPUTATION"
  | "BLOCK_CONTENT"
  | "BLOCK_RATE"
  | "MAILBOX_FULL"
  | "POLICY"
  | "AUTH"
  | "UNKNOWN";

export type BounceAction =
  | { kind: "suppress" }
  | { kind: "retry"; backoffMin: number }
  | { kind: "throttle-esp"; minutes: number }
  | { kind: "pause-campaign" }
  | { kind: "escalate"; severity: "sev1" | "sev2" };

/** UNKNOWN is a work queue, not a shrug (E09-004). */
export const ACTION_BY_CLASS: Record<BounceClass, BounceAction> = {
  HARD: { kind: "suppress" },
  SOFT: { kind: "retry", backoffMin: 60 },
  BLOCK_REPUTATION: { kind: "escalate", severity: "sev2" },
  BLOCK_CONTENT: { kind: "pause-campaign" },
  BLOCK_RATE: { kind: "throttle-esp", minutes: 30 },
  MAILBOX_FULL: { kind: "retry", backoffMin: 720 },
  POLICY: { kind: "suppress" },
  AUTH: { kind: "escalate", severity: "sev1" },
  UNKNOWN: { kind: "retry", backoffMin: 120 },
};

export interface SmtpResponse {
  espFamily: string;
  code: number;
  enhanced: string | null;
  /** The receiving MX's exact text. Never summarised at parse time (E08-006). */
  raw: string;
}

export interface BounceRuleRow {
  id: string;
  espFamily: string;
  smtpCode: number | null;
  enhancedCode: string | null;
  matchSubstr: string | null;
  classify: BounceClass;
  priority: number;
  approved: boolean;
}

export function classify(res: SmtpResponse, rules: BounceRuleRow[]): BounceClass {
  const matches = rules
    .filter((r) => r.approved)
    .filter((r) => r.espFamily === res.espFamily || r.espFamily === "generic")
    .filter((r) => r.smtpCode === null || r.smtpCode === res.code)
    .filter((r) => r.enhancedCode === null || r.enhancedCode === res.enhanced)
    .filter((r) => r.matchSubstr === null || res.raw.toLowerCase().includes(r.matchSubstr.toLowerCase()))
    .sort((a, b) => a.priority - b.priority);
  return matches[0]?.classify ?? "UNKNOWN";
}

export type PlacementFolder =
  | "PRIMARY" | "PROMOTIONS" | "UPDATES" | "SOCIAL" | "SPAM" | "MISSING" | "UNKNOWN";

export interface PlacementSummary {
  provider: string;
  byFolder: Record<PlacementFolder, number>;
  sampleSize: number;
  /** Excludes Promotions. A Promotions landing is never presented as an inbox landing. */
  inboxRate: number;
  observedAt: Date;
}

export function inboxRate(byFolder: Record<PlacementFolder, number>): number {
  const total = Object.values(byFolder).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return (byFolder.PRIMARY ?? 0) / total;
}
