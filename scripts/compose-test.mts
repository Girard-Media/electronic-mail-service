/**
 * Campaign compose (send-path step 5) + CAN-SPAM validate.
 */
import { composeCampaignMessage, expandSpintax } from "../packages/sequence/src/index.js";
import { validateMessage } from "../packages/policy/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const unsub = "https://api.electronicmailservices.com/u/token";
const base = {
  intentId: "int_1",
  subject: "Quick question for {{firstName}}",
  bodyText: "Hi {{firstName}}, saw {Northwind|your team} shipping faster.",
  lead: { email: "dana@acme.com", firstName: "Dana", lastName: "Ng", companyName: "Acme" },
  mailbox: { address: "alex@nw-labs.com", displayName: "Alex Rivera" },
  persona: {
    firstName: "Alex", lastName: "Rivera",
    postalAddress: "21 Bridge St, Austin TX 78701",
    signatureText: "Alex Rivera\nNorthwind Labs\n21 Bridge St, Austin TX 78701",
  },
  unsubscribeUrl: unsub,
};

console.log("\n--- spintax ---");
ok("spintax is deterministic per seed", expandSpintax("{a|b|c}", "s") === expandSpintax("{a|b|c}", "s"));
ok("braces without a pipe are left alone", expandSpintax("{not-spin}", "s") === "{not-spin}");

console.log("\n--- compose ---");
const msg = composeCampaignMessage(base);
ok("subject interpolates firstName", msg.subject === "Quick question for Dana");
ok("body includes the postal address", msg.bodyText.includes("21 Bridge St, Austin TX 78701"));
ok("body includes the unsubscribe URL", msg.bodyText.includes(unsub));
ok("Message-ID is the intent id", msg.messageId === "<int_1@electronicmailservices.com>");
ok("List-Unsubscribe is one-click ready",
  msg.headers["List-Unsubscribe"] === `<${unsub}>` &&
  msg.headers["List-Unsubscribe-Post"]?.includes("One-Click") === true);
ok("from display name matches the persona", msg.fromDisplayName === "Alex Rivera");
ok("plain-text-first: no HTML unless given", msg.bodyHtml === null);

const html = composeCampaignMessage({ ...base, bodyHtml: "<p>Hi {{firstName}}</p>" });
ok("html interpolates and still carries the footer link",
  (html.bodyHtml ?? "").includes("Dana") && (html.bodyHtml ?? "").includes(unsub));

console.log("\n--- CAN-SPAM ---");
const v = validateMessage({
  subject: msg.subject,
  bodyText: msg.bodyText,
  bodyHtml: msg.bodyHtml,
  fromAddress: msg.fromAddress,
  fromDisplayName: msg.fromDisplayName,
  personaName: msg.personaName,
  postalAddress: msg.postalAddress,
  unsubscribeUrl: msg.unsubscribeUrl,
  headers: msg.headers,
  isFirstTouch: true,
  fromDomainVerified: true,
});
ok("composed mail passes CAN-SPAM validation", v.ok, v.defects.join(","));
const bad = validateMessage({
  subject: "RE: hey",
  bodyText: "hi",
  bodyHtml: null,
  fromAddress: msg.fromAddress,
  fromDisplayName: "Not Alex",
  personaName: "Alex Rivera",
  postalAddress: null,
  unsubscribeUrl: null,
  headers: {},
  isFirstTouch: true,
  fromDomainVerified: false,
});
ok("missing footer and RE: first-touch fail closed", !bad.ok && bad.defects.length >= 3);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
