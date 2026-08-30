/**
 * @ems/verify — self-hosted email verification.
 *
 * CRITICAL ISOLATION: the SMTP probe runs from a dedicated verification IP that
 * never sends campaigns. Probing generates connection patterns some receivers
 * penalise; it must never touch campaign IP reputation (E12-016, E12-017).
 */

export type VerifyStatus =
  | "VALID" | "INVALID" | "CATCH_ALL" | "ROLE" | "DISPOSABLE" | "TRAP_SUSPECT" | "UNKNOWN";

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  syntaxOk: boolean;
  domainOk: boolean;
  mxOk: boolean;
  /** null when not probed — we say so rather than implying a check happened. */
  smtpOk: boolean | null;
  catchAll: boolean;
  disposable: boolean;
  role: boolean;
  trapScore: number;
  smtpResponse: string | null;
  checkedAt: Date;
  expiresAt: Date;
}

/** Shorter TTL for risky verdicts than for clean ones (E12-033). */
export const TTL_DAYS: Record<VerifyStatus, number> = {
  VALID: 90, INVALID: 180, CATCH_ALL: 30, ROLE: 90,
  DISPOSABLE: 180, TRAP_SUSPECT: 14, UNKNOWN: 7,
};

export const ROLE_LOCAL_PARTS = [
  "abuse", "admin", "administrator", "billing", "contact", "help", "hello",
  "info", "marketing", "noreply", "no-reply", "office", "postmaster", "root",
  "sales", "security", "support", "webmaster", "team",
] as const;

export function isRoleAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return (ROLE_LOCAL_PARTS as readonly string[]).includes(local);
}

/**
 * A catch-all domain accepts anything, so "valid" would be a lie. We report
 * deliverable-unknown and explain the limitation in the UI (E12-025, E12-026).
 */
export function statusForCatchAll(): VerifyStatus {
  return "CATCH_ALL";
}
