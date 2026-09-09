import { setDefaultResultOrder } from "node:dns";
import { Worker } from "bullmq";

// Prefer IPv4 when resolving the internal MTA hostname — the MTA only trusts the
// container network's IPv4 range for relay, so an IPv6 hop is rejected.
setDefaultResultOrder("ipv4first");

import { createHmac } from "node:crypto";
import {
  connection,
  env,
  QUEUE_SEND,
  QUEUE_WEBHOOK,
  QUEUE_FEEDBACK,
  QUEUE_INTENT,
  pingHeartbeat,
  decryptSecret,
  encryptSecret,
  parseFromDomain,
  unsubscribeUrl,
  applyTracking,
  fetchPublicWebhook,
  storedAttachments,
  SYSTEM_SENDING_DOMAINS,
  isSharedInboxDomain,
  parseSharedInboxDomains,
  type SendJobData,
  type WebhookJobData,
  type FeedbackJobData,
  type IntentJobData,
} from "@ems/core";
import {
  SmtpProvider,
  GoogleProvider,
  MicrosoftProvider,
  refreshGoogleToken,
  refreshMicrosoftToken,
  type MailProvider,
  type NormalizedMessage,
  type OAuthAppConfig,
} from "@ems/providers";
import { prisma, type Email } from "@ems/db";
import { recordEvent, suppressRecipients } from "./events.js";
import { routeIntent } from "./route-intent.js";

// ems sends on its OWN infrastructure (SMTP/MTA) via the MailProvider
// seam — never a third-party cloud sender. When SMTP_URL points at the MTA
// the worker delivers for real; otherwise the stub flag marks messages sent so
// the pipeline stays testable end-to-end.
const mtaProvider = process.env.SMTP_URL
  ? new SmtpProvider({
      url: process.env.SMTP_URL,
      // VERP (opt-in): when MAIL_BOUNCE_DOMAIN is set, route DSNs back to our
      // bounce domain keyed to the email id so feedback-ingest can close the
      // loop. Undefined = off (envelope falls back to the From address), which
      // is the safe default until the inbound path is wired.
      bounceDomain: env.MAIL_BOUNCE_DOMAIN,
    })
  : null;
const STUB =
  (process.env.MAIL_RELAY_STUB ?? process.env.SES_STUB) === "true" || !mtaProvider;

function oauthConfig(p: "google" | "microsoft"): OAuthAppConfig | null {
  if (p === "google") {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
    };
  }
  if (!env.MS_OAUTH_CLIENT_ID || !env.MS_OAUTH_CLIENT_SECRET) return null;
  return {
    clientId: env.MS_OAUTH_CLIENT_ID,
    clientSecret: env.MS_OAUTH_CLIENT_SECRET,
    redirectUri: env.MS_OAUTH_REDIRECT_URI ?? "",
    tenant: env.MS_OAUTH_TENANT,
  };
}

// Build a provider for a connected mailbox, refreshing + persisting its OAuth
// access token when it is close to expiry.
async function connectedProvider(
  connectedAccountId: string,
): Promise<MailProvider> {
  const acct = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
  });
  if (!acct) throw new Error(`connected account ${connectedAccountId} not found`);
  if (acct.status !== "active") {
    throw new Error(`connected account ${acct.email} is ${acct.status}`);
  }
  const cfg = oauthConfig(acct.provider as "google" | "microsoft");
  if (!cfg) throw new Error(`OAuth app not configured for ${acct.provider}`);

  const getAccessToken = async (): Promise<string> => {
    const skewMs = 60_000;
    if (acct.tokenExpiresAt && acct.tokenExpiresAt.getTime() - Date.now() > skewMs) {
      return decryptSecret(acct.accessToken);
    }
    const set =
      acct.provider === "google"
        ? await refreshGoogleToken(cfg, decryptSecret(acct.refreshToken))
        : await refreshMicrosoftToken(cfg, decryptSecret(acct.refreshToken));
    await prisma.connectedAccount.update({
      where: { id: acct.id },
      data: {
        accessToken: encryptSecret(set.accessToken),
        ...(set.refreshToken
          ? { refreshToken: encryptSecret(set.refreshToken) }
          : {}),
        tokenExpiresAt: new Date(set.expiresAt),
        status: "active",
        lastError: null,
      },
    });
    return set.accessToken;
  };

  return acct.provider === "google"
    ? new GoogleProvider({ getAccessToken })
    : new MicrosoftProvider({ getAccessToken });
}

function toNormalized(e: Email): NormalizedMessage {
  return {
    emailId: e.id,
    from: e.from,
    to: e.to,
    cc: e.cc.length ? e.cc : undefined,
    bcc: e.bcc.length ? e.bcc : undefined,
    replyTo: e.replyTo.length ? e.replyTo : undefined,
    subject: e.subject,
    html: e.html ?? undefined,
    text: e.text ?? undefined,
    headers: (e.headers as unknown as Record<string, string> | null) ?? undefined,
    configurationSet: env.MAIL_RELAY_CONFIG_SET,
    tags:
      (e.tags as unknown as { name: string; value: string }[] | null) ??
      undefined,
    attachments: storedAttachments(e.attachments),
  };
}

