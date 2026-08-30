// Playwright check of the domain-centric restructure: domain detail tabs
// (DNS/Tracking/Inboxes) + the Inboxes tab loading domain-scoped mailboxes.
import { chromium } from "playwright";

const DOMAIN = "inbox.electronicmailservices.com";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// catch-all first (reverse match order), specifics last
await page.route("**/app/**", (r) => r.fulfill({ json: { data: [] } }));
await page.route("**/auth/me", (r) => r.fulfill({ json: { user: { id: "u1", email: "ops@acme.com" }, orgId: "o1", projectId: "p1", branding: null } }));
await page.route("**/app/dns-provider-token", (r) => r.fulfill({ json: { connected: true, platformFallback: false } }));
await page.route("**/app/domains", (r) => r.fulfill({ json: { data: [{ id: "d1", name: DOMAIN, status: "verified", verifiedAt: "2026-06-20", createdAt: "2026-06-19" }] } }));
await page.route("**/app/domains/d1/dns-provider", (r) => r.fulfill({ json: { configured: true, available: false, zone: null } }));
await page.route("**/app/domains/d1/status", (r) => r.fulfill({ json: { id: "d1", name: DOMAIN, status: "verified", verified: true, records: [{ key: "dkim", type: "TXT", host: "x._domainkey." + DOMAIN, value: "v=DKIM1", status: "verified" }], openTracking: false, clickTracking: false } }));
await page.route("**/app/mailboxes**", (r) => r.fulfill({ json: { data: [{ id: "mb1", address: "support@" + DOMAIN, status: "active", usedBytes: 0, quotaBytes: 1073741824, messages: 2, createdAt: "2026-06-20" }] } }));
await page.route("**/app/mailboxes/receiving**", (r) => r.fulfill({ json: { domain: DOMAIN, ready: true, conflictsWithExistingMail: false, handledBy: "ems", expectedMx: "mail.electronicmailservices.com", mx: [], record: { type: "MX", host: DOMAIN, value: "mail.electronicmailservices.com", priority: 10 }, advice: "" } }));

await page.goto("http://localhost:8795/dashboard");
await page.waitForTimeout(350);
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.evaluate(() => { document.getElementById("gate").classList.add("hide"); document.getElementById("app").classList.remove("hide"); showSection("domains"); });
await page.waitForTimeout(300);
const navHasMailboxes = await page.evaluate(() => !!document.querySelector('.nav-i[data-view="mailboxes"]'));
await page.evaluate(() => toggleDomain("d1", true));
await page.waitForTimeout(500);
const tabs = await page.evaluate(() => [...document.querySelectorAll("#panel-d1 [data-domtab]")].map((b) => b.dataset.domtab));
// click Inboxes tab
await page.evaluate(() => [...document.querySelectorAll("#panel-d1 [data-domtab]")].find((b) => b.dataset.domtab === "inboxes").click());
await page.waitForTimeout(500);
const inbox = await page.evaluate(() => {
  const c = document.getElementById("dominbox-d1");
  return {
    loaded: !!c,
    hasNewInboxBtn: !!c?.querySelector("[data-newmbox]"),
    mailboxRows: c ? c.querySelectorAll("[data-mbox]").length : 0,
    receivingReady: c ? c.innerHTML.includes("receiving ready") : false,
    inboxesPaneVisible: !document.querySelector('#panel-d1 [data-pane="inboxes"]').classList.contains("hide"),
    dnsPaneHidden: document.querySelector('#panel-d1 [data-pane="dns"]').classList.contains("hide"),
  };
});
await page.screenshot({ path: "/tmp/domain-inboxes.png" });
console.log(JSON.stringify({ navHasMailboxes, tabs, inbox, consoleErrors }, null, 2));
await browser.close();
