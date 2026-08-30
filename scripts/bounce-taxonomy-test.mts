/**
 * Bounce taxonomy test (E09-088, E22-024).
 *
 * Runs the deterministic classifier from @ems/deliverability against a corpus of
 * real SMTP response strings and asserts both the class and the resulting action.
 *
 * The coverage gate matters as much as the assertions: classification coverage
 * must stay above 98% non-UNKNOWN (E09-089). An UNKNOWN is a work queue item,
 * not a shrug — if this number slips, the taxonomy has fallen behind the ESPs.
 */

import { classify, ACTION_BY_CLASS } from "../packages/deliverability/src/index.js";
import type { BounceClass, BounceRuleRow, SmtpResponse } from "../packages/deliverability/src/index.js";
import { BOUNCE_RULES } from "../packages/db/src/seed/bounce-rules.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

// The seed rows as the classifier sees them.
const RULES: BounceRuleRow[] = BOUNCE_RULES.map((r, i) => ({
  id: `seed-${i}`,
  espFamily: r.espFamily,
  smtpCode: r.smtpCode,
  enhancedCode: r.enhancedCode,
  matchSubstr: r.matchSubstr,
  classify: r.classify,
  priority: r.priority,
  approved: true,
}));

/**
 * Corpus of responses as they actually appear in a Postfix maillog. Verbatim —
 * summarising them at capture time is exactly the mistake we refuse to make.
 */
const CORPUS: Array<{ res: SmtpResponse; expect: BounceClass; why: string }> = [
  // ── Google
  {
    res: { espFamily: "google", code: 550, enhanced: "5.1.1", raw: "550-5.1.1 The email account that you tried to reach does not exist. Please try 550-5.1.1 double-checking the recipient's email address." },
    expect: "HARD", why: "google unknown recipient",
  },
  {
    res: { espFamily: "google", code: 550, enhanced: "5.2.1", raw: "550-5.2.1 The email account that you tried to reach is disabled." },
    expect: "HARD", why: "google disabled account",
  },
  {
    res: { espFamily: "google", code: 421, enhanced: "4.7.0", raw: "421-4.7.0 Our system has detected an unusual rate of unsolicited mail originating from your IP address." },
    expect: "BLOCK_RATE", why: "the canonical too-fast signal",
  },
  {
    res: { espFamily: "google", code: 550, enhanced: "5.7.1", raw: "550-5.7.1 Our system has detected that this message is likely unsolicited mail." },
    expect: "BLOCK_REPUTATION", why: "google reputation block",
  },
  {
    res: { espFamily: "google", code: 550, enhanced: "5.7.26", raw: "550-5.7.26 This mail has been blocked because the sender is unauthenticated. Gmail requires all senders to authenticate with either SPF or DKIM." },
    expect: "AUTH", why: "our own authentication broke — Sev-1",
  },
  {
    res: { espFamily: "google", code: 452, enhanced: "4.2.2", raw: "452 4.2.2 The email account that you tried to reach is over quota." },
    expect: "MAILBOX_FULL", why: "google over quota",
  },

  // ── Microsoft
  {
    res: { espFamily: "microsoft", code: 550, enhanced: "5.7.1", raw: "550 5.7.1 Unfortunately, messages from [203.0.113.10] weren't sent. Please contact your Internet service provider. [S3150]" },
    expect: "BLOCK_REPUTATION", why: "the S3150 suspected-spam block",
  },
  {
    res: { espFamily: "microsoft", code: 550, enhanced: "5.7.606", raw: "550 5.7.606 Access denied, banned sending IP [203.0.113.10]" },
    expect: "BLOCK_REPUTATION", why: "microsoft IP block list — manual delisting",
  },
  {
    res: { espFamily: "microsoft", code: 550, enhanced: "5.1.10", raw: "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup" },
    expect: "HARD", why: "microsoft recipient not found",
  },
  {
    res: { espFamily: "microsoft", code: 421, enhanced: "4.7.500", raw: "421 4.7.500 Server busy, please try again later. Request is being throttled." },
    expect: "BLOCK_RATE", why: "microsoft throttle",
  },
  {
    res: { espFamily: "microsoft", code: 550, enhanced: "5.7.1", raw: "550 5.7.1 Service unavailable, message refused; sender not authenticated [S3115]" },
    expect: "AUTH", why: "microsoft authentication failure",
  },

  // ── Yahoo
  {
    res: { espFamily: "yahoo", code: 421, enhanced: "4.7.0", raw: "421 4.7.0 [TSS04] Messages from 203.0.113.10 temporarily deferred due to unexpected volume" },
    expect: "BLOCK_RATE", why: "yahoo rate limiting",
  },
  {
    res: { espFamily: "yahoo", code: 554, enhanced: "5.7.9", raw: "554 5.7.9 Message not accepted for policy reasons." },
    expect: "BLOCK_REPUTATION", why: "yahoo policy refusal",
  },
  {
    res: { espFamily: "yahoo", code: 550, enhanced: "5.1.1", raw: "550 5.1.1 no such user here" },
    expect: "HARD", why: "yahoo unknown user",
  },

  // ── Corporate filters
  {
    res: { espFamily: "proofpoint", code: 550, enhanced: "5.7.1", raw: "550 5.7.1 Service unavailable; Client host [203.0.113.10] blocked using zen.spamhaus.org" },
    expect: "BLOCK_REPUTATION", why: "proofpoint citing a DNSBL listing",
  },
  {
    res: { espFamily: "proofpoint", code: 451, enhanced: "4.7.1", raw: "451 4.7.1 Greylisting in effect, please come back later" },
    expect: "SOFT", why: "greylisting must retry, never count as failure",
  },
  {
    res: { espFamily: "mimecast", code: 550, enhanced: null, raw: "550 Envelope blocked - User Entry" },
    expect: "BLOCK_REPUTATION", why: "mimecast envelope block",
  },
  {
    res: { espFamily: "mimecast", code: 550, enhanced: null, raw: "550 Invalid Recipient" },
    expect: "HARD", why: "mimecast invalid recipient",
  },
  {
    res: { espFamily: "barracuda", code: 550, enhanced: null, raw: "550 permanent failure for one or more recipients: blocked by Barracuda Reputation System" },
    expect: "BLOCK_REPUTATION", why: "barracuda reputation block",
  },

  // ── Generic fallback layer: an ESP we have no rows for at all
  {
    res: { espFamily: "generic", code: 550, enhanced: "5.1.1", raw: "550 5.1.1 <nobody@example.net>: Recipient address rejected: User unknown" },
    expect: "HARD", why: "RFC 3463 fallback for an unknown ESP",
  },
  {
    res: { espFamily: "generic", code: 452, enhanced: "4.2.2", raw: "452 4.2.2 Mailbox full" },
    expect: "MAILBOX_FULL", why: "generic quota",
  },
  {
    res: { espFamily: "generic", code: 451, enhanced: null, raw: "451 Temporary local problem - please try later" },
    expect: "SOFT", why: "bare 4xx with no enhanced code",
  },
  {
    res: { espFamily: "generic", code: 554, enhanced: null, raw: "554 Transaction failed" },
    expect: "POLICY", why: "bare 554",
  },

  // ── An ESP we have written no rows for at all. The generic layer must still
  //    catch it, otherwise every new receiver we meet lands in UNKNOWN.
  {
    res: { espFamily: "zoho", code: 550, enhanced: "5.1.1", raw: "550 5.1.1 Invalid User <nobody@example.org>" },
    expect: "HARD", why: "novel ESP falls through to the generic layer",
  },
  {
    res: { espFamily: "protonmail", code: 451, enhanced: "4.7.1", raw: "451 4.7.1 Please try again later" },
    expect: "BLOCK_RATE", why: "novel ESP, generic 4.7.1",
  },
  {
    res: { espFamily: "some-onprem-appliance", code: 552, enhanced: null, raw: "552 Requested mail action aborted: exceeded storage allocation" },
    expect: "MAILBOX_FULL", why: "novel ESP, bare 552",
  },
];