const sendWorker = new Worker<SendJobData>(
  QUEUE_SEND,
  async (job) => {
    const { emailId } = job.data;
    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) {
      console.warn(`[send] ${emailId} not found — skipping`);
      return;
    }
    if (email.status === "canceled") return;

    // Connected-account sends always go out for real; only MTA-routed mail stubs.
    if (!email.connectedAccountId && (STUB || !mtaProvider)) {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: "sent",
          providerMessageId: `stub-${emailId}`,
          sentAt: new Date(),
        },
      });
      await recordEvent(email, "sent", { provider: "stub" });
      console.log(`[send] sent ${emailId} (stub — MTA not wired)`);
      return;
    }

    try {
      let activeProvider: MailProvider;
      let dkim:
        | { domainName: string; keySelector: string; privateKey: string }
        | undefined;
      let trackOpen = false;
      let trackClick = false;

      if (email.connectedAccountId) {
        // Connected mailbox: Gmail/Graph signs and sends as the OAuth'd account.
        // No in-app DKIM and no verified-domain requirement.
        activeProvider = await connectedProvider(email.connectedAccountId);
      } else {
        activeProvider = mtaProvider!;
        // Per-domain DKIM: if the From domain is a verified custom domain, sign
        // with its (decrypted) key. System domains AND shared inbox domains
        // (agents.electronicmailservices.com / inbox.electronicmailservices.com) fall through to the MTA's
        // OpenDKIM. Authorization for shared domains already happened at enqueue
        // via mailbox ownership — they are deliberately NOT in
        // SYSTEM_SENDING_DOMAINS (a blanket allow would let project A spoof
        // project B's inbox). Any other domain is fail-closed.
        const fromDomain = parseFromDomain(email.from);
        const sharedInbox = Boolean(
          fromDomain &&
            isSharedInboxDomain(fromDomain, parseSharedInboxDomains(env.SHARED_INBOX_DOMAINS)),
        );
        if (fromDomain && !SYSTEM_SENDING_DOMAINS.has(fromDomain) && !sharedInbox) {
          const d = await prisma.domain.findFirst({
            where: { projectId: email.projectId, name: fromDomain, status: "verified" },
            select: {
              dkimSelector: true,
              dkimPrivateKey: true,
              openTracking: true,
              clickTracking: true,
            },
          });
          if (!d?.dkimPrivateKey || !d.dkimSelector) {
            throw new Error(
              `Refusing to send: ${fromDomain} is not a verified sending domain for this project.`,
            );
          }
          dkim = {
            domainName: fromDomain,
            keySelector: d.dkimSelector,
            privateKey: decryptSecret(d.dkimPrivateKey),
          };
          trackOpen = d.openTracking;
          trackClick = d.clickTracking;
        }
      }

      const normalized = toNormalized(email);
      // Open/click tracking (opt-in per domain). Only the SENT copy is rewritten;
      // the stored Email.html stays original.
      if ((trackOpen || trackClick) && normalized.html) {
        normalized.html = applyTracking(normalized.html, email.id, {
          opens: trackOpen,
          clicks: trackClick,
        });
      }
      // List-Unsubscribe + one-click (RFC 8058) on MTA sends — required by Gmail/
      // Yahoo bulk rules. Skip connected-mailbox sends (they go out as the user's
      // own account) and don't override a caller-supplied header.
      if (!email.connectedAccountId && email.to[0]) {
        const hasUnsub = Object.keys(normalized.headers ?? {}).some(
          (h) => h.toLowerCase() === "list-unsubscribe",
        );
        if (!hasUnsub) {
          normalized.headers = {
            ...(normalized.headers ?? {}),
            "List-Unsubscribe": `<${unsubscribeUrl(email.projectId, email.to[0])}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          };
        }
      }
      const { providerMessageId } = await activeProvider.send({
        ...normalized,
        dkim,
      });
      await prisma.email.update({
        where: { id: emailId },
        data: { status: "sent", providerMessageId, sentAt: new Date() },
      });
      await recordEvent(email, "sent", { providerMessageId });
      console.log(`[send] sent ${emailId} via ${activeProvider.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { responseCode?: number })?.responseCode;
      // NOTE: this is the SUBMISSION hop to our OWN MTA, which relays for us. A
      // 5xx here is almost always OUR infrastructure (e.g. relay/auth), NOT a
      // recipient rejection — so we must NOT suppress the recipient. Real
      // recipient bounces arrive asynchronously as DSNs (ingested separately).
      // Mark failed and let the job retry.
      await prisma.email.update({
        where: { id: emailId },
        data: { status: "failed" },
      });
      await recordEvent(email, "rejected", { error: message, code });
      throw err; // retry per the job's attempts policy
    }
  },
  { connection, concurrency: 20 },
);

sendWorker.on("failed", (job, err) =>
  console.error(`[send] failed ${job?.id}:`, err.message),
);

// ---- Webhook delivery worker: POST events to customer endpoints, signed. ----
const webhookWorker = new Worker<WebhookJobData>(
  QUEUE_WEBHOOK,
  async (job) => {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || !delivery.endpoint.enabled) return;
    const body = JSON.stringify(delivery.payload);
    const signature = createHmac("sha256", decryptSecret(delivery.endpoint.secret))
      .update(body)
      .digest("hex");
    let ok = false;
    let responseStatus: number | null = null;
    try {
      // Connect-time DNS re-check (packages/core ssrf) — a public hostname that
      // later resolves to 10.x / 169.254.169.254 / loopback is refused. Redirects
      // are not followed.
      const res = await fetchPublicWebhook(delivery.endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ems-event": delivery.eventType,
          "ems-signature": `sha256=${signature}`,
        },
        body,
        timeoutMs: 10_000,
      });
      responseStatus = res.status;
      ok = res.ok;
    } catch (e) {
      ok = false;
    }
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: ok ? "succeeded" : lastAttempt ? "dead_letter" : "failed",
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        responseStatus,
      },
    });
    if (!ok) throw new Error(`webhook ${delivery.endpoint.url} -> ${responseStatus ?? "error"}`);
  },
  { connection, concurrency: 10 },
);

