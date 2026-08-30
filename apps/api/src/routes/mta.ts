import { Hono } from "hono";
import { z } from "zod";
import {
  env,
  errors,
  feedbackQueue,
  mailboxReceivingStatus,
  secretEquals,
  type FeedbackJobData,
} from "@ems/core";
import { parseDeliveryReport, parseBounceRecipient } from "@ems/providers";
import { prisma } from "@ems/db";
import { handleMailboxInbound } from "../lib/inbound-mailbox.js";

// Inbound delivery feedback from our own MTA: bounce DSNs, ISP feedback-loop
// (FBL) complaints, and delivery confirmations. The MTA POSTs here with a shared
// secret; we validate + enqueue for durable, retryable processing. Accepts a
// single event or an array (batch).
export const mta = new Hono();

function requireMtaSecret(c: { req: { header: (n: string) => string | undefined } }): void {
  const secret = env.MTA_FEEDBACK_SECRET;
  const auth = c.req.header("authorization") ?? "";
  if (!secret || !secretEquals(auth, `Bearer ${secret}`)) {
    throw errors.unauthorized();
  }
}

const feedbackSchema = z.object({
  type: z.enum(["delivered", "bounced", "complained", "delivery_delayed"]),
  emailId: z.string().optional(),
  messageId: z.string().optional(),
  bounceType: z.enum(["hard", "soft"]).optional(),
  recipient: z.string().optional(),
  reason: z.string().optional(),
  code: z.string().optional(),
});

mta.post("/feedback", async (c) => {
  requireMtaSecret(c);
  const body = await c.req.json().catch(() => null);
  const items = Array.isArray(body) ? body : [body];
  let queued = 0;
  for (const item of items) {
    const p = feedbackSchema.safeParse(item);
    if (!p.success || (!p.data.emailId && !p.data.messageId)) continue;
    await feedbackQueue.add("feedback", p.data as FeedbackJobData, {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
    });
    queued++;
  }
  return c.json({ ok: true, queued });
});

// Raw inbound: the MTA pipes a verbatim bounce DSN / ARF report here (curl
// --data-binary) instead of pre-parsing it. We parse server-side with the shared
// DSN/ARF parser and enqueue. `X-Original-To` carries the VERP envelope recipient
// (bounce+<emailId>@…) so we can correlate even when the body lacks our headers.
mta.post("/raw", async (c) => {
  requireMtaSecret(c);
  const raw = await c.req.text();
  if (!raw) return c.json({ ok: true, queued: 0 });
  const originalTo = c.req.header("x-original-to") ?? undefined;
  const fallbackId = originalTo ? parseBounceRecipient(originalTo) ?? undefined : undefined;
  const events = parseDeliveryReport(raw, fallbackId).filter(
    (e) => e.emailId || e.messageId,
  );
  let queued = 0;
  for (const data of events) {
    await feedbackQueue.add("feedback", data as FeedbackJobData, {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
    });
    queued++;
  }
  return c.json({ ok: true, queued });
});

// Inbound mail for native mailboxes. Unknown recipient → drop (200, stored:0)
// so the MTA doesn't generate a bounce. Over-quota → 507 (Postfix TEMPFAIL).
mta.post("/inbound", async (c) => {
  requireMtaSecret(c);
  const raw = await c.req.text();
  const rcptHeader = (c.req.header("x-original-to") ?? "").trim();
  const result = await handleMailboxInbound(raw, rcptHeader);
  return c.json({ ok: true, ...result });
});

// The set of domains that have active mailboxes — the MTA polls this to know
// which domains to accept inbound for (and pipe to /mta/inbound). Lets the
// mailbox-domain set stay dynamic without per-add Postfix edits.
mta.get("/mailbox-domains", async (c) => {
  requireMtaSecret(c);
  const rows = await prisma.mailbox.findMany({
    where: { status: "active" },
    select: { address: true },
  });
  const candidates = [
    ...new Set(
      rows
        .map((r) => r.address.split("@")[1])
        .filter((d): d is string => Boolean(d)),
    ),
  ].sort();
  // Only claim a domain for inbound handling if its MX actually points at our
  // MTA. The sync script turns each returned domain into an `inboundpipe:`
  // transport that captures ALL mail to that domain — so returning a domain
  // whose real MX is elsewhere (e.g. a verified SENDING domain still received on
  // Google) would silently swallow every outbound send to it. Fail closed: an MX
  // lookup error excludes the domain (never hijack outbound on a transient DNS
  // failure). A domain only receives once its MX is repointed here anyway, so
  // this never blocks legitimate receiving.
  const checks = await Promise.all(
    candidates.map(async (d) => {
      try {
        return (await mailboxReceivingStatus(d)).ready ? d : null;
      } catch {
        return null;
      }
    }),
  );
  const domains = checks.filter((d): d is string => d !== null);
  return c.json({ domains });
});
