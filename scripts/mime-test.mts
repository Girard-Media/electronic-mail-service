// buildMime unit test — proves connected-account (Gmail/Graph) sends carry
// bodies + attachments correctly (the raw RFC822 the providers base64url-encode).
import { buildMime, toBase64Url, safeAttachmentFilename } from "../packages/providers/src/mime.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`); if (!c) fail++; };

const raw = buildMime({
  emailId: "e1",
  from: "you@electronicmailservices.com",
  to: ["a@x.com", "b@y.com"],
  cc: ["c@z.com"],
  subject: "Schöne Grüße", // non-ASCII → RFC 2047 encoded-word
  text: "hello",
  html: "<p>hello</p>",
  headers: { "X-Custom": "1" },
  attachments: [{ filename: "report.pdf", content: Buffer.from("%PDF-1.4 fake").toString("base64"), contentType: "application/pdf" }],
});

ok("has From/To", raw.includes("From: you@electronicmailservices.com") && raw.includes("To: a@x.com, b@y.com"));
ok("has Cc", raw.includes("Cc: c@z.com"));
ok("encodes non-ASCII subject (RFC 2047)", /Subject: =\?UTF-8\?B\?/.test(raw));
ok("custom header passed through", raw.includes("X-Custom: 1"));
ok("multipart/mixed (body + attachment)", raw.includes("multipart/mixed"));
ok("alternative for text+html", raw.includes("multipart/alternative"));
ok("attachment present", raw.includes('filename="report.pdf"') && raw.includes("application/pdf"));
ok("attachment disposition", raw.includes("Content-Disposition: attachment"));
ok("toBase64Url strips padding", !toBase64Url("any").includes("="));

// no-attachment case stays simple
const simple = buildMime({ emailId: "e2", from: "y@electronicmailservices.com", to: ["a@x.com"], subject: "Hi", html: "<p>x</p>" });
ok("no-attachment is not multipart/mixed", !simple.includes("multipart/mixed"));

// Header-injection: a CR/LF-bearing subject must be RFC-2047 encoded (single
// line), never emitted raw — else it injects headers into the Gmail/Graph MIME.
const inj = buildMime({ emailId: "e3", from: "y@electronicmailservices.com", to: ["a@x.com"], subject: "Order x\r\nBcc: evil@x.com", text: "hi" });
ok("CRLF subject is encoded (no header injection)", /Subject: =\?UTF-8\?B\?/.test(inj) && !inj.includes("\r\nBcc: evil@x.com"));

const fromInj = buildMime({
  emailId: "e3b",
  from: "You\r\nBcc: evil@x.com <you@electronicmailservices.com>",
  to: ["a@x.com"],
  subject: "Hi",
  text: "hi",
});
ok(
  "CRLF in From is stripped (no header injection)",
  !fromInj.includes("\r\nBcc: evil@x.com") && fromInj.includes("From:"),
);

// Custom header VALUES must be sanitized the same way — a CR/LF in a header value
// can't inject another header (e.g. Bcc); malformed header NAMES are dropped.
const hdr = buildMime({ emailId: "e4", from: "y@electronicmailservices.com", to: ["a@x.com"], subject: "Hi", text: "hi", headers: { "X-Foo": "bar\r\nBcc: evil@x.com", "Bad Key": "x", "X-Ok": "fine" } });
ok("custom header CRLF neutralized (no injected Bcc)", !hdr.includes("\r\nBcc: evil@x.com") && hdr.includes("X-Foo: bar"));
ok("malformed header key dropped", !hdr.includes("Bad Key:") && hdr.includes("X-Ok: fine"));

ok("safeAttachmentFilename strips CR/LF", safeAttachmentFilename("x\r\nBcc: evil@x.com.pdf") === "x_Bcc: evil@x.com.pdf");
ok("safeAttachmentFilename empty becomes attachment", safeAttachmentFilename("   ") === "attachment");
const evilAtt = buildMime({
  emailId: "e5",
  from: "y@electronicmailservices.com",
  to: ["a@x.com"],
  subject: "Hi",
  text: "hi",
  attachments: [{ filename: "x\r\nBcc: evil@x.com.pdf", content: Buffer.from("a").toString("base64") }],
});
ok("filename CRLF not injected into MIME", !evilAtt.includes("\r\nBcc:") && evilAtt.includes("filename="));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
