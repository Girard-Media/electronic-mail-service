// Delivery-feedback report parser — turns the raw RFC822 a recipient MX / ISP
// sends back to us into normalized feedback events. Dependency-free on purpose:
// DSN (RFC 3464) and ARF (RFC 5965) are tightly specified `multipart/report`
// formats, so a focused extractor beats pulling in a full MIME library and keeps
// the parser auditable (deliverability is non-negotiable — we own this code).
//
// Two report families:
//   • delivery-status (DSN)     — a recipient MX bounced or delayed the message.
//   • feedback-report (ARF)     — an ISP feedback loop relayed a spam complaint.
//
// Correlation back to the original send, most-trusted first:
//   1. VERP envelope recipient (handled by the ingest, passed in as a fallback id)
//   2. X-Entity-Ref-ID header we stamp on every send (= the email id)
//   3. Message-ID `<id@electronicmailservices.com>` we set deterministically
// The embedded original (message/rfc822 or text/rfc822-headers) carries 2 & 3.

export interface ParsedFeedback {
  type: "delivered" | "bounced" | "complained" | "delivery_delayed";
  /** email id recovered from the embedded original headers, if present */
  emailId?: string;
  /** original Message-ID, if present */
  messageId?: string;
  bounceType?: "hard" | "soft";
  /** the original recipient the report concerns */
  recipient?: string;
  /** human-readable diagnostic / reason */
  reason?: string;
  /** enhanced status code, e.g. "5.1.1" */
  code?: string;
}

/** Split a raw message into [headerBlock, body] on the first blank line. */
function splitHeaders(raw: string): [string, string] {
  const i = raw.search(/\r?\n\r?\n/);
  if (i === -1) return [raw, ""];
  const sep = raw.charAt(i) === "\r" ? 4 : 2;
  return [raw.slice(0, i), raw.slice(i + sep)];
}

/** Unfold (RFC 5322 continuation lines) then read a header value, first match. */
function header(block: string, name: string): string | undefined {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const re = new RegExp(`^${name}\\s*:\\s*(.*)$`, "im");
  const m = unfolded.match(re);
  return m?.[1]?.trim();
}

/** Extract the `boundary=...` token from a Content-Type header value. */
function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = contentType.match(/boundary\s*=\s*"?([^";]+)"?/i);
  return m?.[1]?.trim() ?? null;
}

/** Split a multipart body into its raw parts by boundary. */
function splitParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((p) => p.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
    .filter((p) => p && p !== "--" && !p.startsWith("--"));
}

/** Recover the ems email id + Message-ID from anywhere in the raw report. */
function recoverIds(raw: string): { emailId?: string; messageId?: string } {
  const ref = raw.match(/^X-Entity-Ref-ID\s*:\s*<?([A-Za-z0-9._-]+)>?/im);
  const mid = raw.match(/^Message-ID\s*:\s*<([^>]+)>/im);
  const midVal = mid?.[1];
  const emailId =
    ref?.[1] ??
    (midVal && /@ems\.com$/i.test(midVal)
      ? midVal.split("@")[0] ?? midVal
      : undefined);
  return { emailId, messageId: midVal ? `<${midVal}>` : undefined };
}

/** Map a DSN `Action:` + enhanced `Status:` to our event type + hardness. */
function classifyDsn(
  action: string | undefined,
  status: string | undefined,
): { type: ParsedFeedback["type"]; bounceType?: "hard" | "soft" } | null {
  const a = action?.toLowerCase();
  const cls = status?.trim().charAt(0); // 2 / 4 / 5
  if (a === "delivered" || cls === "2") return { type: "delivered" };
  if (a === "delayed" || cls === "4")
    return { type: "delivery_delayed", bounceType: "soft" };
  if (a === "failed" || cls === "5")
    return { type: "bounced", bounceType: cls === "4" ? "soft" : "hard" };
  return null; // relayed / expanded — nothing actionable
}

/** Parse the per-recipient field groups inside a message/delivery-status part. */
function parseDeliveryStatus(part: string): ParsedFeedback[] {
  const [, body] = splitHeaders(part);
  // Per-recipient DSN fields are grouped, groups separated by a blank line. The
  // first group is the per-message (Reporting-MTA) block — skip groups with no
  // Action.
  const groups = body.split(/\r?\n\r?\n/);
  const out: ParsedFeedback[] = [];
  for (const g of groups) {
    const action = header(g, "Action");
    if (!action) continue;
    const status = header(g, "Status");
    const c = classifyDsn(action, status);
    if (!c) continue;
    const finalR = header(g, "Final-Recipient") ?? header(g, "Original-Recipient");
    const recipient = finalR?.split(";").pop()?.trim();
    out.push({
      ...c,
      code: status?.trim(),
      recipient,
      reason: header(g, "Diagnostic-Code")?.split(";").pop()?.trim(),
    });
  }
  return out;
}

/** Parse a message/feedback-report (ARF) part into a single complaint event. */
function parseFeedbackReport(part: string): ParsedFeedback | null {
  const [, body] = splitHeaders(part);
  const fbType = header(body, "Feedback-Type")?.toLowerCase();
  // We only auto-suppress on genuine complaints; treat abuse/fraud as complaint,
  // ignore "not-spam"/"opt-out" which are handled elsewhere.
  if (fbType && fbType !== "abuse" && fbType !== "fraud" && fbType !== "virus") {
    return null;
  }
  const recipient =
    header(body, "Original-Rcpt-To") ?? header(body, "Removal-Recipient");
  return {
    type: "complained",
    recipient: recipient?.split(";").pop()?.trim(),
    reason: "feedback-loop complaint",
  };
}

/**
 * Parse a raw delivery-feedback message into zero or more normalized events.
 * `fallbackEmailId` (from the VERP envelope recipient) is applied to every event
 * that didn't carry its own id in the embedded original.
 */
export function parseDeliveryReport(
  raw: string,
  fallbackEmailId?: string,
): ParsedFeedback[] {
  const [head, body] = splitHeaders(raw);
  const ct = header(head, "Content-Type");
  const ids = recoverIds(raw);
  const stamp = (events: ParsedFeedback[]): ParsedFeedback[] =>
    events.map((e) => ({
      ...e,
      emailId: e.emailId ?? ids.emailId ?? fallbackEmailId,
      messageId: e.messageId ?? ids.messageId,
    }));

  const boundary = boundaryOf(ct);
  if (/multipart\/report/i.test(ct ?? "") && boundary) {
    const parts = splitParts(body, boundary);
    const reportType = ct?.match(/report-type\s*=\s*"?([^";]+)"?/i)?.[1]
      ?.toLowerCase();

    if (reportType === "feedback-report" || parts.some((p) => /message\/feedback-report/i.test(p))) {
      const fb = parts.find((p) => /Content-Type:\s*message\/feedback-report/i.test(p));
      const ev = fb ? parseFeedbackReport(fb) : null;
      return ev ? stamp([ev]) : [];
    }

    // default: delivery-status (DSN)
    const ds = parts.find((p) => /Content-Type:\s*message\/delivery-status/i.test(p));
    if (ds) return stamp(parseDeliveryStatus(ds));
  }

  // Not a structured report we recognize. If we at least have an id and the body
  // smells like a hard failure, record a bounce; otherwise nothing.
  const id = ids.emailId ?? fallbackEmailId;
  if (id && /\b5\.\d\.\d\b|550|554|mailbox.*(unavailable|not exist)/i.test(raw)) {
    return [{ type: "bounced", bounceType: "hard", emailId: id, messageId: ids.messageId }];
  }
  return [];
}
