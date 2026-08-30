// Gate for the public /inboxes API (planning/AGENT_EMAIL.md A1): shared-domain
// username rules, plan caps, and wiring-drift guards over the source — the
// spoof-guard branch in send.ts and the full-access gates in inboxes.ts are
// security boundaries, so a refactor that drops them must fail this script.
import { readFileSync } from "node:fs";
import {
  validateInboxUsername,
  parseSharedInboxDomains,
  isSharedInboxDomain,
  RESERVED_INBOX_USERNAMES,
} from "../packages/core/src/mailbox.js";
import { PLANS, planLimits, isUnlimited } from "../packages/core/src/plans.js";

let f = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log((c ? "✓" : "✗") + " " + n + (x ? " — " + x : ""));
  if (!c) f++;
};
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- validateInboxUsername -------------------------------------------------
ok("simple name ok", validateInboxUsername("scout").ok);
ok(
  "uppercase normalized",
  (() => { const r = validateInboxUsername("  Scout.Bot  "); return r.ok && r.username === "scout.bot"; })(),
);
ok("digits, dot, dash, underscore ok", validateInboxUsername("agent-7.dev_x").ok);
ok("too short rejected", !validateInboxUsername("ab").ok);
ok("64 chars ok", validateInboxUsername("a".repeat(64)).ok);
ok("65 chars rejected", !validateInboxUsername("a".repeat(65)).ok);
ok("plus rejected (sub-address separator)", !validateInboxUsername("me+tag").ok);
ok("leading dot rejected", !validateInboxUsername(".hidden").ok);
ok("trailing dash rejected", !validateInboxUsername("bot-").ok);
ok("consecutive dots rejected", !validateInboxUsername("a..b").ok);
ok("space rejected", !validateInboxUsername("two words").ok);
ok("unicode rejected", !validateInboxUsername("ünïcode").ok);

// --- reserved names (phishing surface on OUR domain) ------------------------
for (const name of ["postmaster", "abuse", "admin", "support", "noreply", "ems", "security", "billing"]) {
  ok(`"${name}" reserved`, RESERVED_INBOX_USERNAMES.has(name) && !validateInboxUsername(name).ok);
}
ok("reserved names all validate as shapes", [...RESERVED_INBOX_USERNAMES].every((n) => /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/.test(n)));

// --- shared inbox domains (multi-domain: agents.* + inbox.* etc.) -----------
ok(
  "parses a comma list, lowercased + trimmed",
  JSON.stringify(parseSharedInboxDomains(" Agents.ElectronicMailServices.com , inbox.electronicmailservices.com ")) ===
    JSON.stringify(["agents.electronicmailservices.com", "inbox.electronicmailservices.com"]),
);
ok("dedupes", parseSharedInboxDomains("a.com,a.com,b.com").length === 2);
ok("drops blanks", parseSharedInboxDomains("a.com,,  ,b.com").length === 2);
ok("strips a trailing dot (FQDN form)", parseSharedInboxDomains("a.com.")[0] === "a.com");
ok("empty config → empty list (no accidental allow)", parseSharedInboxDomains("").length === 0);
const SHARED = parseSharedInboxDomains("agents.electronicmailservices.com,inbox.electronicmailservices.com");
ok("membership matches", isSharedInboxDomain("inbox.electronicmailservices.com", SHARED));
ok("membership is case-insensitive", isSharedInboxDomain("Inbox.ElectronicMailServices.COM", SHARED));
ok("non-member rejected", !isSharedInboxDomain("evil.com", SHARED));
ok(
  "apex electronicmailservices.com is NOT a shared inbox domain (system-send only)",
  !isSharedInboxDomain("electronicmailservices.com", SHARED),
);

// --- plan caps ---------------------------------------------------------------
ok("every plan defines a mailbox cap", Object.values(PLANS).every((p) => typeof p.mailboxes === "number"));
ok("free tier is finite (squatting guard)", !isUnlimited(planLimits("free").mailboxes) && planLimits("free").mailboxes === 3);
ok("enterprise unlimited", isUnlimited(planLimits("enterprise").mailboxes));
ok("caps grow monotonically free→pro→scale", planLimits("free").mailboxes < planLimits("pro").mailboxes && planLimits("pro").mailboxes < planLimits("scale").mailboxes);

