// Inbound message parser — turns a raw RFC822 message delivered to a native
// mailbox into the fields we store (from/to/subject/body/snippet). Dependency-
// free; handles the common real-world shapes: text/plain, text/html,
// multipart/alternative + mixed, base64 + quoted-printable transfer encodings,
// and RFC 2047 encoded-words in headers. Attachments are skipped for P1 (body
// only); raw RFC822 → R2 comes later for full fidelity.

export interface InboundMessage {
  from: string;
  to: string[];
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  /** Oldest → newest, as sent. May be empty. */
  references: string[];
  text?: string;
  html?: string;
  snippet: string;
}

function splitHeaders(raw: string): [string, string] {
  const i = raw.search(/\r?\n\r?\n/);
  if (i === -1) return [raw, ""];
  const sep = raw.charAt(i) === "\r" ? 4 : 2;
  return [raw.slice(0, i), raw.slice(i + sep)];
}

function header(block: string, name: string): string | undefined {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, "im"));
  return m?.[1]?.trim();
}

function param(ct: string | undefined, key: string): string | undefined {
  const m = ct?.match(new RegExp(`${key}\\s*=\\s*"?([^";]+)"?`, "i"));
  return m?.[1]?.trim();
}

/** Decode a transfer-encoded body to a UTF-8 string. */
function decodeBody(body: string, enc: string | undefined): string {
  const e = (enc ?? "").toLowerCase();
  if (e === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (e === "quoted-printable") {
    // =XX are raw bytes — map to Latin-1 chars then re-decode the byte stream as
    // UTF-8 so multi-byte sequences (=C3=B6 → ö) come through correctly.
    const latin1 = body
      .replace(/=\r?\n/g, "") // soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(latin1, "latin1").toString("utf8");
  }
  return body;
}

/** Decode RFC 2047 encoded-words in a header value (=?UTF-8?B?..?= / ?Q?..?=). */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, enc, txt) => {
    try {
      if (enc.toUpperCase() === "B") return Buffer.from(txt, "base64").toString("utf8");
      // Q-encoding: _ = space, =XX = byte. Re-decode the byte stream as UTF-8.
      const latin1 = txt
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(latin1, "latin1").toString("utf8");
    } catch {
      return txt;
    }
  });
}

function splitParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((p) => p.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
    .filter((p) => p && p !== "--" && !p.startsWith("--"));
}

/** Recursively pull the best text + html body out of a (possibly multipart) entity. */
function bodies(head: string, body: string, out: { text?: string; html?: string }): void {
  const ct = header(head, "Content-Type") ?? "text/plain";
  if (/^multipart\//i.test(ct)) {
    const boundary = param(ct, "boundary");
    if (!boundary) return;
    for (const part of splitParts(body, boundary)) {
      const [ph, pb] = splitHeaders(part);
      bodies(ph, pb, out);
    }
    return;
  }
  const decoded = decodeBody(body, header(head, "Content-Transfer-Encoding"));
  if (/^text\/html/i.test(ct)) {
    if (out.html === undefined) out.html = decoded;
  } else if (/^text\/plain/i.test(ct)) {
    if (out.text === undefined) out.text = decoded;
  }
  // other content types (attachments) are ignored for P1
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

export function parseInboundMessage(raw: string): InboundMessage {
  const [head, body] = splitHeaders(raw);
  const out: { text?: string; html?: string } = {};
  bodies(head, body, out);
  const to = (header(head, "To") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mid = header(head, "Message-ID");
  const snippetSrc = out.text ?? (out.html ? stripHtml(out.html) : "");
  const references = (header(head, "References") ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  return {
    from: decodeWords(header(head, "From") ?? ""),
    to,
    subject: decodeWords(header(head, "Subject") ?? ""),
    messageId: mid,
    inReplyTo: header(head, "In-Reply-To"),
    references,
    text: out.text,
    html: out.html,
    snippet: snippetSrc.replace(/\s+/g, " ").trim().slice(0, 200),
  };
}
