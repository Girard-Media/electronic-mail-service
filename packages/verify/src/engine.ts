/**
 * Verification engine (E12-001..E12-035). planning/ARCHITECTURE.md §8.
 *
 * Five stages, short-circuiting. Stages 1–3 and 5 are pure or DNS-only and run
 * anywhere; stage 4 (the SMTP probe) is isolated behind an interface because it
 * MUST run from a dedicated verification IP that never sends campaigns.
 * Probing generates connection patterns some receivers penalise, and letting it
 * touch campaign IP reputation would trade a cheap signal for an expensive one.
 *
 * The honesty rule here is catch-all: a domain that accepts everything cannot be
 * verified, so we return CATCH_ALL — deliverable-unknown — rather than VALID.
 * Reporting "valid" for an address we cannot check is the lie the whole category
 * tells, and it is why bounce rates surprise people.
 */

export type VerifyStatus =
  | "VALID" | "INVALID" | "CATCH_ALL" | "ROLE" | "DISPOSABLE" | "TRAP_SUSPECT" | "UNKNOWN";

export interface VerifyEvidence {
  syntaxOk: boolean;
  domainOk: boolean;
  mxOk: boolean;
  mxHosts: string[];
  /** null when not probed — we say so rather than implying a check happened. */
  smtpOk: boolean | null;
  smtpResponse: string | null;
  catchAll: boolean;
  disposable: boolean;
  role: boolean;
  trapScore: number;
  trapReasons: string[];
}

export interface VerifyResult {
  email: string;
  normalized: string;
  status: VerifyStatus;
  evidence: VerifyEvidence;
  checkedAt: Date;
  expiresAt: Date;
}

/** Shorter TTL for risky verdicts than for clean ones (E12-033). */
export const TTL_DAYS: Record<VerifyStatus, number> = {
  VALID: 90, INVALID: 180, CATCH_ALL: 30, ROLE: 90,
  DISPOSABLE: 180, TRAP_SUSPECT: 14, UNKNOWN: 7,
};

// ── Stage 1: syntax ──────────────────────────────────────────────────────────

/**
 * RFC 5322 is far more permissive than anything a real mailbox uses. We apply
 * the practical subset deliberately: accepting a technically-legal address that
 * no provider issues costs a bounce, and bounces cost reputation.
 */
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed.toLowerCase();
  // Domain is case-insensitive; the local part is NOT, per RFC — lowercasing it
  // would silently change the identity for the minority of hosts that care.
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

export function checkSyntax(email: string): { ok: boolean; local: string; domain: string } {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return { ok: false, local: "", domain: "" };
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (email.length > 254) return { ok: false, local, domain };
  if (local.length > 64 || local.length === 0) return { ok: false, local, domain };
  if (!LOCAL_RE.test(local)) return { ok: false, local, domain };

  const labels = domain.split(".");
  if (labels.length < 2) return { ok: false, local, domain };
  if (!labels.every((l) => LABEL_RE.test(l))) return { ok: false, local, domain };
  // A bare numeric TLD is never a real mail domain.
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) return { ok: false, local, domain };

  return { ok: true, local, domain };
}

// ── Stage 3: role and disposable ─────────────────────────────────────────────

export const ROLE_LOCAL_PARTS = new Set([
  "abuse", "admin", "administrator", "all", "billing", "compliance", "contact",
  "customerservice", "enquiries", "everyone", "feedback", "finance", "help",
  "hello", "hi", "hr", "info", "inquiries", "invoices", "it", "jobs", "legal",
  "mail", "marketing", "media", "newsletter", "noreply", "no-reply", "office",
  "orders", "postmaster", "press", "privacy", "root", "sales", "security",
  "shop", "support", "team", "webmaster", "www",
]);

export function isRoleAddress(local: string): boolean {
  return ROLE_LOCAL_PARTS.has(local.toLowerCase());
}

