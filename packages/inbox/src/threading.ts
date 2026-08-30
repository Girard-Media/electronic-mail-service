/**
 * Threading and body cleanup (E16-001..E16-018).
 *
 * Two things this module refuses to do:
 *
 *  1. Merge two threads on a weak match. Getting this wrong shows a customer
 *     someone else's conversation, so a subject-and-participants match is a
 *     *candidate*, not a join, and it must clear an explicit floor.
 *  2. Discard the original body. Quoted history is collapsed FOR DISPLAY while
 *     the full text is retained, because the quoted part is often where the
 *     actual answer is, and because we may need to re-parse it later.
 */

export interface InboundEnvelope {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  receivedAt: Date;
}

export type ThreadMatch =
  | { kind: "header"; threadId: string; confidence: 1 }
  | { kind: "references"; threadId: string; confidence: 0.95 }
  | { kind: "heuristic"; threadId: string; confidence: number }
  | { kind: "new"; confidence: 1 };

/** Below this a heuristic match is NOT a join — it opens a new thread (E16-009). */
export const WEAK_MATCH_FLOOR = 0.9;

export interface ThreadIndex {
  /** threadId for a known Message-ID, if we sent or stored it. */
  byMessageId(messageId: string): string | null;
  /** Open threads whose normalised subject matches, most recent first. */
  bySubject(normalizedSubject: string): Array<{
    threadId: string;
    participants: string[];
    lastMessageAt: Date;
  }>;
}

/** "Re: Fwd: RE: quick question" → "quick question" */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fw|fwd|aw|sv|vs|antw|res)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function addr(a: string): string {
  const m = /<([^>]+)>/.exec(a);
  return (m?.[1] ?? a).trim().toLowerCase();
}

/**
 * Resolve which thread an inbound message belongs to.
 *
 * Precedence is header-first because In-Reply-To and References are the only
 * signals a mail client actually guarantees. The heuristic exists because some
 * clients — and most auto-responders — drop them entirely.
 */
export function resolveThread(
  env: InboundEnvelope,
  index: ThreadIndex,
  opts: { now?: Date; maxHeuristicAgeDays?: number } = {},
): ThreadMatch {
  if (env.inReplyTo) {
    const t = index.byMessageId(env.inReplyTo);
    if (t) return { kind: "header", threadId: t, confidence: 1 };
  }

  // References is ordered oldest → newest; the nearest ancestor is the best join.
  for (const ref of [...env.references].reverse()) {
    const t = index.byMessageId(ref);
    if (t) return { kind: "references", threadId: t, confidence: 0.95 };
  }

  const normalized = normalizeSubject(env.subject);
  if (normalized.length < 4) return { kind: "new", confidence: 1 };

  const now = opts.now ?? env.receivedAt;
  const maxAgeMs = (opts.maxHeuristicAgeDays ?? 30) * 86_400_000;
  const sender = addr(env.from);

  for (const cand of index.bySubject(normalized)) {
    if (now.getTime() - cand.lastMessageAt.getTime() > maxAgeMs) continue;
    const participants = cand.participants.map(addr);
    if (!participants.includes(sender)) continue;

    // Subject + a known participant + recency. Deliberately conservative: any
    // one of these alone is not enough to show someone another conversation.
    let confidence = 0.9;
    if (now.getTime() - cand.lastMessageAt.getTime() < 7 * 86_400_000) confidence = 0.93;
    if (env.subject.trim().toLowerCase() !== normalized) confidence += 0.02; // carries a Re:

    if (confidence >= WEAK_MATCH_FLOOR) {
      return { kind: "heuristic", threadId: cand.threadId, confidence: Math.min(0.99, confidence) };
    }
  }

  return { kind: "new", confidence: 1 };
}

// ── Body cleanup ─────────────────────────────────────────────────────────────

/**
 * Where the quoted history begins, across the clients we actually see.
 * Ordered by how unambiguous each marker is.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,                                   // Outlook's divider
  /^\s*On .{4,120}\bwrote:\s*$/im,                    // Gmail / Apple Mail
  /^\s*On .{4,120},\s*.{2,80}\s*<[^>]+>\s*wrote:\s*$/im,
  /^\s*Le .{4,120}\ba écrit\s*:\s*$/im,               // French
  /^\s*Am .{4,120}\bschrieb\s.{2,80}:\s*$/im,         // German
  /^\s*El .{4,120}\bescribió:\s*$/im,                 // Spanish
  /^\s*From:\s.{2,200}\r?\nSent:\s/im,                // Outlook header block
  /^\s*From:\s.{2,200}\r?\nDate:\s/im,
  /^\s*>{1,}\s?From:\s/im,
  /^\s*Sent from my (iPhone|iPad|Android|Samsung)/im, // signature-ish, still a boundary
];

export interface SplitBody {
  /** What the reader actually wrote, for display. */
  reply: string;
  /** Everything from the quote marker down. Retained, never discarded. */
  quoted: string;
  /** Detected signature block, split off the reply. */
  signature: string;
  /** Which marker matched, for debugging a bad split. */
  markerIndex: number | null;
}

