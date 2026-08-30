// VERP (Variable Envelope Return Path) — how ems recovers a bounce.
//
// When we relay through our own MTA we set the SMTP envelope sender (MAIL FROM /
// Return-Path) to a bounce address ON A DOMAIN WE CONTROL, encoding the email id
// in the local part: `bounce+<emailId>@bounce.electronicmailservices.com`. The recipient MX
// returns any DSN (bounce / delay) to that exact address, so when the DSN lands
// back at our MTA the feedback-ingest service decodes the id straight from the
// envelope recipient — no body parsing required for correlation.
//
// DMARC note: the From: header keeps the customer's domain and we DKIM-sign with
// that domain's key, so DMARC passes on DKIM alignment regardless of this
// envelope domain. Publishing SPF for the bounce domain keeps the return-path
// itself authenticated.

const DELIM = "+";

/** Build the VERP return-path (envelope sender) for an outbound email. */
export function bounceReturnPath(emailId: string, domain: string): string {
  return `bounce${DELIM}${emailId}@${domain}`;
}

/**
 * Decode the email id from a VERP bounce recipient. Accepts the full address or
 * just the local part, tolerates angle brackets / display names, and is
 * case-insensitive on the domain. Returns null for a plain `bounce@…`
 * (double-bounce / un-tagged) or anything that isn't ours.
 */
export function parseBounceRecipient(addr: string): string | null {
  if (!addr) return null;
  // Pull the bare address out of `Name <a@b>` or `<a@b>`.
  const m = addr.match(/<([^>]+)>/);
  const bare = (m?.[1] ?? addr).trim().toLowerCase();
  const local = bare.includes("@") ? bare.slice(0, bare.indexOf("@")) : bare;
  if (!local.startsWith(`bounce${DELIM}`)) return null;
  const id = local.slice(`bounce${DELIM}`.length);
  return id.length ? id : null;
}