console.log("\n--- classification ---");
for (const c of CORPUS) {
  const got = classify(c.res, RULES);
  ok(`${c.res.espFamily} ${c.res.code} → ${c.expect}  (${c.why})`, got === c.expect, `got ${got}`);
}

console.log("\n--- actions follow from the class ---");
ok("HARD suppresses", ACTION_BY_CLASS.HARD.kind === "suppress");
ok("SOFT never suppresses, it retries", ACTION_BY_CLASS.SOFT.kind === "retry");
ok("BLOCK_RATE throttles the ESP rather than suppressing the recipient", ACTION_BY_CLASS.BLOCK_RATE.kind === "throttle-esp");
ok("BLOCK_REPUTATION escalates rather than retrying", ACTION_BY_CLASS.BLOCK_REPUTATION.kind === "escalate");
ok("AUTH escalates at Sev-1 — our own DKIM/SPF broke",
  ACTION_BY_CLASS.AUTH.kind === "escalate" &&
  "severity" in ACTION_BY_CLASS.AUTH && ACTION_BY_CLASS.AUTH.severity === "sev1");
ok("BLOCK_CONTENT pauses the campaign", ACTION_BY_CLASS.BLOCK_CONTENT.kind === "pause-campaign");

console.log("\n--- unmatched responses fall through honestly ---");
const nonsense = classify(
  { espFamily: "google", code: 599, enhanced: "5.9.9", raw: "599 something nobody has ever seen" },
  RULES,
);
ok("an unrecognised response is UNKNOWN, never a guess", nonsense === "UNKNOWN", `got ${nonsense}`);
ok("UNKNOWN retries rather than suppressing (a guess must not lose a lead)",
  ACTION_BY_CLASS.UNKNOWN.kind === "retry");

console.log("\n--- unapproved rules are never applied ---");
const unapproved: BounceRuleRow[] = [
  { id: "proposed", espFamily: "google", smtpCode: 599, enhancedCode: null, matchSubstr: null, classify: "HARD", priority: 1, approved: false },
];
ok("an AI-proposed rule awaiting approval does not classify",
  classify({ espFamily: "google", code: 599, enhanced: null, raw: "599 whatever" }, unapproved) === "UNKNOWN");

console.log("\n--- coverage gate ---");
const classified = CORPUS.filter((c) => classify(c.res, RULES) !== "UNKNOWN").length;
const coverage = (classified / CORPUS.length) * 100;
console.log(`  ${classified}/${CORPUS.length} classified — ${coverage.toFixed(1)}%`);
ok("coverage is above the 98% gate (E09-089)", coverage >= 98, `${coverage.toFixed(1)}%`);

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
