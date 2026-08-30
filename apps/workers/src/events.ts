import { webhookQueue, recipientAddress } from "@ems/core";
import { prisma, Prisma, type EmailEventType, type Email } from "@ems/db";

// Maps internal email-event types to the public webhook event names (Resend-style).
const WEBHOOK_EVENT: Partial<Record<EmailEventType, string>> = {
  sent: "email.sent",
  delivered: "email.delivered",
  bounced: "email.bounced",
  complained: "email.complained",
};

/**
 * Record an email event AND fan it out to any subscribed webhook endpoints for
 * the project (each delivery is queued for the webhook worker to POST + retry).
 */
export async function recordEvent(
  email: Pick<Email, "id" | "projectId" | "to" | "from" | "subject">,
  type: EmailEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  await prisma.emailEvent.create({
    data: {
      emailId: email.id,
      type,
      payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  const eventName = WEBHOOK_EVENT[type];
  if (!eventName) return;

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { projectId: email.projectId, enabled: true },
  });
  for (const ep of endpoints) {
    if (ep.eventTypes.length && !ep.eventTypes.includes(eventName)) continue;
    const body = {
      type: eventName,
      created_at: new Date().toISOString(),
      data: {
        email_id: email.id,
        to: email.to,
        from: email.from,
        subject: email.subject,
        ...(payload ?? {}),
      },
    };
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        eventType: eventName,
        payload: body as Prisma.InputJsonValue,
      },
    });
    await webhookQueue.add(
      "deliver",
      { deliveryId: delivery.id },
      { attempts: 6, backoff: { type: "exponential", delay: 5000 } },
    );
  }
}

/** Add every recipient of a bounced/complained message to the suppression list. */
export async function suppressRecipients(
  email: Pick<Email, "projectId" | "to" | "cc" | "bcc">,
  reason: "hard_bounce" | "complaint" | "manual" | "invalid",
  source: string,
): Promise<void> {
  const addrs = [
    ...new Set([...email.to, ...email.cc, ...email.bcc].map(recipientAddress).filter(Boolean)),
  ];
  for (const address of addrs) {
    await prisma.suppression.upsert({
      where: { projectId_address: { projectId: email.projectId, address } },
      create: { projectId: email.projectId, address, reason, source },
      update: {},
    });
  }
}
