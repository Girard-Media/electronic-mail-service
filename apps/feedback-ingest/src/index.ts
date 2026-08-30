// ems feedback-ingest — the inbound half of the delivery loop.
//
// Our MTA (Postfix) routes every bounce DSN and ISP feedback-loop (ARF) report
// to this service over LMTP on the trusted container network. We parse the
// report, recover the originating email id (VERP envelope first, then the
// embedded X-Entity-Ref-ID / Message-ID), and enqueue a normalized event onto
// the same `feedback` queue the workers already drain — which advances the email
// status, fires the webhook, and auto-suppresses hard bounces + complaints.
//
// This path is entirely internal: it enqueues straight to the queue, so it needs
// NO HTTP hop and NO shared secret. The public POST /mta/feedback endpoint stays
// available for external/out-of-band sources.
import { SMTPServer, type SMTPServerDataStream, type SMTPServerSession } from "smtp-server";
import { feedbackQueue, type FeedbackJobData } from "@ems/core";
import { parseDeliveryReport, parseBounceRecipient } from "@ems/providers";

const PORT = Number(process.env.INGEST_LMTP_PORT ?? 2400);
const HOST = process.env.INGEST_LMTP_HOST ?? "0.0.0.0";
// Max report size we'll buffer — DSNs quote the original, but we cap to stay safe.
const SIZE_LIMIT = Number(process.env.INGEST_SIZE_LIMIT ?? 5_000_000);

async function enqueue(events: FeedbackJobData[]): Promise<void> {
  for (const data of events) {
    await feedbackQueue.add("feedback", data, {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
    });
  }
}

function collect(stream: SMTPServerDataStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= SIZE_LIMIT) chunks.push(c);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

const server = new SMTPServer({
  // LMTP is the local-delivery protocol Postfix speaks to a content filter /
  // mailbox store — a perfect fit for "hand me this bounce".
  lmtp: true,
  banner: "ems feedback-ingest",
  authOptional: true,
  disabledCommands: ["AUTH", "STARTTLS"],
  size: SIZE_LIMIT,
  // Trusted container network only — never expose this port publicly.
  onData(
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
    callback: (err?: Error | null) => void,
  ) {
    void (async () => {
      try {
        const raw = await collect(stream);
        // VERP: the envelope recipient encodes the original email id.
        const rcpt = session.envelope.rcptTo[0]?.address;
        const fallbackId = rcpt ? parseBounceRecipient(rcpt) ?? undefined : undefined;
        const events = parseDeliveryReport(raw, fallbackId)
          // keep only events we can correlate to an email
          .filter((e) => e.emailId || e.messageId) as FeedbackJobData[];
        if (events.length) {
          await enqueue(events);
          console.log(
            `[ingest] ${events.length} event(s) from ${rcpt ?? "?"}: ${events
              .map((e) => e.type)
              .join(",")}`,
          );
        } else {
          console.log(`[ingest] no correlatable event from ${rcpt ?? "?"} — dropped`);
        }
        callback(); // ACK: durably enqueued (or nothing to do) — don't make the MTA retry.
      } catch (err) {
        // Defer: a transient failure (e.g. queue store down) should make Postfix
        // retry later rather than silently losing the bounce.
        console.error("[ingest] failed:", err instanceof Error ? err.message : err);
        callback(new Error("451 4.3.0 temporary failure, retry later"));
      }
    })();
  },
});

server.on("error", (err) => console.error("[ingest] server error:", err.message));
server.listen(PORT, HOST, () =>
  console.log(`ems feedback-ingest listening (LMTP) on ${HOST}:${PORT}`),
);
