// Playwright check of IA Phase 3 — the topbar org-switcher and the Sub-accounts
// view, across three account shapes (agency / inside-a-sub-account / plain user).
// Self-contained: serves dashboard.html on :8797 and mocks the API per route.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../apps/api/public/dashboard.html", import.meta.url), "utf8");
const server = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(HTML); });
await new Promise((r) => server.listen(8797, r));

const browser = await chromium.launch();
const out = {};
const consoleErrors = [];

function baseMocks(page) {
  page.route("**/app/**", (r) => r.fulfill({ json: { data: [] } }));
  page.route("**/god/me", (r) => r.fulfill({ status: 403, json: { message: "no" } }));
  page.route("**/app/subaccounts", (r) => r.fulfill({ json: {
    canCreate: true,
    data: [
      { id: "client1", name: "Client One", plan: "free", createdAt: "2026-06-01", members: 1, domains: 2, sends: 340, isMember: true },
      { id: "client2", name: "Client Two", plan: "scale", createdAt: "2026-05-01", members: 3, domains: 5, sends: 9000, isMember: false },
    ],
  } }));
  page.route("**/app/subaccounts/audit", (r) => r.fulfill({ json: { data: [] } }));
  page.route("**/app/billing/connect", (r) => r.fulfill({ json: { configured: true, connected: false, accountId: null, chargesEnabled: false, detailsSubmitted: false, canManage: true } }));
  page.route("**/app/subaccounts/billing", (r) => r.fulfill({ json: {
    period: "2026-06", currency: "USD",
    agency: { orgId: "agency1", name: "Acme Agency", plan: "white-label", custom: false, monthlyUsd: 400, includedSends: 5000000, usedSends: 1000, overageSends: 0, overageUsd: 0, totalUsd: 400 },
    children: [
      { orgId: "client1", name: "Client One", plan: "pro", custom: false, monthlyUsd: 18, includedSends: 50000, usedSends: 60000, overageSends: 10000, overageUsd: 7, totalUsd: 25 },
      { orgId: "client2", name: "Client Two", plan: "scale", custom: false, monthlyUsd: 80, includedSends: 500000, usedSends: 120000, overageSends: 0, overageUsd: 0, totalUsd: 80 },
    ],
    totals: { usedSends: 180000, monthlyUsd: 98, overageUsd: 7, totalUsd: 105 },
    hasCustom: false,
  } }));
}

async function bootAs(page, me, section) {
  await page.evaluate(async (sec) => {
    const m = await api("/auth/me");
    document.getElementById("gate").classList.add("hide");
    document.getElementById("app").classList.remove("hide");
    applyBranding(m.branding);
    renderOrgSwitcher(m);
    document.getElementById("nav-subaccounts").classList.toggle("hide", !m.account?.canManageSubaccounts);
    if (sec) showSection(sec);
  }, section);
  await page.waitForTimeout(400);
}

