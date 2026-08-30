/**
 * CAN-SPAM message validation (E14-062..E14-069).
 *
 * These are mandatory elements, not suggestions. A message missing any of them
 * does not send, and the error names the specific defect so the customer can fix
 * it rather than seeing a generic failure.
 */

export type MessageDefect =
  | "missing-postal-address"
  | "missing-unsubscribe"
  | "missing-list-unsubscribe-header"
  | "missing-one-click-post"
  | "unsubscribe-in-tracking-redirect"
  | "deceptive-subject-re-on-first-touch"
  | "empty-subject"
  | "from-display-name-mismatch"
  | "unverified-from-domain"
  | "header-injection";

export interface MessageToValidate {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  fromAddress: string;
  fromDisplayName: string;
  personaName: string;
  postalAddress: string | null;
  unsubscribeUrl: string | null;
  headers: Record<string, string>;
  isFirstTouch: boolean;
  fromDomainVerified: boolean;
}

export interface MessageValidation {
  ok: boolean;
  defects: MessageDefect[];
}

const DECEPTIVE_PREFIX = /^\s*(re|fw|fwd)\s*:/i;
/** Any CR or LF in a header-bound field is an injection attempt (E14-068). */
const CRLF = /[\r\n]/;

export function validateMessage(m: MessageToValidate): MessageValidation {
  const defects: MessageDefect[] = [];

  if (m.subject.trim() === "") defects.push("empty-subject");
  if (m.isFirstTouch && DECEPTIVE_PREFIX.test(m.subject)) {
    defects.push("deceptive-subject-re-on-first-touch");
  }

  // The postal address must actually appear in the body, not merely exist on the
  // persona — a stored value that never renders satisfies nothing.
  if (!m.postalAddress || m.postalAddress.trim() === "") {
    defects.push("missing-postal-address");
  } else if (!bodyContains(m, m.postalAddress)) {
    defects.push("missing-postal-address");
  }

  if (!m.unsubscribeUrl || m.unsubscribeUrl.trim() === "") {
    defects.push("missing-unsubscribe");
  } else if (!bodyContains(m, m.unsubscribeUrl)) {
    defects.push("missing-unsubscribe");
  }

  // RFC 8058 one-click. Google and Yahoo require it for bulk senders and it is a
  // placement factor, so it is validated rather than assumed.
  const listUnsub = m.headers["List-Unsubscribe"] ?? m.headers["list-unsubscribe"];
  if (!listUnsub) defects.push("missing-list-unsubscribe-header");
  const oneClick = m.headers["List-Unsubscribe-Post"] ?? m.headers["list-unsubscribe-post"];
  if (!oneClick || !oneClick.includes("List-Unsubscribe=One-Click")) {
    defects.push("missing-one-click-post");
  }

  // Never wrap the unsubscribe link in a click-tracking redirect (E14-... / E08-080):
  // if tracking breaks, the opt-out breaks, and that is the one thing that cannot fail.
  if (m.unsubscribeUrl && /\/(t|track|click|r)\//i.test(m.unsubscribeUrl)) {
    defects.push("unsubscribe-in-tracking-redirect");
  }

  if (!m.fromDomainVerified) defects.push("unverified-from-domain");

  // The display name must match the persona actually sending. Anything else is
  // an identity misrepresentation even when the address is ours.
  if (normalise(m.fromDisplayName) !== normalise(m.personaName)) {
    defects.push("from-display-name-mismatch");
  }

  const headerBound = [m.subject, m.fromAddress, m.fromDisplayName, ...Object.values(m.headers)];
  if (headerBound.some((v) => CRLF.test(v))) defects.push("header-injection");

  return { ok: defects.length === 0, defects };
}

function bodyContains(m: MessageToValidate, needle: string): boolean {
  const hay = `${m.bodyText}\n${m.bodyHtml ?? ""}`;
  return hay.includes(needle.trim());
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