/** MX patterns that identify disposable providers even on a novel domain. */
const DISPOSABLE_MX_PATTERNS = [
  /mailinator\.com$/i, /guerrillamail/i, /yopmail/i, /10minutemail/i,
  /temp-mail/i, /tempmail/i, /throwawaymail/i, /trashmail/i, /getnada/i,
  /dispostable/i, /maildrop/i, /sharklasers/i, /mailnesia/i,
];

export function isDisposableByMx(mxHosts: string[]): boolean {
  return mxHosts.some((h) => DISPOSABLE_MX_PATTERNS.some((re) => re.test(h)));
}

export function isDisposableByDomain(domain: string, list: ReadonlySet<string>): boolean {
  const d = domain.toLowerCase();
  if (list.has(d)) return true;
  // Disposable services hand out endless subdomains; check the registrable part.
  const parts = d.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

// ── Stage 3b: spam-trap heuristics ───────────────────────────────────────────

export interface TrapSignals {
  /** Domain resolves but serves no website. */
  noWebPresence: boolean;
  /** Registered long ago, expired, and re-registered — the classic recycled trap. */
  recycledDomain: boolean;
  /** No engagement ever recorded for this address in our own history. */
  neverEngaged: boolean;
  /** Address appeared in a list with no stated provenance. */
  unknownProvenance: boolean;
  /** Local part matches published honeypot patterns. */
  honeypotPattern: boolean;
}

const HONEYPOT_LOCAL_RE = /^(spam(trap)?|honeypot|do-?not-?(mail|send|reply)|abuse-?report|null|void|nobody|devnull)$/i;

export function trapScore(local: string, signals: Partial<TrapSignals>): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (HONEYPOT_LOCAL_RE.test(local)) { score += 0.6; reasons.push("honeypot local-part"); }
  if (signals.honeypotPattern) { score += 0.6; reasons.push("known honeypot pattern"); }
  if (signals.recycledDomain) { score += 0.3; reasons.push("recycled domain"); }
  if (signals.noWebPresence) { score += 0.15; reasons.push("no web presence"); }
  if (signals.unknownProvenance) { score += 0.2; reasons.push("no stated list provenance"); }
  if (signals.neverEngaged) { score += 0.1; reasons.push("never engaged"); }
  return { score: Math.min(1, score), reasons };
}

/** Above this, we refuse to send. A single trap hit can cost an IP (E12-015). */
export const TRAP_BLOCK_THRESHOLD = 0.5;

// ── Stage 2 + 4: injected so the engine is testable without a network ────────

export interface VerifyPorts {
  /** MX hosts in priority order, or [] when there are none. */
  resolveMx(domain: string): Promise<string[]>;
  /** Fallback per RFC 5321 §5.1: an A record makes the domain mail-routable. */
  resolveA(domain: string): Promise<string[]>;
  /**
   * RCPT probe from the DEDICATED verification IP. Never DATA.
   * Returns null when the probe was not attempted.
   */
  smtpProbe?(mxHost: string, address: string): Promise<{ accepted: boolean; response: string } | null>;
}

export interface VerifyOptions {
  disposableDomains: ReadonlySet<string>;
  trapSignals?: Partial<TrapSignals>;
  /** Domains already known to accept everything — skip the probe entirely. */
  knownCatchAll?: ReadonlySet<string>;
  /** Providers that always accept at RCPT time, so a probe proves nothing. */
  alwaysAccepts?: ReadonlySet<string>;
  now?: Date;
}

function ttl(status: VerifyStatus, now: Date): Date {
  return new Date(now.getTime() + TTL_DAYS[status] * 86_400_000);
}

