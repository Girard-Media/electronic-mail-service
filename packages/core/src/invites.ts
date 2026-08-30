// Stateless team-invite tokens. Same shape as the password-reset token in
// auth.ts: an HMAC-signed, self-expiring payload — no extra DB column for the
// secret. The token carries the invite id, the invited email, and an expiry;
// folding the email into the signed payload means a tampered email fails to
// verify, so a token can only ever accept the exact invite it was minted for.
// Revocation + single-use are enforced at the DB layer (delete the Invite row /
// check acceptedAt) — the token alone is necessary but not sufficient.

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// 7 days — long enough to land in an inbox and be acted on, short enough to age out.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function inviteKey(): string {
  return `${env.AUTH_SECRET}:invite`;
}

function sign(payload: string): string {
  return createHmac("sha256", inviteKey()).update(payload).digest("base64url").slice(0, 32);
}

/** Mint an invite token. `now` is injectable for tests. */
export function signInvite(inviteId: string, email: string, now: number = Date.now()): string {
  const payload = `${inviteId}:${email.toLowerCase()}:${now + INVITE_TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/**
 * Verify a token's signature + expiry. Returns the embedded { inviteId, email }
 * or null. Does NOT touch the database — the caller must still confirm the invite
 * exists, is unaccepted, and matches the acting user's email.
 */
export function verifyInvite(
  token: string,
  now: number = Date.now(),
): { inviteId: string; email: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  // inviteId is a cuid and email has no ':', so a 3-way split is unambiguous.
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [inviteId, email, expStr] = parts;
  const exp = Number(expStr);
  if (!inviteId || !email || !Number.isFinite(exp) || now > exp) return null;
  const expected = sign(payload);
  const got = token.slice(dot + 1);
  if (got.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return null;
  return { inviteId, email };
}
