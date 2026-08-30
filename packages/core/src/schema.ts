import { z } from "zod";

// Drop-in transactional send payload (the primary wedge — DECISIONS D3).
// The on-the-wire shape uses snake_case fields so an existing transactional
// email client works against ems with only a base-URL change.

const noCtl = (s: string) => !/[\r\n\0]/.test(s);
const address = z
  .string()
  .min(1)
  .refine(noCtl, { message: "Addresses must not contain newlines." });
const recipients = z.union([address, z.array(address)]);

// Accept either a bare address ("a@b.com") or a display-name form
// ("Acme <a@b.com>") — both are valid `from` values. Display-name is
// `[^\r\n<>]*` so a CR/LF cannot smuggle extra headers into MIME.
const FROM_RE =
  /^(?:[^\r\n<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

// Domains ems sends on its own behalf (signed by the MTA's own key, no
// per-tenant verified Domain required).
export const SYSTEM_SENDING_DOMAINS = new Set(["electronicmailservices.com"]);

/** Extract the lowercased domain from a `from` value, or null if malformed. */
export function parseFromDomain(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const addr = (m?.[1] ?? from).trim();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr.slice(at + 1).toLowerCase().trim();
  return domain.length ? domain : null;
}

/** 40 MB decoded payload cap (Resend's documented limit). */
export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

/** Approximate decoded size of a base64 string. Padding-aware, no Buffer. */
export function base64DecodedBytes(s: string): number {
  const t = s.replace(/\s+/g, "");
  if (!t) return 0;
  const pad = t.endsWith("==") ? 2 : t.endsWith("=") ? 1 : 0;
  return Math.floor((t.length * 3) / 4) - pad;
}

export const attachmentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    content: z.string().optional(), // base64
    path: z.string().optional(),
    content_type: z.string().optional(),
  })
  .refine((a) => !a.path, {
    message: "Attachment 'path' is not supported; pass base64 'content'.",
  })
  .refine((a) => Boolean(a.content), {
    message: "Each attachment needs base64 'content'.",
  });

export const tagSchema = z.object({ name: z.string(), value: z.string() });

export const sendEmailSchema = z
  .object({
    from: z
      .string()
      .min(3)
      .refine((v) => noCtl(v) && FROM_RE.test(v.trim()), {
        message: "'from' must be an email address or 'Name <email@domain>'.",
      }),
    to: recipients,
    subject: z.string().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    cc: recipients.optional(),
    bcc: recipients.optional(),
    reply_to: recipients.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    attachments: z.array(attachmentSchema).max(40).optional(),
    tags: z.array(tagSchema).optional(),
    // ISO-8601 with an explicit offset ("2026-08-12T09:30:00Z"). Must be in the
    // future; format/range are enforced in enqueueEmail. Natural language is NOT
    // accepted — the API rejects it with a 422.
    scheduled_at: z.string().optional(),
    // Send a saved block template by id; `data` supplies its {{variables}}. The
    // template provides html (and subject, unless overridden here).
    template_id: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Boolean(d.html || d.text || d.template_id), {
    message: "Provide 'html', 'text', or 'template_id'.",
  })
  .refine((d) => Boolean(d.subject || d.template_id), {
    message: "'subject' is required (or send a template_id that has one).",
  })
  .refine(
    (d) => {
      const atts = d.attachments ?? [];
      let total = 0;
      for (const a of atts) {
        const n = base64DecodedBytes(a.content ?? "");
        if (n > MAX_ATTACHMENT_BYTES) return false;
        total += n;
      }
      return total <= MAX_ATTACHMENT_BYTES;
    },
    { message: "Attachments must total 40 MB or less (decoded)." },
  );

export type SendEmailPayload = z.infer<typeof sendEmailSchema>;

/** Normalize Resend's string-or-array recipient fields to a string[]. */
export function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * ISO-8601 date-time requiring an explicit `Z` or ±HH:MM offset. A bare
 * `new Date()` is lenient enough to accept "2026" or "March 5 2027", and a
 * naive timestamp would be read against the *server's* local timezone and fire
 * at the wrong hour — so the offset is mandatory.
 */
export const ISO_8601_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;

export type ScheduledAtResult =
  | { ok: true; date: Date }
  | { ok: false; message: string };

/**
 * Validate a `scheduled_at` value. Pure (no DB) so the API, tests, and any
 * future client-side check all enforce exactly one rule.
 *
 * @param now injectable clock, so "must be in the future" is testable.
 */
export function parseScheduledAt(value: string, now: number = Date.now()): ScheduledAtResult {
  if (!ISO_8601_WITH_OFFSET.test(value)) {
    return {
      ok: false,
      message:
        "scheduled_at must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-08-12T09:30:00Z or 2026-08-12T09:30:00-04:00.",
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: "scheduled_at is not a valid date." };
  }
  // A past timestamp would otherwise clamp to a 0ms queue delay and send
  // immediately — silently doing something the caller did not ask for.
  if (date.getTime() <= now) {
    return { ok: false, message: "scheduled_at must be in the future." };
  }
  return { ok: true, date };
}