export async function verify(
  rawEmail: string,
  ports: VerifyPorts,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const now = opts.now ?? new Date();
  const normalized = normalizeEmail(rawEmail);
  const evidence: VerifyEvidence = {
    syntaxOk: false, domainOk: false, mxOk: false, mxHosts: [],
    smtpOk: null, smtpResponse: null, catchAll: false,
    disposable: false, role: false, trapScore: 0, trapReasons: [],
  };

  const done = (status: VerifyStatus): VerifyResult => ({
    email: rawEmail, normalized, status, evidence, checkedAt: now, expiresAt: ttl(status, now),
  });

  // ── 1. Syntax
  const syn = checkSyntax(normalized);
  evidence.syntaxOk = syn.ok;
  if (!syn.ok) return done("INVALID");

  evidence.role = isRoleAddress(syn.local);

  // ── 2. Domain and MX
  let mx: string[] = [];
  try {
    mx = await ports.resolveMx(syn.domain);
  } catch {
    mx = [];
  }
  if (mx.length === 0) {
    // A domain with no MX may still take mail on its A record.
    let a: string[] = [];
    try {
      a = await ports.resolveA(syn.domain);
    } catch {
      a = [];
    }
    if (a.length === 0) {
      evidence.domainOk = false;
      return done("INVALID");
    }
    evidence.domainOk = true;
    evidence.mxOk = false;
    mx = [syn.domain];
  } else {
    evidence.domainOk = true;
    evidence.mxOk = true;
  }
  evidence.mxHosts = mx;

  // A null MX (RFC 7505) is an explicit "this domain accepts no mail".
  if (mx.length === 1 && (mx[0] === "." || mx[0] === "")) return done("INVALID");

  // ── 3. Disposable and trap heuristics
  evidence.disposable =
    isDisposableByDomain(syn.domain, opts.disposableDomains) || isDisposableByMx(mx);
  if (evidence.disposable) return done("DISPOSABLE");

  const trap = trapScore(syn.local, opts.trapSignals ?? {});
  evidence.trapScore = trap.score;
  evidence.trapReasons = trap.reasons;
  if (trap.score >= TRAP_BLOCK_THRESHOLD) return done("TRAP_SUSPECT");

  // ── 4. SMTP probe, when it can tell us anything
  const knownCatchAll = opts.knownCatchAll?.has(syn.domain) ?? false;
  if (knownCatchAll) {
    evidence.catchAll = true;
    return done("CATCH_ALL");
  }

  const alwaysAccepts = mx.some((h) =>
    [...(opts.alwaysAccepts ?? [])].some((p) => h.toLowerCase().endsWith(p.toLowerCase())));
  if (alwaysAccepts || !ports.smtpProbe) {
    // We did not probe, and we say so: smtpOk stays null rather than defaulting
    // to a value that would imply a check happened (E12-030).
    return done(evidence.role ? "ROLE" : "UNKNOWN");
  }

  const host = mx[0]!;
  const probe = await ports.smtpProbe(host, normalized);
  if (probe === null) return done(evidence.role ? "ROLE" : "UNKNOWN");

  evidence.smtpOk = probe.accepted;
  evidence.smtpResponse = probe.response;

  if (!probe.accepted) return done("INVALID");

  // ── 5. Catch-all detection: probe a local part nobody would own.
  const random = `ems-probe-${Math.abs(hash(normalized)).toString(36)}@${syn.domain}`;
  const control = await ports.smtpProbe(host, random);
  if (control?.accepted) {
    evidence.catchAll = true;
    return done("CATCH_ALL");
  }

  return done(evidence.role ? "ROLE" : "VALID");
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h | 0;
}

/** Providers whose RCPT always accepts, making a probe uninformative. */
export const ALWAYS_ACCEPTS_MX = new Set([
  "protection.outlook.com",  // Microsoft 365 accepts then bounces asynchronously
  "pphosted.com",
  "mimecast.com",
  "barracudanetworks.com",
]);

/** Whether a status is safe to enrol in a campaign. */
export function isSendable(status: VerifyStatus): boolean {
  return status === "VALID" || status === "CATCH_ALL" || status === "ROLE";
}

/** Whether a status should hard-block, whatever the customer wants. */
export function isBlocking(status: VerifyStatus): boolean {
  return status === "INVALID" || status === "DISPOSABLE" || status === "TRAP_SUSPECT";
}