webhookWorker.on("failed", (job, err) =>
  console.error(`[webhook] failed ${job?.id}:`, err.message),
);

// ---- Feedback worker: ingest bounce/complaint/delivery feedback from our MTA,
// advance the email status (monotonic — never regress past a terminal state),
// fan out the webhook, and auto-suppress hard bounces + complaints. This is the
// async loop that turns "sent" into a real delivery lifecycle. ----
function nextStatus(
  current: string,
  type: FeedbackJobData["type"],
): "delivered" | "bounced" | "complained" | null {
  const open = current === "queued" || current === "scheduled" || current === "sent";
  if (type === "delivered" && open) return "delivered";
  if (type === "bounced" && open) return "bounced";
  if (type === "complained" && (open || current === "delivered")) return "complained";
  return null; // delivery_delayed or already-terminal → record the event only
}

const feedbackWorker = new Worker<FeedbackJobData>(
  QUEUE_FEEDBACK,
  async (job) => {
    const { type, emailId, messageId, bounceType, recipient, reason, code } = job.data;
    // Resolve the email: explicit id, else parse `<id@electronicmailservices.com>`, else a
    // providerMessageId match.
    const idFromMsg = messageId?.replace(/^<|>$/g, "").split("@")[0];
    const id = emailId || idFromMsg;
    let email: Email | null = id
      ? await prisma.email.findUnique({ where: { id } })
      : null;
    if (!email && messageId) {
      email = await prisma.email.findFirst({ where: { providerMessageId: messageId } });
    }
    if (!email) {
      console.warn(`[feedback] no email match (${emailId ?? messageId ?? "?"})`);
      return;
    }
    const ns = nextStatus(email.status, type);
    if (ns) await prisma.email.update({ where: { id: email.id }, data: { status: ns } });
    await recordEvent(email, type, { recipient, reason, code, bounceType });
    if (type === "complained" || (type === "bounced" && bounceType !== "soft")) {
      await suppressRecipients(
        email,
        type === "complained" ? "complaint" : "hard_bounce",
        "mta",
      );
    }
    console.log(`[feedback] ${type} ${email.id}${ns ? ` -> ${ns}` : ""}`);
  },
  { connection, concurrency: 10 },
);

feedbackWorker.on("failed", (job, err) =>
  console.error(`[feedback] failed ${job?.id}:`, err.message),
);

const intentWorker = new Worker<IntentJobData>(
  QUEUE_INTENT,
  async (job) => {
    const out = await routeIntent(job.data);
    console.log(`[intent] ${job.data.intentId} -> ${out.state}${out.mailboxId ? ` via ${out.mailboxId}` : ""}`);
  },
  { connection, concurrency: 10 },
);
intentWorker.on("failed", (job, err) =>
  console.error(`[intent] failed ${job?.id}:`, err.message),
);

console.log(
  `ems workers running (send + webhook + feedback + intent queues) [${mtaProvider ? "smtp" : "stub"}]`,
);

// Better Stack heartbeat: a missed ping pages "sending pipeline stalled" even
// if the API still 200s. No-op when the env URL is unset.
setInterval(() => {
  void pingHeartbeat(env.BETTERSTACK_HEARTBEAT_WORKERS);
}, 60_000);
void pingHeartbeat(env.BETTERSTACK_HEARTBEAT_WORKERS);
