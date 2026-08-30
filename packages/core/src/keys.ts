import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// API key scheme (FR-020/021): token `um_<live|test>_<prefix>_<secret>`.
// We store only the public `prefix` (unique, for O(1) lookup) and a sha256 hash
// of the full token. The secret is shown once and never persisted.

const PREFIX_LEN = 10;
const SECRET_LEN = 28;

export type KeyMode = "live" | "test";

export interface GeneratedKey {
  token: string;
  prefix: string;
  hashedKey: string;
}

function randToken(n: number): string {
  // base64url chars [A-Za-z0-9_-]; slice to n chars
  return randomBytes(n).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
}

export function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiKey(mode: KeyMode = "live"): GeneratedKey {
  const prefix = randToken(PREFIX_LEN);
  const secret = randToken(SECRET_LEN);
  const token = `um_${mode}_${prefix}_${secret}`;
  return { token, prefix, hashedKey: hashKey(token) };
}

/** Parse a token into mode + prefix for lookup. null if malformed. */
export function parseApiKey(
  token: string,
): { mode: KeyMode; prefix: string } | null {
  const m = /^um_(live|test)_([A-Za-z0-9]{6,})_([A-Za-z0-9]{8,})$/.exec(token);
  if (!m) return null;
  return { mode: m[1] as KeyMode, prefix: m[2] as string };
}

/** Constant-time comparison of a presented token against a stored sha256 hash. */
export function verifyKey(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashKey(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Constant-time equality for shared secrets (MTA bearer, bootstrap header). */
export function secretEquals(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
