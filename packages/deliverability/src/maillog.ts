/**
 * Postfix maillog parser (E08-004..E08-021). Invariants I4 and I6.
 *
 * This is where `delivered` comes from. Every number on the deliverability
 * cockpit traces back to a line parsed here, which is why two rules are absolute:
 *
 *   1. The receiving MX's response text is preserved VERBATIM. We never summarise
 *      at parse time — the raw string is the evidence, and the taxonomy reads it
 *      later. Summarising here would destroy the thing that makes us different.
 *   2. A line we cannot parse is never discarded. It goes to a queue and raises
 *      the unparsed count, because a silently dropped line is a silently wrong
 *      dashboard.
 *
 * Table-driven so a new Postfix version is a data change, not a rewrite (E08-017).
 */

export type MaillogKind = "cleanup" | "qmgr" | "smtp" | "bounce" | "error" | "reject" | "unknown";

export interface MaillogLine {
  kind: MaillogKind;
  /** Postfix queue id — the local join key, before Message-ID is known. */
  queueId: string | null;
  /** Our Message-ID, present on the cleanup line. The global join key (I4). */
  messageId: string | null;
  pid: number | null;
  host: string | null;
  raw: string;
}

export interface SmtpDelivery extends MaillogLine {
  kind: "smtp";
  to: string | null;
  relay: string | null;
  relayHost: string | null;
  delayMs: number | null;
  dsn: string | null;
  /** sent | deferred | bounced | expired */
  status: string | null;
  /** The receiving MX's exact text, parentheses stripped. Never normalised. */
  response: string | null;
  smtpCode: number | null;
}

export interface ParseResult {
  line: MaillogLine | SmtpDelivery | null;
  /** Set when the line matched no rule. The caller queues it (E08-020). */
  unparsed: boolean;
}

/** `Aug 30 04:38:57 mta01 postfix/smtp[8841]: <rest>` */
const ENVELOPE =
  /^(?:<\d+>)?(?:\w{3}\s+\d+\s[\d:]+|\S+T\S+)\s+(\S+)\s+postfix(?:-\w+)?\/(\w+)\[(\d+)\]:\s+(.*)$/;

/**
 * Postfix queue ids are short hex by default and base-52 with long queue ids
 * enabled, so the pattern must stay permissive: too narrow and we silently drop
 * lines, which is the failure this whole module exists to prevent.
 *
 * The keyword list is what stops `warning:` and friends being read as queue ids.
 */
const NON_QUEUE_PREFIXES = new Set([
  "warning", "fatal", "panic", "error", "statistics", "NOQUEUE", "connect",
  "disconnect", "lost", "timeout", "table", "daemon", "reload", "starting",
]);
const QUEUE_ID = /^([0-9A-Za-z]{3,20}):\s*(.*)$/;

function kindFor(component: string): MaillogKind {
  switch (component) {
    case "cleanup": return "cleanup";
    case "qmgr": return "qmgr";
    case "smtp":
    case "lmtp": return "smtp";
    case "bounce": return "bounce";
    case "error": return "error";
    case "smtpd": return "reject";
    default: return "unknown";
  }
}

/**
 * Pull `key=value` pairs from a Postfix smtp line. Values may be bare, bracketed
 * (`to=<a@b>`), or parenthesised and containing spaces (`status=sent (250 ok)`).
 */
function fields(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=(<[^>]*>|\([^)]*\)|[^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const key = m[1];
    let value = m[2] ?? "";
    if (!key) continue;
    if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
    out[key] = value;
  }
  // `status=` carries the response in parentheses AFTER the status word, so the
  // generic matcher above stops too early. Recover the whole thing.
  const statusMatch = /status=(\w+)\s*(\(.*\))?\s*$/.exec(rest);
  if (statusMatch) {
    out.status = statusMatch[1] ?? "";
    if (statusMatch[2]) out.response = statusMatch[2].slice(1, -1);
  }
  return out;
}

/** `relay=aspmx.l.google.com[142.251.16.27]:25` → host + full string */
function splitRelay(relay: string | undefined): { relay: string | null; host: string | null } {
  if (!relay) return { relay: null, host: null };
  const host = relay.split("[")[0]?.split(":")[0] ?? null;
  return { relay, host: host && host !== "none" ? host : null };
}

/** The leading numeric code of the receiving MX's reply, when it has one. */
function leadingCode(response: string | null): number | null {
  if (!response) return null;
  const m = /^(\d{3})\b/.exec(response.trim());
  return m?.[1] ? Number(m[1]) : null;
}

