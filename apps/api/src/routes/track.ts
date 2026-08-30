import { Hono } from "hono";
import type { Context } from "hono";
import { env, verifyTrack, enforceFixedWindow } from "@ems/core";
import { prisma } from "@ems/db";

// Open + click tracking targets (public — recipients hit these from their mail
// client). Tokens are HMAC-signed, so the click URL can't be forged into an open
// redirect, and the emailId is trusted. GETs are best-effort + never block the
// pixel/redirect on a DB write.
export const track = new Hono();

// 1×1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function servePixel(c: Context) {
  c.header("Content-Type", "image/gif");
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
  c.header("Pragma", "no-cache");
  return c.body(PIXEL);
}

track.get("/o/:token", async (c) => {
  const v = verifyTrack(c.req.param("token"));
  if (v?.kind === "o") {
    // First-open semantics: don't pile up an event on every prefetch/proxy fetch.
    try {
      const seen = await prisma.emailEvent.findFirst({
        where: { emailId: v.emailId, type: "opened" },
        select: { id: true },
      });
      if (!seen) {
        await prisma.emailEvent.create({
          data: {
            emailId: v.emailId,
            type: "opened",
            payload: { ua: c.req.header("user-agent") ?? null },
          },
        });
      }
    } catch {
      /* unknown/deleted email → drop silently; still serve the pixel */
    }
  }
  return servePixel(c);
});

track.get("/c/:token", async (c) => {
  const v = verifyTrack(c.req.param("token"));
  // Defense-in-depth: only ever redirect to a web URL. We only sign http(s)
  // links, but never trust the decoded value to be one.
  if (v?.kind === "c" && v.url && /^https?:\/\//i.test(v.url)) {
    try {
      await enforceFixedWindow(`track:c:${v.emailId}`, 40, 60);
      await prisma.emailEvent.create({
        data: {
          emailId: v.emailId,
          type: "clicked",
          payload: { url: v.url, ua: c.req.header("user-agent") ?? null },
        },
      });
    } catch {
      /* rate-limit or unknown email — still send the user onward */
    }
    return c.redirect(v.url, 302);
  }
  // Invalid/expired token → send them somewhere safe, never error.
  return c.redirect(env.API_URL.replace(/\/$/, ""), 302);
});
