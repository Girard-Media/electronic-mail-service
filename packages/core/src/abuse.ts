import { SYSTEM_SENDING_DOMAINS } from "./schema.js";

// Abuse screening that must stay in one place: the public send path and the
// tests share these rules. DB lookups stay in enqueueEmail.

/** Bare, lowercased address from "Name <a@b.com>" or "a@b.com". */
export function recipientAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m?.[1] ?? raw).trim().toLowerCase();
}

/**
 * Customer traffic on a ems system domain is only allowed after the org
 * owner has verified their email. Platform mail (verify / reset / invite)
 * passes `internal: true` and skips the gate.
 */
export function systemDomainSendDecision(opts: {
  fromDomain: string;
  internal: boolean;
  ownerVerified: boolean;
}): "allow" | "need_verification" | "need_mailbox" {
  if (!SYSTEM_SENDING_DOMAINS.has(opts.fromDomain)) return "allow";
  if (opts.internal) return "allow";
  if (!opts.ownerVerified) return "need_verification";
  // Verified is not enough: any tenant could otherwise From: security@electronicmailservices.com
  // and the MTA would DKIM-align it. Same rule as shared-inbox domains — own the mailbox.
  return "need_mailbox";
}

/**
 * Shared inbox domains (`agents.` / `inbox.`) pool reputation across tenants.
 * Customer send/create is allowed only when the org owner has verified email
 * and the platform kill switch is on. Platform mail passes `internal: true`.
 */
export function sharedInboxSendDecision(opts: {
  internal: boolean;
  ownerVerified: boolean;
  sendingEnabled: boolean;
}): "allow" | "need_verification" | "killed" {
  if (opts.internal) return "allow";
  if (!opts.sendingEnabled) return "killed";
  if (!opts.ownerVerified) return "need_verification";
  return "allow";
}

export type StoredAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

/**
 * Attachments as the worker/providers may send them. Drops `path` (nodemailer
 * would fetch it — SSRF) and anything without base64 `content`.
 */
export function storedAttachments(raw: unknown): StoredAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StoredAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const filename = typeof a.filename === "string" ? a.filename : "";
    const content = typeof a.content === "string" ? a.content : "";
    if (!filename || !content) continue;
    const contentType =
      typeof a.content_type === "string"
        ? a.content_type
        : typeof a.contentType === "string"
          ? a.contentType
          : undefined;
    out.push(contentType ? { filename, content, contentType } : { filename, content });
  }
  return out.length ? out : undefined;
}
