import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// Constant-time tag comparison (matches keys.ts / passwords.ts).
function tagEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Signed, stateless unsubscribe tokens for the List-Unsubscribe header (RFC 2369)
// + one-click (RFC 8058). The token carries the project + recipient and is HMAC-
// signed so a recipient can only unsubscribe themselves — it can't be forged to
// suppress an arbitrary address.

function tag(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url").slice(0, 24);
}

export function signUnsubscribe(projectId: string, address: string): string {
  const payload = `${projectId}:${address.toLowerCase()}`;
  return `${Buffer.from(payload).toString("base64url")}.${tag(payload)}`;
}

export function verifyUnsubscribe(token: string): { projectId: string; address: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!tagEquals(sig, tag(payload))) return null;
  const i = payload.indexOf(":");
  if (i < 1) return null;
  return { projectId: payload.slice(0, i), address: payload.slice(i + 1) };
}

/** Full https one-click unsubscribe URL for the List-Unsubscribe header. */
export function unsubscribeUrl(projectId: string, address: string): string {
  return `${env.API_URL.replace(/\/$/, "")}/u/${signUnsubscribe(projectId, address)}`;
}
