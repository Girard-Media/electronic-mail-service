import { Hono } from "hono";
import { verifyUnsubscribe } from "@ems/core";
import { prisma } from "@ems/db";

// One-click unsubscribe target for the List-Unsubscribe header.
//   POST /u/:token  — RFC 8058 one-click (receivers send List-Unsubscribe=One-Click);
//                     also the target of the confirm button below.
//   GET  /u/:token  — human page with a confirm button (GET never mutates, so
//                     link-prefetching/scanners can't unsubscribe by accident).
export const unsubscribe = new Hono();

async function suppress(token: string): Promise<string | null> {
  const v = verifyUnsubscribe(token);
  if (!v) return null;
  await prisma.suppression.upsert({
    where: { projectId_address: { projectId: v.projectId, address: v.address } },
    create: { projectId: v.projectId, address: v.address, reason: "manual", source: "unsubscribe" },
    update: { source: "unsubscribe" },
  });
  return v.address;
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title>` +
  `<div style="font:15px/1.6 system-ui,sans-serif;max-width:440px;margin:18vh auto;padding:28px;text-align:center;color:#0b1220">` +
  body +
  `</div>`;

unsubscribe.post("/:token", async (c) => {
  const addr = await suppress(c.req.param("token"));
  if (!addr) return c.json({ error: "invalid or expired link" }, 400);
  // Browser form button → show a page; programmatic one-click → JSON is fine too.
  if ((c.req.header("accept") ?? "").includes("text/html")) {
    return c.html(page("Unsubscribed", `<h2>You're unsubscribed</h2><p>${escapeHtml(addr)} won't receive further messages.</p>`));
  }
  return c.json({ ok: true });
});

unsubscribe.get("/:token", (c) => {
  const token = c.req.param("token");
  const v = verifyUnsubscribe(token);
  if (!v) return c.html(page("Invalid link", `<h2>Link invalid or expired</h2>`), 400);
  return c.html(
    page(
      "Unsubscribe",
      `<h2>Unsubscribe ${escapeHtml(v.address)}?</h2>` +
        `<form method="post" action="/u/${encodeURIComponent(token)}">` +
        `<button type="submit" style="margin-top:14px;padding:11px 22px;border:0;border-radius:9px;background:#4f46e5;color:#fff;font:inherit;cursor:pointer">Unsubscribe</button>` +
        `</form>`,
    ),
  );
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string);
}