// --- Agency (can manage sub-accounts, 2 memberships) ---
const ap = await browser.newPage({ viewport: { width: 1280, height: 950 } });
ap.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
baseMocks(ap);
ap.route("**/auth/me", (r) => r.fulfill({ json: {
  user: { id: "u1", email: "ada@acme.com", name: "Ada", createdAt: "2026-01-01" }, emailVerified: true, role: "owner",
  orgId: "agency1", projectId: "p1", branding: { name: "Acme Agency", logoUrl: null, primaryColor: null, poweredBy: true },
  account: { activeOrgId: "agency1", name: "Acme Agency", isSubAccount: false, canManageSubaccounts: true, memberships: [
    { orgId: "agency1", name: "Acme Agency", role: "owner", isSubAccount: false },
    { orgId: "client1", name: "Client One", role: "owner", isSubAccount: true },
  ] }, impersonating: null,
} }));
await ap.goto("http://localhost:8797/dashboard");
await ap.waitForTimeout(300);
await bootAs(ap, null, "subaccounts");
out.agency = await ap.evaluate(() => ({
  switcherVisible: !document.getElementById("orgsw").classList.contains("hide"),
  switcherName: document.getElementById("orgswName").textContent,
  navSubVisible: !document.getElementById("nav-subaccounts").classList.contains("hide"),
  title: document.getElementById("viewTitle").textContent,
  rows: document.querySelectorAll("#subacctbox [data-open-suba]").length,
  newBtnVisible: document.getElementById("newSubacct").style.display !== "none",
}));
out.billing = await ap.evaluate(() => ({
  period: document.getElementById("billPeriod").textContent,
  total: document.getElementById("billTotal").textContent,
  rows: document.querySelectorAll("#billbox tbody tr").length,
  hasFooterTotal: document.querySelector("#billbox tfoot tr td:last-child")?.textContent || "",
}));
out.payments = await ap.evaluate(() => ({
  status: document.getElementById("payStatus").textContent.trim(),
  hasConnectBtn: !!document.getElementById("payConnect"),
  btnLabel: document.getElementById("payConnect")?.textContent.trim() || "",
}));
// open the switcher menu
await ap.evaluate(() => document.getElementById("orgswBtn").click());
await ap.waitForTimeout(150);
out.switcherMenu = await ap.evaluate(() => ({
  open: !document.getElementById("orgswMenu").classList.contains("hide"),
  switchItems: document.querySelectorAll("#orgswMenu [data-switch]").length,
  hasManage: !!document.querySelector("#orgswMenu [data-go-suba]"),
  hasBack: !!document.querySelector("#orgswMenu [data-exit]"),
  activeChecked: document.querySelector('#orgswMenu [data-switch="agency1"] .ti-check') !== null,
}));
// open the create modal
await ap.evaluate(() => document.getElementById("newSubacct").click());
await ap.waitForTimeout(200);
out.createModal = await ap.evaluate(() => ({ open: !document.getElementById("ov").classList.contains("hide"), hasName: !!document.getElementById("mf_name") }));
await ap.screenshot({ path: "/tmp/subaccounts-agency.png", fullPage: true });
await ap.close();

// --- Inside a sub-account (isSubAccount, no manage) ---
const sp = await browser.newPage({ viewport: { width: 1280, height: 950 } });
baseMocks(sp);
sp.route("**/auth/me", (r) => r.fulfill({ json: {
  user: { id: "u1", email: "ada@acme.com", name: "Ada", createdAt: "2026-01-01" }, emailVerified: true, role: "owner",
  orgId: "client1", projectId: "pc1", branding: { name: "Client One", logoUrl: null, primaryColor: "#16a34a", poweredBy: true },
  account: { activeOrgId: "client1", name: "Client One", isSubAccount: true, canManageSubaccounts: false, memberships: [
    { orgId: "agency1", name: "Acme Agency", role: "owner", isSubAccount: false },
    { orgId: "client1", name: "Client One", role: "owner", isSubAccount: true },
  ] }, impersonating: null,
} }));
await sp.goto("http://localhost:8797/dashboard");
await sp.waitForTimeout(300);
await bootAs(sp, null, null);
await sp.evaluate(() => document.getElementById("orgswBtn").click());
await sp.waitForTimeout(150);
out.insideSub = await sp.evaluate(() => ({
  switcherName: document.getElementById("orgswName").textContent,
  navSubHidden: document.getElementById("nav-subaccounts").classList.contains("hide"),
  hasBack: !!document.querySelector("#orgswMenu [data-exit]"),
  hasManage: !!document.querySelector("#orgswMenu [data-go-suba]"),
}));
await sp.close();

// --- Plain user (single org, no sub-accounts) ---
const pp = await browser.newPage({ viewport: { width: 1280, height: 950 } });
baseMocks(pp);
pp.route("**/auth/me", (r) => r.fulfill({ json: {
  user: { id: "u9", email: "solo@x.com", name: "Solo", createdAt: "2026-01-01" }, emailVerified: true, role: "owner",
  orgId: "o9", projectId: "p9", branding: { name: "Solo", logoUrl: null, primaryColor: null, poweredBy: true },
  account: { activeOrgId: "o9", name: "Solo", isSubAccount: false, canManageSubaccounts: false, memberships: [
    { orgId: "o9", name: "Solo", role: "owner", isSubAccount: false },
  ] }, impersonating: null,
} }));
await pp.goto("http://localhost:8797/dashboard");
await pp.waitForTimeout(300);
await bootAs(pp, null, null);
out.plainUser = await pp.evaluate(() => ({
  switcherHidden: document.getElementById("orgsw").classList.contains("hide"),
  navSubHidden: document.getElementById("nav-subaccounts").classList.contains("hide"),
}));
await pp.close();

out.consoleErrors = consoleErrors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