// --- wiring drift guards -----------------------------------------------------
const sendTs = src("apps/api/src/lib/send.ts");
ok(
  "send.ts gates shared-domain From on mailbox OWNERSHIP (spoof guard)",
  sendTs.includes("isSharedInboxDomain(fromDomain") &&
    /projectId,\s*address:\s*fromAddress,\s*status:\s*"active"/.test(sendTs),
);
ok(
  "send.ts applies sharedInboxSendDecision before mailbox lookup",
  sendTs.includes("sharedInboxSendDecision") &&
    sendTs.indexOf("sharedInboxSendDecision") < sendTs.indexOf("create that inbox first"),
);
ok(
  "shared domain is NOT in SYSTEM_SENDING_DOMAINS (blanket allow would enable cross-project spoofing)",
  !/SYSTEM_SENDING_DOMAINS\s*=\s*new Set\(\[[^\]]*agents\./.test(src("packages/core/src/schema.ts")),
);

const inboxesTs = src("apps/api/src/routes/inboxes.ts");
ok("inboxes router requires API-key auth", inboxesTs.includes('inboxes.use("*", apiKeyAuth)'));
ok(
  "shared-domain create uses sharedInboxSendDecision",
  inboxesTs.includes("sharedInboxSendDecision") &&
    inboxesTs.includes("errors.emailUnverified()") &&
    inboxesTs.includes("errors.sharedInboxSendingDisabled()"),
);
ok(
  "inbox lifecycle (create/update/delete) is full-access-gated",
  (inboxesTs.match(/requireFullAccess\(c\)/g) ?? []).length >= 3,
);
ok("router is mounted", src("apps/api/src/index.ts").includes('app.route("/inboxes", inboxes)'));
ok(
  'GET /inboxes/domains is declared BEFORE /:id (else "domains" matches as an id)',
  inboxesTs.indexOf('inboxes.get("/domains"') > 0 &&
    inboxesTs.indexOf('inboxes.get("/domains"') < inboxesTs.indexOf('inboxes.get("/:id"'),
);
ok(
  "shared-domain receive readiness fails closed",
  /catch\s*{\s*receiving = false/.test(inboxesTs),
);

const workerTs = src("apps/workers/src/index.ts");
ok(
  "worker signs shared-inbox From via MTA OpenDKIM (not a tenant Domain row)",
  workerTs.includes("isSharedInboxDomain") &&
    workerTs.includes("parseSharedInboxDomains") &&
    /isSharedInboxDomain\(fromDomain/.test(workerTs) &&
    workerTs.includes("&& !sharedInbox"),
);

const sdkInboxes = src("packages/sdk/src/inboxes.ts");
ok("SDK inboxes resource exists", sdkInboxes.includes("createInboxesResource"));
ok("SDK covers create/list/get/send/reply/domains", 
  ["/inboxes", "/inboxes/domains", "/send", "/reply", "/threads"].every((p) => sdkInboxes.includes(p)),
);
ok(
  "SDK EMS exposes inboxes",
  src("packages/sdk/src/index.ts").includes("this.inboxes = createInboxesResource"),
);

const appTs = src("apps/api/src/routes/app.ts");
ok(
  "dashboard send/reply share the lib (surfaces can't drift)",
  appTs.includes("sendFromMailbox(") && appTs.includes("replyToMessage("),
);
ok(
  "Mailbox.domainId is nullable (shared-domain inboxes)",
  /domainId\s+String\?/.test(src("packages/db/prisma/schema.prisma")),
);
ok(
  "migration 0019 drops the NOT NULL",
  src("packages/db/prisma/migrations/0019_shared_agent_inboxes/migration.sql").includes(
    'ALTER COLUMN "domainId" DROP NOT NULL',
  ),
);

console.log(f === 0 ? "\nALL PASS" : `\n${f} FAIL`);
process.exit(f ? 1 : 0);