function delayToMs(delay: string | undefined): number | null {
  if (!delay) return null;
  const n = Number(delay);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

export function parseLine(raw: string): ParseResult {
  const env = ENVELOPE.exec(raw);
  if (!env) return { line: null, unparsed: true };

  const [, host, component, pidStr, rest] = env;
  const kind = kindFor(component ?? "");
  const pid = pidStr ? Number(pidStr) : null;

  const q = QUEUE_ID.exec(rest ?? "");
  const candidateId = q?.[1] ?? null;
  const isQueueId = candidateId !== null && !NON_QUEUE_PREFIXES.has(candidateId);
  const queueId = isQueueId ? candidateId : null;
  const body = isQueueId ? (q?.[2] ?? "") : (rest ?? "");

  const base: MaillogLine = {
    kind,
    queueId,
    messageId: null,
    pid,
    host: host ?? null,
    raw,
  };

  if (kind === "cleanup") {
    // `message-id=<...>` is how a queue id becomes a Message-ID (I4).
    const m = /message-id=<?([^>\s,]+)>?/.exec(body);
    return { line: { ...base, messageId: m?.[1] ?? null }, unparsed: false };
  }

  if (kind === "smtp") {
    const f = fields(body);
    const { relay, host: relayHost } = splitRelay(f.relay);
    const response = f.response ?? null;
    const delivery: SmtpDelivery = {
      ...base,
      kind: "smtp",
      to: f.to ?? null,
      relay,
      relayHost,
      delayMs: delayToMs(f.delay),
      dsn: f.dsn ?? null,
      status: f.status ?? null,
      response,
      smtpCode: leadingCode(response),
    };
    // A line with no status is not a delivery event; treat it as unparsed rather
    // than emitting an event with a null outcome.
    if (delivery.status === null) return { line: delivery, unparsed: true };
    return { line: delivery, unparsed: false };
  }

  if (kind === "qmgr" || kind === "bounce" || kind === "error" || kind === "reject") {
    return { line: base, unparsed: false };
  }

  return { line: base, unparsed: true };
}

/**
 * Correlation store: queue id → Message-ID. Postfix emits the Message-ID on the
 * cleanup line and the outcome on a later smtp line, so the two must be joined.
 *
 * Bounded and TTL'd on the same horizon as the Postfix queue lifetime — an entry
 * that outlives the queue can never be joined and is only a leak (E08-013).
 */
export class Correlator {
  private map = new Map<string, { messageId: string; at: number }>();

  constructor(private ttlMs: number = 2 * 60 * 60 * 1000, private maxEntries = 200_000) {}

  remember(queueId: string, messageId: string, now = Date.now()): void {
    this.map.set(queueId, { messageId, at: now });
    if (this.map.size > this.maxEntries) this.evict(now);
  }

  resolve(queueId: string, now = Date.now()): string | null {
    const hit = this.map.get(queueId);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) {
      this.map.delete(queueId);
      return null;
    }
    return hit.messageId;
  }

  evict(now = Date.now()): number {
    let removed = 0;
    for (const [k, v] of this.map) {
      if (now - v.at > this.ttlMs) {
        this.map.delete(k);
        removed++;
      }
    }
    // Still over the cap after TTL eviction: drop oldest first rather than
    // growing without bound.
    if (this.map.size > this.maxEntries) {
      const sorted = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [k] of sorted.slice(0, this.map.size - this.maxEntries)) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.map.size;
  }
}

export interface IngestStats {
  parsed: number;
  unparsed: number;
  correlated: number;
  /** Deliveries whose queue id we never saw a cleanup line for (E08-014). */
  uncorrelated: number;
}

export interface DeliveryEvent {
  messageId: string | null;
  queueId: string | null;
  to: string | null;
  relayHost: string | null;
  status: string;
  smtpCode: number | null;
  dsn: string | null;
  response: string | null;
  delayMs: number | null;
  raw: string;
}

/**
 * Parse a batch in order, correlating as it goes. Out-of-order arrival is
 * handled by the correlator surviving across batches (E08-011).
 */
export function ingestBatch(
  lines: string[],
  correlator: Correlator,
  now = Date.now(),
): { events: DeliveryEvent[]; unparsed: string[]; stats: IngestStats } {
  const events: DeliveryEvent[] = [];
  const unparsed: string[] = [];
  const stats: IngestStats = { parsed: 0, unparsed: 0, correlated: 0, uncorrelated: 0 };

  for (const raw of lines) {
    const { line, unparsed: bad } = parseLine(raw);
    if (bad || line === null) {
      unparsed.push(raw);
      stats.unparsed++;
      continue;
    }
    stats.parsed++;

    if (line.kind === "cleanup" && line.queueId && line.messageId) {
      correlator.remember(line.queueId, line.messageId, now);
      continue;
    }

    if (line.kind === "smtp") {
      const d = line as SmtpDelivery;
      const messageId = d.queueId ? correlator.resolve(d.queueId, now) : null;
      if (messageId) stats.correlated++;
      else stats.uncorrelated++;
      events.push({
        messageId,
        queueId: d.queueId,
        to: d.to,
        relayHost: d.relayHost,
        status: d.status ?? "unknown",
        smtpCode: d.smtpCode,
        dsn: d.dsn,
        response: d.response,
        delayMs: d.delayMs,
        raw: d.raw,
      });
    }
  }

  return { events, unparsed, stats };
}

/** Map a receiving MX hostname to an ESP family for the taxonomy (E07-028). */
const MX_ESP: Array<[RegExp, string]> = [
  [/(^|\.)google\.com$|(^|\.)googlemail\.com$|aspmx|gmail-smtp/i, "google"],
  [/protection\.outlook\.com$|(^|\.)hotmail\.com$|olc\.protection/i, "microsoft"],
  [/yahoodns\.net$|(^|\.)yahoo\.com$|(^|\.)aol\.com$/i, "yahoo"],
  [/pphosted\.com$|ppe-hosted\.com$/i, "proofpoint"],
  [/mimecast\.com$/i, "mimecast"],
  [/barracudanetworks\.com$|barracuda\.com$/i, "barracuda"],
];

export function espFromRelay(relayHost: string | null): string {
  if (!relayHost) return "generic";
  for (const [re, esp] of MX_ESP) if (re.test(relayHost)) return esp;
  return "generic";
}