export function splitQuoted(body: string): SplitBody {
  const text = body.replace(/\r\n/g, "\n");

  let cutAt = -1;
  let markerIndex: number | null = null;
  for (let i = 0; i < QUOTE_MARKERS.length; i++) {
    const m = QUOTE_MARKERS[i]!.exec(text);
    if (m && m.index !== undefined && (cutAt === -1 || m.index < cutAt)) {
      cutAt = m.index;
      markerIndex = i;
    }
  }

  // A run of leading '>' lines is a quote even with no marker above it.
  if (cutAt === -1) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*>/.test(lines[i] ?? "")) {
        const remaining = lines.slice(i);
        const quotedRatio = remaining.filter((l) => /^\s*>/.test(l) || l.trim() === "").length / remaining.length;
        if (quotedRatio > 0.7) {
          cutAt = lines.slice(0, i).join("\n").length;
          markerIndex = -1;
          break;
        }
      }
    }
  }

  const head = cutAt === -1 ? text : text.slice(0, cutAt);
  const quoted = cutAt === -1 ? "" : text.slice(cutAt);
  const { body: reply, signature } = splitSignature(head);
  return { reply: reply.trim(), quoted: quoted.trim(), signature: signature.trim(), markerIndex };
}

const SIG_DELIMITER = /^\s*--\s*$/m;
/** Lines that mark the start of a signature when they sit near the end. */
const SIG_HINT = /^\s*(best|regards|best regards|kind regards|thanks|thank you|cheers|sincerely|warmly|all the best)[,.!]?\s*$/i;

export function splitSignature(text: string): { body: string; signature: string } {
  const delim = SIG_DELIMITER.exec(text);
  if (delim && delim.index !== undefined) {
    return { body: text.slice(0, delim.index), signature: text.slice(delim.index) };
  }

  const lines = text.split("\n");
  // Look only at the tail: a "Thanks," in the middle of a paragraph is not a
  // signature, and cutting there would delete the message.
  const searchFrom = Math.max(0, lines.length - 8);
  for (let i = lines.length - 1; i >= searchFrom; i--) {
    if (SIG_HINT.test(lines[i] ?? "")) {
      const after = lines.slice(i + 1).filter((l) => l.trim() !== "");
      // A sign-off followed by a short block is a signature; followed by
      // paragraphs, it is just how the person writes.
      if (after.length <= 6 && after.every((l) => l.length < 80)) {
        return { body: lines.slice(0, i).join("\n"), signature: lines.slice(i).join("\n") };
      }
    }
  }
  return { body: text, signature: "" };
}

// ── Inbound safety ───────────────────────────────────────────────────────────

/** Extensions we quarantine rather than ever offering to a user (E16-014). */
export const QUARANTINE_EXTENSIONS = new Set([
  "exe", "scr", "com", "pif", "bat", "cmd", "msi", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "ps1", "psm1", "jar", "app", "dmg", "pkg", "deb", "rpm",
  "lnk", "reg", "hta", "cpl", "dll", "sys", "iso", "img",
]);

/** Archives can hide the above, so they are quarantined too. */
export const QUARANTINE_ARCHIVES = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "cab", "ace"]);

export type AttachmentVerdict = "allow" | "quarantine";

export function classifyAttachment(filename: string): { verdict: AttachmentVerdict; reason: string } {
  const clean = filename.trim().toLowerCase();
  // Double extensions are the oldest trick there is: invoice.pdf.exe
  const parts = clean.split(".").filter(Boolean);
  const ext = parts[parts.length - 1] ?? "";

  if (QUARANTINE_EXTENSIONS.has(ext)) return { verdict: "quarantine", reason: `executable type .${ext}` };
  if (QUARANTINE_ARCHIVES.has(ext)) return { verdict: "quarantine", reason: `archive type .${ext} may contain executables` };
  if (parts.length > 2) {
    const inner = parts[parts.length - 2] ?? "";
    if (["pdf", "doc", "docx", "xls", "jpg", "png"].includes(inner)) {
      return { verdict: "quarantine", reason: "double extension — disguised file type" };
    }
  }
  if (/[‮‏‎]/.test(filename)) {
    // Right-to-left override reverses how the name renders: "…gpj.exe" shows as
    // "…exe.jpg". Any bidi control in a filename is hostile.
    return { verdict: "quarantine", reason: "bidirectional override in filename" };
  }
  return { verdict: "allow", reason: "" };
}

/** Strip anything that can execute or phone home before rendering (E16-012). */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|applet|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|applet|link|meta|base|form)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*("|')?\s*(javascript|vbscript|data)\s*:[^"'>\s]*/gi, "$1=\"#\"")
    .replace(/<\s*svg\b[\s\S]*?<\s*\/\s*svg\s*>/gi, "");
}

/**
 * Remote images are blocked by default: loading one tells the sender we opened
 * the message and leaks our IP, which is the same tracking we refuse to do
 * outbound (E16-013). Returns the rewritten HTML plus what was blocked, so the
 * UI can offer a per-message reveal.
 */
export function blockRemoteImages(html: string): { html: string; blocked: number } {
  let blocked = 0;
  const out = html.replace(/<img\b([^>]*?)src\s*=\s*("|')(https?:[^"']*)\2([^>]*)>/gi, (_m, pre, _q, url, post) => {
    blocked++;
    return `<img${pre}data-blocked-src="${url}"${post} data-ems-blocked="1">`;
  });
  return { html: out, blocked };
}
