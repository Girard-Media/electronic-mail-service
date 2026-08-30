import { randomBytes } from "node:crypto";
import type { NormalizedMessage, NormalizedAttachment } from "./types.js";

// Minimal, correct RFC 2822 / MIME builder used by connected-account providers
// (Gmail requires a raw base64url message). Bodies and attachments are
// base64-encoded; non-ASCII subjects use RFC 2047 encoded-words.

const CRLF = "\r\n";

// RFC 2047-encode when the value contains anything outside printable ASCII —
// crucially INCLUDING control chars (CR/LF/TAB). A raw CR/LF in a header value
// would otherwise inject arbitrary headers (e.g. Bcc) into the hand-built MIME
// that Gmail/Graph send; encoding neutralizes it.
const encHeader = (s: string): string =>
  /[^\x20-\x7E]/.test(s)
    ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`
    : s;

const b64wrap = (buf: Buffer): string =>
  (buf.toString("base64").match(/.{1,76}/g) ?? []).join(CRLF);

const boundary = (): string => `=_um_${randomBytes(12).toString("hex")}`;

interface Entity {
  headers: string[];
  body: string;
}

const leaf = (contentType: string, content: string): Entity => ({
  headers: [
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
  ],
  body: b64wrap(Buffer.from(content, "utf8")),
});

/** Header-safe filename: no CR/LF/quotes/slashes that could inject MIME headers. */
export function safeAttachmentFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n\0"\\/]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || "attachment";
}

const attachmentEntity = (a: NormalizedAttachment): Entity => {
  const filename = safeAttachmentFilename(a.filename);
  return {
    headers: [
      `Content-Type: ${a.contentType || "application/octet-stream"}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
    ],
    // `content` is base64 per NormalizedAttachment; re-wrap to 76-char lines.
    body: b64wrap(Buffer.from(a.content ?? "", "base64")),
  };
};

const renderEntity = (e: Entity): string =>
  `${e.headers.join(CRLF)}${CRLF}${CRLF}${e.body}`;

function multipart(subtype: string, parts: Entity[]): Entity {
  const b = boundary();
  const body =
    parts.map((p) => `--${b}${CRLF}${renderEntity(p)}`).join(CRLF) +
    `${CRLF}--${b}--`;
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${b}"`], body };
}

function bodyEntity(msg: NormalizedMessage): Entity {
  const hasText = typeof msg.text === "string" && msg.text.length > 0;
  const hasHtml = typeof msg.html === "string" && msg.html.length > 0;
  let main: Entity;
  if (hasText && hasHtml) {
    main = multipart("alternative", [
      leaf("text/plain", msg.text!),
      leaf("text/html", msg.html!),
    ]);
  } else if (hasHtml) {
    main = leaf("text/html", msg.html!);
  } else {
    main = leaf("text/plain", msg.text ?? "");
  }
  const atts = msg.attachments ?? [];
  return atts.length
    ? multipart("mixed", [main, ...atts.map(attachmentEntity)])
    : main;
}

/** Strip CR/LF/NUL so an address field cannot inject extra MIME headers. */
export function headerLineValue(s: string): string {
  return s.replace(/[\r\n\0]+/g, " ").trim();
}

/** Build a raw RFC 2822 message from a NormalizedMessage. */
export function buildMime(msg: NormalizedMessage): string {
  const top: string[] = [
    `From: ${headerLineValue(msg.from)}`,
    `To: ${msg.to.map(headerLineValue).join(", ")}`,
  ];
  if (msg.cc?.length) top.push(`Cc: ${msg.cc.map(headerLineValue).join(", ")}`);
  if (msg.bcc?.length) top.push(`Bcc: ${msg.bcc.map(headerLineValue).join(", ")}`);
  if (msg.replyTo?.length) top.push(`Reply-To: ${msg.replyTo.map(headerLineValue).join(", ")}`);
  top.push(`Subject: ${encHeader(msg.subject)}`);
  top.push("MIME-Version: 1.0");
  // Custom headers: only well-formed names, and sanitize values the same way as
  // Subject (strip CR/LF, RFC 2047-encode control/non-ASCII) so a header value
  // can never inject additional headers (e.g. Bcc) into the raw MIME.
  for (const [k, v] of Object.entries(msg.headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(k)) continue;
    top.push(`${k}: ${encHeader(String(v).replace(/[\r\n]+/g, " "))}`);
  }
  const ent = bodyEntity(msg);
  return `${top.concat(ent.headers).join(CRLF)}${CRLF}${CRLF}${ent.body}`;
}

/** base64url with padding stripped — the form the Gmail API expects for `raw`. */
export const toBase64Url = (raw: string): string =>
  Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
