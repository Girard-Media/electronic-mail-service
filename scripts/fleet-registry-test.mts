/**
 * Fleet identity + lifecycle gates (E05-010, E05-015, E05-022, E05-003).
 * Pure — no database, no DNS.
 */
import {
  isRoleLocalPart,
  isValidLocalPart,
  mailboxSlotError,
  MAX_MAILBOXES_PER_DOMAIN,
  postalAddressError,
  personaSignature,
  nextStatusAfterDns,
  domainAuthComplete,
  warmDomainError,
  activateDomainError,
  warmMailboxError,
  activateMailboxError,
} from "../packages/fleet/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

console.log("\n--- local parts ---");
ok("sales is a role local-part", isRoleLocalPart("Sales"));
ok("noreply is a role local-part", isRoleLocalPart("no-reply"));
ok("alex is allowed", !isRoleLocalPart("alex"));
ok("dots in a real name are valid", isValidLocalPart("alex.rivera"));
ok("spaces are not", !isValidLocalPart("alex rivera"));
ok("the 4th mailbox on a domain is refused", mailboxSlotError(3) !== null);
ok("the cap is 3", MAX_MAILBOXES_PER_DOMAIN === 3);
ok("two mailboxes still fit", mailboxSlotError(2) === null);

console.log("\n--- persona / CAN-SPAM ---");
ok("empty postal address is refused", postalAddressError("  ") !== null);
ok("address without a number is refused", postalAddressError("Bridge Street Austin") !== null);
ok("a real street line is accepted", postalAddressError("21 Bridge St, Austin TX 78701") === null);
{
  const sig = personaSignature({
    firstName: "Alex", lastName: "Rivera", title: "Founder",
    companyName: "Northwind Labs", postalAddress: "21 Bridge St, Austin TX 78701",
  });
  ok("signature includes the postal address", sig.text.includes("21 Bridge St"));
  ok("and the name", sig.text.startsWith("Alex Rivera"));
  ok("html is escaped", !sig.html.includes("<script>") && sig.html.includes("<br>"));
}

console.log("\n--- domain DNS promotions ---");
const none = { spfOk: false, dkimOk: false, dmarcOk: false, mxOk: false };
const all = { spfOk: true, dkimOk: true, dmarcOk: true, mxOk: true };
ok("incomplete auth is not complete", !domainAuthComplete(none));
ok("REGISTERED with partial DNS becomes DNS_PENDING, not WARMING",
  nextStatusAfterDns("REGISTERED", { ...none, spfOk: true }) === "DNS_PENDING");
ok("REGISTERED with full DNS still stops at DNS_PENDING (no skip)",
  nextStatusAfterDns("REGISTERED", all) === "DNS_PENDING");
ok("DNS_PENDING with full DNS becomes AGING", nextStatusAfterDns("DNS_PENDING", all) === "AGING");
ok("AGING does not auto-warm", nextStatusAfterDns("AGING", all) === "AGING");

const now = new Date("2026-09-09T12:00:00Z");
ok("AGING cannot warm before ageReadyAt",
  warmDomainError("AGING", all, new Date("2026-09-23T00:00:00Z"), now) !== null);
ok("AGING can warm once ageReadyAt has passed",
  warmDomainError("AGING", all, new Date("2026-08-01T00:00:00Z"), now) === null);
ok("REGISTERED cannot warm even with perfect DNS", warmDomainError("REGISTERED", all, now, now) !== null);
ok("only WARMING domains activate", activateDomainError("AGING", all) !== null);
ok("WARMING activates when auth still holds", activateDomainError("WARMING", all) === null);
ok("WARMING refuses activate if DKIM dropped", activateDomainError("WARMING", none) !== null);

console.log("\n--- mailbox promotions ---");
ok("CREATED mailbox warms on an AGING domain", warmMailboxError("CREATED", "AGING") === null);
ok("CREATED mailbox refuses on REGISTERED domain", warmMailboxError("CREATED", "REGISTERED") !== null);
ok("ACTIVE mailbox does not re-warm", warmMailboxError("ACTIVE", "ACTIVE") !== null);
ok("WARMING mailbox activates only on ACTIVE domain", activateMailboxError("WARMING", "WARMING") !== null);
ok("WARMING mailbox activates on ACTIVE domain", activateMailboxError("WARMING", "ACTIVE") === null);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
