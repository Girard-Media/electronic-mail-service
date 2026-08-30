// GDPR stubs: delete eligibility + wiring so the dashboard route cannot drop
// the owner-with-teammates guard or the impersonation block.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountDeleteDecision,
  accountDeleteBlockedMessage,
} from "../packages/core/src/privacy.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

ok(
  "no orgs → allow, nothing to cascade",
  JSON.stringify(accountDeleteDecision([])) ===
    JSON.stringify({ action: "allow", deleteOrgIds: [] }),
);

ok(
  "sole-owned org is deleted with the user",
  JSON.stringify(
    accountDeleteDecision([{ orgId: "o1", name: "Acme", otherMemberCount: 0 }]),
  ) === JSON.stringify({ action: "allow", deleteOrgIds: ["o1"] }),
);

const blocked = accountDeleteDecision([
  { orgId: "o1", name: "Acme", otherMemberCount: 2 },
  { orgId: "o2", name: "Solo", otherMemberCount: 0 },
]);
ok(
  "org with teammates blocks the whole delete",
  blocked.action === "blocked" && blocked.orgNames.length === 1 && blocked.orgNames[0] === "Acme",
);

ok(
  "blocked message names the org",
  accountDeleteBlockedMessage(["Acme"]).includes('"Acme"') &&
    accountDeleteBlockedMessage(["Acme"]).includes("Transfer ownership"),
);

ok(
  "org with sub-accounts blocks delete",
  accountDeleteDecision([{ orgId: "o1", name: "Agency", otherMemberCount: 0, subaccountCount: 1 }])
    .action === "blocked",
);

const route = src("apps/api/src/routes/privacy.ts");
ok("export is GET /export", route.includes('privacy.get("/export"'));
ok("delete is POST /delete", route.includes('privacy.post("/delete"'));
ok("delete verifies password", route.includes("verifyPassword"));
ok("wrong password is a validation error", route.includes("That password is incorrect."));
ok("delete blocked during impersonation", route.includes("impersonatorId"));
ok("delete uses accountDeleteDecision", route.includes("accountDeleteDecision"));
ok("delete clears the session cookie", route.includes("SESSION_COOKIE"));
ok("delete refuses platform admins", route.includes("platformAdmin"));
ok("delete counts subTenants", route.includes("subTenants"));
const exportBlock = route.slice(
  route.indexOf('privacy.get("/export"'),
  route.indexOf('privacy.post("/delete"'),
);
ok("export does not select passwordHash", !exportBlock.includes("passwordHash"));
ok("export does not select dnsToken or secrets", !exportBlock.includes("dnsToken") && !exportBlock.includes("accessToken"));
ok("export does not select email html/text bodies", !exportBlock.includes("html: true") && !exportBlock.includes("text: true"));
ok("export includes mailbox addresses and email metadata", exportBlock.includes("prisma.mailbox.findMany") && exportBlock.includes("prisma.email.findMany"));

const appTs = src("apps/api/src/routes/app.ts");
ok("dash mounts /privacy", appTs.includes('dash.route("/privacy", privacy)'));

const dash = src("apps/api/public/dashboard.html");
ok("dashboard has Download my data", dash.includes("/app/privacy/export"));
ok("dashboard has Delete account", dash.includes("/app/privacy/delete"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
