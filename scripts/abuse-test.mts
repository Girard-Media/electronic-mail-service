// Abuse screening: system-domain send gate, suppression address shape,
// attachment path/size, and wiring drift guards so send.ts / auth / workers
// cannot silently drop the checks.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recipientAddress,
  storedAttachments,
  systemDomainSendDecision,
  sharedInboxSendDecision,
} from "../packages/core/src/abuse.js";
import {
  MAX_ATTACHMENT_BYTES,
  SYSTEM_SENDING_DOMAINS,
  attachmentSchema,
  base64DecodedBytes,
  sendEmailSchema,
} from "../packages/core/src/schema.js";
import { errors } from "../packages/core/src/errors.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

ok(
  "system sending domain is only electronicmailservices.com",
  SYSTEM_SENDING_DOMAINS.size === 1 && SYSTEM_SENDING_DOMAINS.has("electronicmailservices.com"),
);

ok(
  "recipientAddress: bare lowercases",
  recipientAddress("User@X.com") === "user@x.com",
);
ok(
  "recipientAddress: display-name form extracts + lowercases",
  recipientAddress("Bob <User@X.com>") === "user@x.com",
);
ok(
  "recipientAddress: trims",
  recipientAddress("  a@b.com  ") === "a@b.com",
);
ok(
  "recipientAddress: quoted display name",
  recipientAddress('"Acme Inc" <HELLO@acme.io>') === "hello@acme.io",
);

ok(
  "systemDomain: custom domain always allowed",
  systemDomainSendDecision({
    fromDomain: "acme.io",
    internal: false,
    ownerVerified: false,
  }) === "allow",
);
ok(
  "systemDomain: internal platform mail allowed unverified",
  systemDomainSendDecision({
    fromDomain: "electronicmailservices.com",
    internal: true,
    ownerVerified: false,
  }) === "allow",
);
ok(
  "systemDomain: verified owner still needs a mailbox (no security@ spoof)",
  systemDomainSendDecision({
    fromDomain: "electronicmailservices.com",
    internal: false,
    ownerVerified: true,
  }) === "need_mailbox",
);
ok(
  "systemDomain: unverified customer blocked",
  systemDomainSendDecision({
    fromDomain: "electronicmailservices.com",
    internal: false,
    ownerVerified: false,
  }) === "need_verification",
);

ok(
  "sharedInbox: verified + enabled allows",
  sharedInboxSendDecision({ internal: false, ownerVerified: true, sendingEnabled: true }) === "allow",
);
ok(
  "sharedInbox: unverified customer blocked",
  sharedInboxSendDecision({ internal: false, ownerVerified: false, sendingEnabled: true }) === "need_verification",
);
ok(
  "sharedInbox: kill switch refuses even verified",
  sharedInboxSendDecision({ internal: false, ownerVerified: true, sendingEnabled: false }) === "killed",
);
ok(
  "sharedInbox: internal mail skips kill switch + verify",
  sharedInboxSendDecision({ internal: true, ownerVerified: false, sendingEnabled: false }) === "allow",
);

const ev = errors.emailUnverified();
ok(
  "emailUnverified is 403 email_unverified",
  ev.statusCode === 403 && ev.name === "email_unverified",
);

ok("empty base64 is 0 bytes", base64DecodedBytes("") === 0);
ok("YQ== is 1 byte ('a')", base64DecodedBytes("YQ==") === 1);
ok("YWI= is 2 bytes ('ab')", base64DecodedBytes("YWI=") === 2);
ok("YWJj is 3 bytes ('abc')", base64DecodedBytes("YWJj") === 3);
ok("whitespace in base64 ignored", base64DecodedBytes("YQ =\n=") === 1);
ok("MAX_ATTACHMENT_BYTES is 40 MiB", MAX_ATTACHMENT_BYTES === 40 * 1024 * 1024);

ok(
  "attachment path rejected even with content",
  !attachmentSchema.safeParse({
    filename: "x.txt",
    path: "/etc/passwd",
    content: "YQ==",
  }).success,
);
ok(
  "attachment without content rejected",
  !attachmentSchema.safeParse({ filename: "x.txt" }).success,
);
ok(
  "attachment base64 content accepted",
  attachmentSchema.safeParse({ filename: "x.txt", content: "YQ==" }).success,
);

