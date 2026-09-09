// Dashboard write-guard: path → permission. A viewer hitting POST /app/keys
// must map to key:write (denied), not fall through as allow.
import { permForAppWrite } from "../apps/api/src/lib/require-perm.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

ok("GET is always allow", permForAppWrite("GET", "/app/keys") === "allow");
ok("HEAD is allow", permForAppWrite("HEAD", "/app/emails") === "allow");
ok("team router left to its own can()", permForAppWrite("POST", "/app/team/invites") === "allow");
ok("billing router left alone", permForAppWrite("POST", "/app/billing/connect") === "allow");
ok("privacy delete is self-service (any role, route checks password)", permForAppWrite("POST", "/app/privacy/delete") === "allow");
ok("privacy export is GET allow", permForAppWrite("GET", "/app/privacy/export") === "allow");
ok("list verify is read-like", permForAppWrite("POST", "/app/verify") === "allow");
ok("template preview is read-like", permForAppWrite("POST", "/app/templates/preview") === "allow");

ok("test send needs email:send", permForAppWrite("POST", "/app/test-email") === "email:send");
ok("cancel needs email:send", permForAppWrite("POST", "/app/emails/abc/cancel") === "email:send");
ok("create key needs key:write", permForAppWrite("POST", "/app/keys") === "key:write");
ok("revoke key needs key:write", permForAppWrite("DELETE", "/app/keys/k1") === "key:write");
ok("add domain needs domain:write", permForAppWrite("POST", "/app/domains") === "domain:write");
ok("tracking toggle needs domain:write", permForAppWrite("PATCH", "/app/domains/d1/tracking") === "domain:write");
ok("import needs domain:write", permForAppWrite("POST", "/app/import") === "domain:write");
ok("suppress add needs suppression:write", permForAppWrite("POST", "/app/suppressions") === "suppression:write");
ok("verify-suppress needs suppression:write", permForAppWrite("POST", "/app/verify/suppress") === "suppression:write");
ok("template create needs template:write", permForAppWrite("POST", "/app/templates") === "template:write");
ok("branding needs branding:write", permForAppWrite("PUT", "/app/branding") === "branding:write");
ok("mailbox create needs mailbox:write", permForAppWrite("POST", "/app/mailboxes") === "mailbox:write");
ok("mailbox compose needs mailbox:write", permForAppWrite("POST", "/app/mailboxes/x/send") === "mailbox:write");
ok("mailbox forward add needs mailbox:write", permForAppWrite("POST", "/app/mailboxes/x/forwards") === "mailbox:write");
ok("mailbox GET is allow", permForAppWrite("GET", "/app/mailboxes") === "allow");
ok("webhook create needs webhook:write", permForAppWrite("POST", "/app/webhooks") === "webhook:write");
ok("disconnect mailbox needs mailbox:write", permForAppWrite("DELETE", "/app/connected-accounts/x") === "mailbox:write");
ok("campaign create needs email:send", permForAppWrite("POST", "/app/campaigns") === "email:send");
ok("campaign pool attach needs email:send", permForAppWrite("PUT", "/app/campaigns/c1/mailboxes") === "email:send");
ok("campaign GET is allow", permForAppWrite("GET", "/app/campaigns") === "allow");
ok("inbox threads GET is allow", permForAppWrite("GET", "/app/inbox/threads") === "allow");

ok("works without /app prefix", permForAppWrite("POST", "/keys") === "key:write");
ok("unknown write fails closed", permForAppWrite("POST", "/app/not-a-real-route") === "deny");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
