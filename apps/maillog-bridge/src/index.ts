/**
 * ems maillog-bridge — turns Postfix's own delivery log into `delivered`
 * events, closing the half of the feedback loop that DSNs cannot cover.
 *
 * WHY THIS EXISTS: a success DSN only arrives if the sender asks for it
 * (NOTIFY=SUCCESS) *and* the receiver honours it — and the big mailbox providers
 * simply don't. So "delivered" can never come from the DSN path. What actually
 * proves delivery is the remote MTA's own 250 on the final hop, which Postfix
 * already records:
 *
 *   qmgr[..]:    <QID>: from=<bounce+<emailId>@bounce.electronicmailservices.com>, size=…
 *   cleanup[..]: <QID>: message-id=<<emailId>@electronicmailservices.com>
 *   smtp[..]:    <QID>: to=<rcpt>, relay=…, dsn=2.0.0, status=sent (250 …)
 *
 * VERP means the envelope sender already carries our email id, so a delivery
 * line can be tied back to a message with a queue-id lookup and no database hit.
 *
 * The bridge tails the log, keeps a bounded QID→emailId map, and POSTs each
 * outcome to /mta/feedback — the same durable, retried queue the DSN ingest
 * already feeds. It is deliberately append-only and stateless beyond that map:
 * if it restarts it resumes at end-of-file and simply misses nothing new.
 */
import { stat, open } from "node:fs/promises";

const LOG_PATH = process.env.MAILLOG_PATH ?? "/var/spool/postfix/maillog";
const API_URL = process.env.MAILLOG_API_URL ?? "http://ems:8787";
const SECRET = process.env.MTA_FEEDBACK_SECRET ?? "";
const POLL_MS = Number(process.env.MAILLOG_POLL_MS ?? 2000);
const HEARTBEAT_URL = process.env.BETTERSTACK_HEARTBEAT_MAILLOG ?? "";
// Bound the queue-id map so a long-running process can't grow without limit.
const MAX_TRACKED = Number(process.env.MAILLOG_MAX_TRACKED ?? 5000);

type Outcome = { type: "delivered" | "bounced" | "delivery_delayed"; code?: string };

/** Postfix status= → our feedback type. `deferred` is a soft, retryable delay. */
function classify(status: string): Outcome["type"] | null {
  if (status === "sent") return "delivered";
  if (status === "bounced") return "bounced";
  if (status === "deferred") return "delivery_delayed";
  return null; // expired / other — nothing actionable
}

/** qid → our email id, learned from the VERP sender or the Message-ID. */
const qidToEmail = new Map<string, string>();

function remember(qid: string, emailId: string): void {
  if (qidToEmail.size >= MAX_TRACKED) {
    // Oldest-first eviction; Map preserves insertion order.
    const oldest = qidToEmail.keys().next().value;
    if (oldest) qidToEmail.delete(oldest);
  }
  qidToEmail.set(qid, emailId);
}

const RE_FROM = /([0-9A-F]{6,}): from=<bounce\+([^@>]+)@/i;
const RE_MSGID = /([0-9A-F]{6,}): message-id=<([^@>]+)@/i;
const RE_DELIVERY =
  /([0-9A-F]{6,}): to=<([^>]+)>.*?dsn=(\d\.\d\.\d).*?status=(\w+)/i;

export type BridgeEvent = {
  type: Outcome["type"];
  emailId: string;
  recipient: string;
  code: string;
};

/** Parse one log line. Learns ids from from=/message-id=, emits on status=. */
export function handleLine(line: string): BridgeEvent | null {
  const from = RE_FROM.exec(line);
  if (from?.[1] && from[2]) {
    remember(from[1].toUpperCase(), from[2]);
    return null;
  }
  const mid = RE_MSGID.exec(line);
  if (mid?.[1] && mid[2]) {
    // Only fills a gap — a VERP sender seen later is equally authoritative.
    if (!qidToEmail.has(mid[1].toUpperCase())) remember(mid[1].toUpperCase(), mid[2]);
    return null;
  }
  const d = RE_DELIVERY.exec(line);
  if (!d) return null;
  const qid = d[1];
  const recipient = d[2];
  const code = d[3];
  const status = d[4];
  if (!qid || !recipient || !code || !status) return null;
  const type = classify(status.toLowerCase());
  if (!type) return null;
  const emailId = qidToEmail.get(qid.toUpperCase());
  // No id means the message predates this process (or wasn't ours) — skip it
  // rather than guessing; a wrong correlation is worse than a missing event.
  if (!emailId) return null;
  if (type === "delivered") qidToEmail.delete(qid.toUpperCase());
  return { type, emailId, recipient, code };
}

async function post(events: BridgeEvent[]): Promise<void> {
  if (!events.length) return;
  if (!SECRET) {
    console.warn("[maillog] MTA_FEEDBACK_SECRET unset — not forwarding");
    return;
  }
  try {
    const res = await fetch(`${API_URL}/mta/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error(`[maillog] POST failed: ${res.status}`);
    else console.log(`[maillog] forwarded ${events.length} event(s)`);
  } catch (e) {
    // Never crash the tailer on a transient API blip; the next lines still flow.
    console.error("[maillog] POST error:", e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  console.log(`[maillog] tailing ${LOG_PATH} → ${API_URL}/mta/feedback`);
  // Start at end-of-file: we forward what happens from now on, never replay a
  // week of history into the queue on boot.
  let offset = await stat(LOG_PATH).then((s) => s.size).catch(() => 0);
  let carry = "";
  let lastHeartbeat = 0;

  for (;;) {
    try {
      const s = await stat(LOG_PATH).catch(() => null);
      if (s) {
        // Log rotated/truncated → resume from the new start.
        if (s.size < offset) {
          offset = 0;
          carry = "";
        }
        if (s.size > offset) {
          const fh = await open(LOG_PATH, "r");
          const len = s.size - offset;
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, offset);
          await fh.close();
          offset = s.size;
          const text = carry + buf.toString("utf8");
          const lines = text.split("\n");
          carry = lines.pop() ?? ""; // keep a partial final line for next pass
          const events = lines
            .map((l) => handleLine(l))
            .filter((e): e is BridgeEvent => e !== null);
          await post(events);
        }
      }
    } catch (e) {
      console.error("[maillog] read error:", e instanceof Error ? e.message : e);
    }
    if (HEARTBEAT_URL && Date.now() - lastHeartbeat > 60_000) {
      lastHeartbeat = Date.now();
      fetch(HEARTBEAT_URL, { method: "GET", signal: AbortSignal.timeout(5000) }).catch(
        () => {},
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Only run the loop when executed directly, so the parser stays unit-testable.
if (process.env.MAILLOG_TEST !== "1") {
  void main();
}