const mail = {
  from: "hello@electronicmailservices.com",
  to: "dest@example.com",
  subject: "hi",
  text: "x",
};
ok(
  "send schema: tiny attachment ok",
  sendEmailSchema.safeParse({
    ...mail,
    attachments: [{ filename: "x.txt", content: "YQ==" }],
  }).success,
);
ok(
  "send schema: CR/LF in from rejected",
  sendEmailSchema.safeParse({
    ...mail,
    from: "You\r\nBcc: evil@x.com <hello@electronicmailservices.com>",
  }).success === false,
);
ok(
  "send schema: path rejected",
  !sendEmailSchema.safeParse({
    ...mail,
    attachments: [{ filename: "x.txt", path: "https://evil.example/a" }],
  }).success,
);
ok(
  "send schema: 41 attachments rejected",
  !sendEmailSchema.safeParse({
    ...mail,
    attachments: Array.from({ length: 41 }, () => ({
      filename: "x.txt",
      content: "YQ==",
    })),
  }).success,
);

const overLen = Math.ceil(((MAX_ATTACHMENT_BYTES + 1) * 4) / 3);
const over = sendEmailSchema.safeParse({
  ...mail,
  attachments: [{ filename: "big.bin", content: "A".repeat(overLen) }],
});
ok(
  "send schema: decoded >40MB rejected",
  !over.success,
  over.success ? "wrongly accepted" : "",
);

const sendTs = src("apps/api/src/lib/send.ts");
ok(
  "storedAttachments: path-only dropped",
  storedAttachments([{ filename: "x.txt", path: "/etc/passwd" }]) === undefined,
);
ok(
  "storedAttachments: keeps content, drops path",
  JSON.stringify(
    storedAttachments([
      {
        filename: "x.txt",
        content: "YQ==",
        path: "https://evil.example/a",
        content_type: "text/plain",
      },
    ]),
  ) === JSON.stringify([{ filename: "x.txt", content: "YQ==", contentType: "text/plain" }]),
);
ok("storedAttachments: non-array is undefined", storedAttachments({ filename: "x" }) === undefined);

ok("send.ts calls systemDomainSendDecision", sendTs.includes("systemDomainSendDecision"));
ok("send.ts requires mailbox on system domain", sendTs.includes('sys === "need_mailbox"'));
ok("send.ts calls sharedInboxSendDecision", sendTs.includes("sharedInboxSendDecision"));
ok("send.ts throws sharedInboxSendingDisabled", sendTs.includes("errors.sharedInboxSendingDisabled()"));
ok("send.ts normalizes recipients via recipientAddress", sendTs.includes("recipientAddress"));
ok("send.ts throws emailUnverified", sendTs.includes("errors.emailUnverified()"));
ok("send.ts accepts opts.internal", sendTs.includes("opts?: { internal?: boolean }"));
ok("send.ts persists attachments without path", sendTs.includes("content_type: a.content_type"));

const authTs = src("apps/api/src/routes/auth.ts");
ok("signup IP throttle", authTs.includes("signup:ip:"));
ok("signup email throttle", authTs.includes("signup:email:"));
ok("login per-email hourly lockout", authTs.includes("login:email-hour:"));
ok("resend-verification throttles", authTs.includes("reverify:ip:") && authTs.includes("reverify:user:"));
ok("verification mail is internal", /enqueueEmail\([\s\S]*?\{ internal: true \}/.test(authTs));
ok(
  "non-prod signup returns verifyToken for e2e",
  authTs.includes('env.NODE_ENV === "production"') && authTs.includes("verifyToken"),
);

const teamTs = src("apps/api/src/routes/team.ts");
ok("invite mail is internal", teamTs.includes("{ internal: true }"));

const eventsTs = src("apps/workers/src/events.ts");
ok(
  "auto-suppress uses recipientAddress",
  eventsTs.includes("recipientAddress") && eventsTs.includes(".map(recipientAddress)"),
);

const workerTs = src("apps/workers/src/index.ts");
ok("webhook worker uses fetchPublicWebhook", workerTs.includes("fetchPublicWebhook"));

const e2e = src("scripts/e2e-trust.mts");
ok("SC-001 verifies email before sending", e2e.includes("/auth/verify") && e2e.includes("emailVerified"));
ok("worker maps attachments via storedAttachments", workerTs.includes("storedAttachments"));
ok("worker does not pass attachment path", !workerTs.includes("path: a.path"));

const smtpTs = src("packages/providers/src/smtp.ts");
ok("smtp never fetches attachment path", !smtpTs.includes("a.path"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
