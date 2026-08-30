// Playwright check of IA Phase 2 — the Account view's Team card (roster, role
// controls, pending invites, invite modal) and the logged-out invite gate.
// Self-contained: serves dashboard.html on :8796 and mocks the API per route.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../apps/api/public/dashboard.html", import.meta.url), "utf8");
const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(HTML); });
await new Promise((r) => server.listen(8796, r));

const browser = await chromium.launch();
const out = {};

function mockApp(page) {
  // catch-all first (Playwright matches in reverse registration order)
  page.route("**/app/**", (r) => r.fulfill({ json: { data: [] } }));
  page.route("**/app/plan", (r) => r.fulfill({ json: { plan: "scale", limits: { monthlySends: 500000, sendingDomains: 50, webhookEndpoints: 50, teamSeats: 10, customBranding: true, customDomain: true, dedicatedIp: false }, usage: { sends: 12, domains: 2, webhooks: 1, seats: 4, period: "2026-06" } } }));
  page.route("**/app/team", (r) => r.fulfill({ json: {
    myRole: "owner", canManage: true,
    assignableRoles: ["owner", "admin", "developer", "viewer"],
    roleMeta: { owner: { label: "Owner", description: "Full control." }, admin: { label: "Admin", description: "Manage." }, developer: { label: "Developer", description: "Send." }, viewer: { label: "Viewer", description: "Read." } },
    seats: { used: 4, limit: 10 },
    members: [
      { userId: "u1", email: "owner@acme.com", name: "Ada Owner", role: "owner", joinedAt: "2026-01-01", isYou: true, canManage: false },
      { userId: "u2", email: "ben@acme.com", name: "Ben Admin", role: "admin", joinedAt: "2026-02-01", isYou: false, canManage: true },
      { userId: "u3", email: "dev@acme.com", name: "", role: "developer", joinedAt: "2026-03-01", isYou: false, canManage: true },
    ],
    invites: [{ id: "inv1", email: "pending@acme.com", role: "viewer", invitedAt: "2026-06-20" }],
  } }));
}

// --- Owner viewing the Team card ---
const op = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const consoleErrors = [];
op.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
mockApp(op);
op.route("**/auth/me", (r) => r.fulfill({ json: { user: { id: "u1", email: "owner@acme.com", name: "Ada Owner", createdAt: "2026-01-01" }, emailVerified: true, role: "owner", orgId: "o1", projectId: "p1", branding: null } }));
await op.goto("http://localhost:8796/dashboard");
await op.waitForTimeout(400);
await op.evaluate(() => { document.getElementById("gate").classList.add("hide"); document.getElementById("app").classList.remove("hide"); showSection("settings"); });
await op.waitForTimeout(500);
out.account = await op.evaluate(() => ({
  navLabel: document.querySelector('.nav-i[data-view="settings"]')?.textContent.trim(),
  title: document.getElementById("viewTitle")?.textContent,
  teamCard: !!document.getElementById("teamcard"),
  seats: document.getElementById("team_seats")?.textContent,
  inviteBtnVisible: document.getElementById("team_invite")?.style.display !== "none",
  memberRows: document.querySelectorAll("#teambox .keyrow").length,
  roleSelects: document.querySelectorAll("#teambox [data-role-for]").length,
  removeBtns: document.querySelectorAll("#teambox [data-remove-mem]").length,
  youHasControls: !!document.querySelector('#teambox [data-role-for="u1"]'),
  revokeBtns: document.querySelectorAll("#teambox [data-revoke]").length,
  brandingHiddenForOwner: document.getElementById("br_save")?.style.display === "none",
}));
// open invite modal
await op.evaluate(() => document.getElementById("team_invite").click());
await op.waitForTimeout(300);
out.inviteModal = await op.evaluate(() => ({
  open: !document.getElementById("ov").classList.contains("hide"),
  hasEmail: !!document.getElementById("mf_email"),
  hasRoleSelect: document.getElementById("mf_role")?.tagName === "SELECT",
  roleOptions: [...(document.getElementById("mf_role")?.options || [])].map((o) => o.value),
  defaultRole: document.getElementById("mf_role")?.value,
}));
await op.screenshot({ path: "/tmp/team-account.png", fullPage: true });
await op.close();

// --- Developer (no manage rights): controls hidden ---
const dp = await browser.newPage({ viewport: { width: 1280, height: 950 } });
mockApp(dp);
dp.route("**/auth/me", (r) => r.fulfill({ json: { user: { id: "u3", email: "dev@acme.com", name: "", createdAt: "2026-03-01" }, emailVerified: true, role: "developer", orgId: "o1", projectId: "p1", branding: null } }));
dp.route("**/app/team", (r) => r.fulfill({ json: {
  myRole: "developer", canManage: false, assignableRoles: [], roleMeta: {}, seats: { used: 4, limit: 10 },
  members: [ { userId: "u1", email: "owner@acme.com", name: "Ada", role: "owner", joinedAt: "2026-01-01", isYou: false, canManage: false }, { userId: "u3", email: "dev@acme.com", name: "Dev", role: "developer", joinedAt: "2026-03-01", isYou: true, canManage: false } ],
  invites: [],
} }));
await dp.goto("http://localhost:8796/dashboard");
await dp.waitForTimeout(400);
await dp.evaluate(() => { document.getElementById("gate").classList.add("hide"); document.getElementById("app").classList.remove("hide"); showSection("settings"); });
await dp.waitForTimeout(500);
out.developer = await dp.evaluate(() => ({
  inviteBtnHidden: document.getElementById("team_invite")?.style.display === "none",
  roleSelects: document.querySelectorAll("#teambox [data-role-for]").length,
  removeBtns: document.querySelectorAll("#teambox [data-remove-mem]").length,
  brandingDisabled: document.getElementById("br_color")?.disabled === true,
}));
await dp.close();

// --- Logged-out invite gate ---
const gp = await browser.newPage({ viewport: { width: 900, height: 800 } });
gp.route("**/auth/me", (r) => r.fulfill({ status: 401, json: { message: "unauth" } }));
gp.route("**/auth/invite**", (r) => r.fulfill({ json: { valid: true, email: "new@acme.com", role: "developer", orgName: "Acme Inc", hasAccount: false } }));
await gp.goto("http://localhost:8796/dashboard?invite=faketoken");
await gp.waitForTimeout(500);
out.inviteGate = await gp.evaluate(() => ({
  bannerVisible: !document.getElementById("inviteBanner").classList.contains("hide"),
  bannerMentionsOrg: document.getElementById("inviteBanner").textContent.includes("Acme Inc"),
  emailPrefilled: document.getElementById("a_email").value,
  emailLocked: document.getElementById("a_email").readOnly,
  signupMode: document.getElementById("a_btnlabel").textContent,
}));
await gp.screenshot({ path: "/tmp/team-invite-gate.png" });
await gp.close();

out.consoleErrors = consoleErrors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
