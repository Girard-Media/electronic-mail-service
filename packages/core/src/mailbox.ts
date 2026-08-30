/**
 * Native-mailbox inbound rules (pure). The MTA handler and tests share these
 * so catch-all / keep-copy / quota cannot drift.
 */

/** Envelope recipient → bare lowercased address, +tag stripped. */
export function stripSubAddress(rcpt: string): string {
  const bare = (rcpt.match(/<([^>]+)>/)?.[1] ?? rcpt).trim().toLowerCase();
  return bare.replace(/\+[^@]*@/, "@");
}

export type MailboxCandidate = {
  address: string;
  catchAll: boolean;
  status: string;
  domainName: string;
};

/** Exact address first, then the domain's catch-all. Inactive mailboxes never match. */
export function resolveInboundMailbox<T extends MailboxCandidate>(
  rcpt: string,
  mailboxes: T[],
): T | undefined {
  const address = stripSubAddress(rcpt);
  if (!address.includes("@")) return undefined;
  const exact = mailboxes.find((m) => m.status === "active" && m.address === address);
  if (exact) return exact;
  const domain = address.split("@")[1];
  if (!domain) return undefined;
  return mailboxes.find(
    (m) => m.status === "active" && m.catchAll && m.domainName === domain,
  );
}

export function inboundDisposition(opts: {
  keepCopy: boolean;
  verifiedForwardCount: number;
  usedBytes: number;
  quotaBytes: number;
  sizeBytes: number;
}): { overQuota: boolean; store: boolean; forward: boolean } {
  const overQuota = opts.usedBytes + opts.sizeBytes > opts.quotaBytes;
  if (overQuota) return { overQuota: true, store: false, forward: false };
  const forward = opts.verifiedForwardCount > 0;
  const store = opts.keepCopy || !forward;
  return { overQuota: false, store, forward };
}

// ---------- Shared-domain inboxes (public /inboxes API) ----------
//
// A "shared inbox domain" is a platform-owned domain any tenant can claim an
// address on with no DNS of their own. Plural by design — the same machinery
// backs agent inboxes and the "just give me a working address" human/company
// mode (planning/INBOX_MODES.md). Address uniqueness is global, so two tenants
// can never hold the same address.

/** Parse the configured list: lowercased, trimmed, de-duped, blanks dropped. */
export function parseSharedInboxDomains(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const d = part.trim().toLowerCase().replace(/\.$/, "");
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Is this domain one the platform hands out addresses on? */
export function isSharedInboxDomain(domain: string, configured: string[]): boolean {
  return configured.includes(domain.trim().toLowerCase());
}

/**
 * Local-parts we never hand out on a shared inbox domain: RFC-2142
 * role addresses, platform identities, and anything that could pass as an
 * official ems sender in a recipient's inbox.
 */
export const RESERVED_INBOX_USERNAMES = new Set([
  "abuse", "admin", "administrator", "billing", "bounce", "contact", "dmarc",
  "dns", "help", "hello", "hi", "hostmaster", "info", "legal", "mail",
  "mailer-daemon", "marketing", "no-reply", "noreply", "official", "postmaster",
  "root", "sales", "security", "spam", "support", "team", "ems",
  "webmaster", "www",
]);

export type InboxUsernameResult =
  | { ok: true; username: string }
  | { ok: false; message: string };

/**
 * Validate + normalize a local-part for a shared-domain inbox. Strict on
 * purpose: these live on OUR domain, so a hostile username is a phishing
 * surface. Dots allowed mid-name; `+` never (it's the sub-address separator).
 */
export function validateInboxUsername(raw: string): InboxUsernameResult {
  const username = raw.trim().toLowerCase();
  if (username.length < 3 || username.length > 64) {
    return { ok: false, message: "Username must be 3–64 characters." };
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(username) || username.includes("..")) {
    return {
      ok: false,
      message:
        "Username may contain lowercase letters, digits, and . _ - (must start and end with a letter or digit; no consecutive dots).",
    };
  }
  if (RESERVED_INBOX_USERNAMES.has(username)) {
    return { ok: false, message: `"${username}" is reserved.` };
  }
  return { ok: true, username };
}

/** Verified destinations, never the mailbox itself. */
export function forwardDestinations(
  mailboxAddress: string,
  dests: { destination: string; verifiedAt: Date | string | null }[],
): string[] {
  const self = mailboxAddress.toLowerCase();
  const out: string[] = [];
  for (const d of dests) {
    if (!d.verifiedAt) continue;
    const dest = d.destination.toLowerCase();
    if (dest === self) continue;
    if (!out.includes(dest)) out.push(dest);
  }
  return out;
}
