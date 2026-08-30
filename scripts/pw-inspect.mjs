// Playwright inspection of the dashboard template editor — drives the static
// dashboard with mocked API, checks the preview width (desktop), the full-width
// pop-out, and mobile single-column stacking. Run with static server on :8795.
import { chromium } from "playwright";

const PREVIEW_HTML =
  '<!doctype html><body style="font-family:-apple-system,sans-serif;margin:0;padding:24px;color:#1a1a1a">' +
  '<h1 style="color:#6d5efc;margin:0 0 12px">Welcome, Alex!</h1>' +
  '<p style="line-height:1.6">Thanks for joining Acme — a realistic paragraph to judge the preview width.</p>' +
  '<a style="display:inline-block;background:#6d5efc;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Get started</a></body>';

async function openEditor(page) {
  // Catch-all first (Playwright matches routes in reverse registration order).
  await page.route("**/app/**", (r) => r.fulfill({ json: { data: [] } }));
  await page.route("**/auth/me", (r) => r.fulfill({ json: { user: { id: "u1", email: "ops@acme.com" }, orgId: "o1", projectId: "p1", branding: null } }));
  await page.route("**/app/templates", (r) => r.fulfill({ json: { data: [] } }));
  await page.route("**/app/templates/preview", (r) => r.fulfill({ json: { html: PREVIEW_HTML } }));
  await page.goto("http://localhost:8795/dashboard");
  await page.waitForTimeout(350);
  await page.evaluate(() => { document.getElementById("gate").classList.add("hide"); document.getElementById("app").classList.remove("hide"); showSection("templates"); });
  await page.waitForTimeout(150);
  await page.evaluate(() => newTemplate());
  await page.waitForTimeout(600);
}

const browser = await chromium.launch();
const out = {};

// Desktop: preview width + full-width pop-out
const dp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await openEditor(dp);
out.desktop = await dp.evaluate(() => {
  const ifr = document.getElementById("tpl_preview");
  return { previewW: Math.round(ifr.getBoundingClientRect().width), previewH: Math.round(ifr.getBoundingClientRect().height), hasFullBtn: !!document.getElementById("tpl_fullpreview") };
});
await dp.evaluate(() => document.getElementById("tpl_fullpreview").click());
await dp.waitForTimeout(150);
out.fullPreview = await dp.evaluate(() => {
  const ovIfr = [...document.querySelectorAll("iframe")].find((f) => f.id !== "tpl_preview");
  return { overlayOpened: !!ovIfr, overlayW: ovIfr ? Math.round(ovIfr.getBoundingClientRect().width) : null };
});
await dp.screenshot({ path: "/tmp/tpl-fullpreview.png" });
await dp.close();

// Mobile: grid should collapse to one column
const mp = await browser.newPage({ viewport: { width: 390, height: 850 } });
await openEditor(mp);
out.mobile = await mp.evaluate(() => {
  const grid = document.querySelector(".tpl-grid");
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  return { gridTrackCount: cols, stacked: cols === 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
await mp.close();

console.log(JSON.stringify(out, null, 2));
await browser.close();
