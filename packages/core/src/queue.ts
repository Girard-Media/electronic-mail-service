import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

// Shared queue/cache-store connection for all producers/consumers.
export const connection = new Redis(env.QUEUE_URL, {
  maxRetriesPerRequest: null,
});

export const QUEUE_SEND = "send";
export const QUEUE_WEBHOOK = "webhook";
export const QUEUE_FEEDBACK = "feedback";

export const sendQueue = new Queue(QUEUE_SEND, { connection });
export const webhookQueue = new Queue(QUEUE_WEBHOOK, { connection });
export const feedbackQueue = new Queue(QUEUE_FEEDBACK, { connection });

/** Payload for a send job — keep it small; workers load the row from the database. */
export interface SendJobData {
  emailId: string;
}

/** Payload for a webhook delivery job. */
export interface WebhookJobData {
  deliveryId: string;
}

/**
 * Async delivery feedback ingested from the MTA (bounce DSNs, ISP feedback-loop
 * complaints, delivery confirmations). The worker matches the original email,
 * advances its status, fans out the webhook, and auto-suppresses on hard
 * bounce / complaint. This is what turns "sent" into a real delivery lifecycle.
 */
export interface FeedbackJobData {
  type: "delivered" | "bounced" | "complained" | "delivery_delayed";
  /** ems email id — parsed from the Message-ID `<id@electronicmailservices.com>` or VERP. */
  emailId?: string;
  /** raw Message-ID, if the id couldn't be parsed upstream. */
  messageId?: string;
  bounceType?: "hard" | "soft";
  recipient?: string;
  reason?: string;
  code?: string;
}
