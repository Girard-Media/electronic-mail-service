/**
 * Bounce taxonomy seed (E02-062..E02-066).
 *
 * This table IS the classifier. AI runs only on responses that fall through to
 * UNKNOWN, and its output becomes a *proposed* row for operator approval — so
 * the system gets deterministically better instead of permanently depending on
 * inference (planning/AI.md §3).
 *
 * Lower `priority` wins. ESP-specific rows sit below 100; the generic RFC 3463
 * fallback layer sits above 500.
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

export interface BounceRuleSeed {
  espFamily: string;
  smtpCode: number | null;
  enhancedCode: string | null;
  matchSubstr: string | null;
  classify: BounceClass;
  suppress: boolean;
  backoffMin: number | null;
  priority: number;
  notes?: string;
}

export const BOUNCE_RULES: BounceRuleSeed[] = [
  // ── Google ────────────────────────────────────────────────────────────────
  { espFamily: "google", smtpCode: 550, enhancedCode: "5.1.1", matchSubstr: "does not exist", classify: "HARD", suppress: true, backoffMin: null, priority: 10, notes: "Address does not exist." },
  { espFamily: "google", smtpCode: 550, enhancedCode: "5.2.1", matchSubstr: "disabled", classify: "HARD", suppress: true, backoffMin: null, priority: 10, notes: "Account disabled." },
  { espFamily: "google", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "unsolicited", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 240, priority: 10, notes: "Reputation block. Escalate — do not retry blindly." },
  { espFamily: "google", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "policy", classify: "POLICY", suppress: false, backoffMin: 240, priority: 12 },
  { espFamily: "google", smtpCode: 550, enhancedCode: "5.7.26", matchSubstr: "authenticate", classify: "AUTH", suppress: false, backoffMin: null, priority: 10, notes: "SPF/DKIM/DMARC failure. Sev-1: our own auth broke." },
  { espFamily: "google", smtpCode: 421, enhancedCode: "4.7.0", matchSubstr: "unusual rate", classify: "BLOCK_RATE", suppress: false, backoffMin: 30, priority: 10, notes: "The canonical too-fast signal. Throttle this IP for Google." },
  { espFamily: "google", smtpCode: 421, enhancedCode: "4.7.0", matchSubstr: "temporarily rate limited", classify: "BLOCK_RATE", suppress: false, backoffMin: 30, priority: 11 },
  { espFamily: "google", smtpCode: 452, enhancedCode: "4.2.2", matchSubstr: "over quota", classify: "MAILBOX_FULL", suppress: false, backoffMin: 720, priority: 10 },
  { espFamily: "google", smtpCode: 421, enhancedCode: "4.3.0", matchSubstr: "try again", classify: "SOFT", suppress: false, backoffMin: 15, priority: 20 },

  // ── Microsoft / Outlook ───────────────────────────────────────────────────
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "S3150", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 360, priority: 10, notes: "Blocked for suspected spam from this IP." },
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "S3140", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 360, priority: 10 },
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "S3115", classify: "AUTH", suppress: false, backoffMin: null, priority: 10, notes: "Sender not authenticated (SPF/DKIM)." },
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.7.606", matchSubstr: "banned sending IP", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 1440, priority: 5, notes: "IP on the Microsoft block list. Delisting is a manual request." },
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.4.1", matchSubstr: "Recipient address rejected", classify: "HARD", suppress: true, backoffMin: null, priority: 10 },
  { espFamily: "microsoft", smtpCode: 550, enhancedCode: "5.1.10", matchSubstr: "RESOLVER.ADR.RecipientNotFound", classify: "HARD", suppress: true, backoffMin: null, priority: 10 },
  { espFamily: "microsoft", smtpCode: 452, enhancedCode: "4.3.1", matchSubstr: "Insufficient system resources", classify: "SOFT", suppress: false, backoffMin: 30, priority: 20 },
  { espFamily: "microsoft", smtpCode: 421, enhancedCode: "4.7.500", matchSubstr: "throttled", classify: "BLOCK_RATE", suppress: false, backoffMin: 60, priority: 10 },
  { espFamily: "microsoft", smtpCode: 421, enhancedCode: "4.7.501", matchSubstr: "reputation", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 240, priority: 10 },

  // ── Yahoo / AOL ───────────────────────────────────────────────────────────
  { espFamily: "yahoo", smtpCode: 554, enhancedCode: "5.7.9", matchSubstr: "not accepted for policy reasons", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 360, priority: 10 },
  { espFamily: "yahoo", smtpCode: 421, enhancedCode: "4.7.0", matchSubstr: "TSS04", classify: "BLOCK_RATE", suppress: false, backoffMin: 60, priority: 10, notes: "Yahoo rate limiting." },
  { espFamily: "yahoo", smtpCode: 421, enhancedCode: "4.7.0", matchSubstr: "TSS02", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 240, priority: 10 },
  { espFamily: "yahoo", smtpCode: 554, enhancedCode: "5.7.1", matchSubstr: "dmarc", classify: "AUTH", suppress: false, backoffMin: null, priority: 10 },
  { espFamily: "yahoo", smtpCode: 550, enhancedCode: "5.1.1", matchSubstr: "no such user", classify: "HARD", suppress: true, backoffMin: null, priority: 10 },

  // ── Proofpoint ────────────────────────────────────────────────────────────
  { espFamily: "proofpoint", smtpCode: 550, enhancedCode: "5.7.1", matchSubstr: "blocked using", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 720, priority: 10, notes: "Usually a DNSBL listing referenced in the text." },
  { espFamily: "proofpoint", smtpCode: 550, enhancedCode: "5.1.1", matchSubstr: "user unknown", classify: "HARD", suppress: true, backoffMin: null, priority: 10 },
  { espFamily: "proofpoint", smtpCode: 451, enhancedCode: "4.7.1", matchSubstr: "greylist", classify: "SOFT", suppress: false, backoffMin: 15, priority: 10, notes: "Greylisting — retry on schedule, never treat as failure." },

  // ── Mimecast ──────────────────────────────────────────────────────────────
  { espFamily: "mimecast", smtpCode: 550, enhancedCode: null, matchSubstr: "Envelope blocked", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 720, priority: 10 },
  { espFamily: "mimecast", smtpCode: 550, enhancedCode: null, matchSubstr: "Invalid Recipient", classify: "HARD", suppress: true, backoffMin: null, priority: 10 },
  { espFamily: "mimecast", smtpCode: 451, enhancedCode: null, matchSubstr: "Recipient temporarily unavailable", classify: "SOFT", suppress: false, backoffMin: 30, priority: 20 },

  // ── Barracuda ─────────────────────────────────────────────────────────────
  { espFamily: "barracuda", smtpCode: 550, enhancedCode: null, matchSubstr: "blocked by Barracuda", classify: "BLOCK_REPUTATION", suppress: false, backoffMin: 720, priority: 10 },
  { espFamily: "barracuda", smtpCode: 550, enhancedCode: null, matchSubstr: "Mail not accepted", classify: "POLICY", suppress: false, backoffMin: 240, priority: 20 },

  // ── Generic RFC 3463 fallback layer ───────────────────────────────────────
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.1.1", matchSubstr: null, classify: "HARD", suppress: true, backoffMin: null, priority: 500, notes: "Bad destination mailbox address." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.1.2", matchSubstr: null, classify: "HARD", suppress: true, backoffMin: null, priority: 500, notes: "Bad destination system address." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.1.10", matchSubstr: null, classify: "HARD", suppress: true, backoffMin: null, priority: 500 },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.2.1", matchSubstr: null, classify: "HARD", suppress: true, backoffMin: null, priority: 500, notes: "Mailbox disabled." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.2.2", matchSubstr: null, classify: "MAILBOX_FULL", suppress: false, backoffMin: 720, priority: 500 },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.4.4", matchSubstr: null, classify: "HARD", suppress: true, backoffMin: null, priority: 500, notes: "Unable to route." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "5.7.1", matchSubstr: null, classify: "POLICY", suppress: false, backoffMin: 240, priority: 510, notes: "Delivery not authorised — generic policy refusal." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "4.2.2", matchSubstr: null, classify: "MAILBOX_FULL", suppress: false, backoffMin: 720, priority: 500 },
  { espFamily: "generic", smtpCode: null, enhancedCode: "4.4.1", matchSubstr: null, classify: "SOFT", suppress: false, backoffMin: 30, priority: 500, notes: "No answer from host." },
  { espFamily: "generic", smtpCode: null, enhancedCode: "4.7.1", matchSubstr: null, classify: "BLOCK_RATE", suppress: false, backoffMin: 60, priority: 510 },
  { espFamily: "generic", smtpCode: 552, enhancedCode: null, matchSubstr: null, classify: "MAILBOX_FULL", suppress: false, backoffMin: 720, priority: 520 },
  { espFamily: "generic", smtpCode: 554, enhancedCode: null, matchSubstr: null, classify: "POLICY", suppress: false, backoffMin: 240, priority: 530 },
  { espFamily: "generic", smtpCode: 450, enhancedCode: null, matchSubstr: null, classify: "SOFT", suppress: false, backoffMin: 30, priority: 540 },
  { espFamily: "generic", smtpCode: 451, enhancedCode: null, matchSubstr: null, classify: "SOFT", suppress: false, backoffMin: 30, priority: 540 },
  { espFamily: "generic", smtpCode: 452, enhancedCode: null, matchSubstr: null, classify: "SOFT", suppress: false, backoffMin: 60, priority: 540 },
];
