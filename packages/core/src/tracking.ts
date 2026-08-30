import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// Constant-time tag comparison — matches the project's standard (keys.ts /
// passwords.ts) so a public token endpoint isn't a timing oracle.
function tagEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// HTML hrefs encode '&' as '&amp;' — decode it (and its numeric forms) before we
// sign the URL into the token, or the 302 Location would carry a literal "&amp;"
// and mangle every query param after the first.
function decodeAmp(s: string): string {
  return s.replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&").replace(/&#x0*26;/gi, "&");
}

// Open + click tracking via signed, stateless tokens (same construction as the
// unsubscribe token). The token carries the emailId — and, for clicks, the
// destination URL — HMAC-signed. Because we sign the URL, the click redirect is
// NOT an open redirect: an attacker can't mint a token that bounces a victim to
// an arbitrary site without our secret.

function tag(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url").slice(0, 24);
}

function sign(payload: string): string {
  return `${Buffer.from(payload).toString("base64url")}.${tag(payload)}`;
}

export function signOpen(emailId: string): string {
  return sign(`o:${emailId}`);
}

export function signClick(emailId: string, url: string): string {
  return sign(`c:${emailId}:${url}`);
}

export type TrackToken =
  | { kind: "o"; emailId: string }
  | { kind: "c"; emailId: string; url: string };

export function verifyTrack(token: string): TrackToken | null {
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
  if (payload.startsWith("o:")) {
    const emailId = payload.slice(2);
    return emailId ? { kind: "o", emailId } : null;
  }
  if (payload.startsWith("c:")) {
    const rest = payload.slice(2);
    // emailId is a cuid (no ':'), so the first ':' separates it from the URL.
    const i = rest.indexOf(":");
    if (i < 1) return null;
    const emailId = rest.slice(0, i);
    const url = rest.slice(i + 1);
    return emailId && url ? { kind: "c", emailId, url } : null;
  }
  return null;
}

const base = (): string => env.API_URL.replace(/\/$/, "");
export function openPixelUrl(emailId: string): string {
  return `${base()}/t/o/${signOpen(emailId)}`;
}
export function clickUrl(emailId: string, url: string): string {
  return `${base()}/t/c/${signClick(emailId, url)}`;
}

// Don't re-wrap our own tracking/unsubscribe links if a sender pasted them into
// the body.
function isOwnLink(url: string): boolean {
  return /\/t\/o\/|\/t\/c\/|\/u\//.test(url);
}

/**
 * Rewrite an email's HTML for tracking: replace http(s) anchor hrefs with a
 * signed click-redirect (when `clicks`), and inject a 1×1 open pixel before
 * </body> (when `opens`). Returns the HTML unchanged when there's nothing to do.
 * The STORED email keeps its original HTML — only the sent copy is rewritten.
 */
export function applyTracking(
  html: string | null | undefined,
  emailId: string,
  opts: { opens?: boolean; clicks?: boolean } = { opens: true, clicks: true },
): string {
  if (!html) return html ?? "";
  let out = html;
  if (opts.clicks) {
    out = out.replace(
      /(<a\b[^>]*\bhref=)(["'])(https?:\/\/[^"'\s]+)\2/gi,
      (m, pre: string, q: string, url: string) =>
        isOwnLink(url) ? m : `${pre}${q}${clickUrl(emailId, decodeAmp(url))}${q}`,
    );
  }
  if (opts.opens) {
    const pixel = `<img src="${openPixelUrl(emailId)}" alt="" width="1" height="1" style="display:none;max-height:0;overflow:hidden" />`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
  }
  return out;
}
