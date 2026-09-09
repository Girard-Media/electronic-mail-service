/**
 * Send-path steps 5 + 8: compose, CAN-SPAM validate, emit.
 * SUBMITTED means we handed the message to the MTA (or stub). Delivered
 * still comes from the maillog (E08-025).
 */

import { decryptSecret, unsubscribeUrl, env } from "@ems/core";
import { prisma } from "@ems/db";
import { validateMessage } from "@ems/policy";
import { composeCampaignMessage } from "@ems/sequence";
import { SmtpProvider, type MailProvider } from "@ems/providers";

const STUB = (process.env.MAIL_RELAY_STUB ?? process.env.SES_STUB) === "true" || !process.env.SMTP_URL;

function provider(): MailProvider | null {
  if (STUB || !process.env.SMTP_URL) return null;
  return new SmtpProvider({
    url: process.env.SMTP_URL,
    bounceDomain: env.MAIL_BOUNCE_DOMAIN,
  });
}

export async function emitRoutedIntent(intentId: string): Promise<{ state: string }> {
  const intent = await prisma.sendIntent.findUnique({
    where: { id: intentId },
    include: {
      lead: true,
      campaign: true,
      variant: true,
      step: true,
      mailbox: { include: { persona: true, domain: true } },
    },
  });
  if (!intent || intent.state !== "ROUTED") {
    return { state: intent?.state ?? "missing" };
  }
  if (!intent.mailbox || !intent.variant || !intent.step) {
    await fail(intent.id, "routed intent missing mailbox, variant, or step");
    return { state: "FAILED" };
  }
  const persona = intent.mailbox.persona;
  if (!persona?.postalAddress) {
    await fail(intent.id, "mailbox has no persona postal address");
    return { state: "FAILED" };
  }

  const suppressed = await prisma.suppression.findFirst({
    where: {
      address: intent.lead.email.toLowerCase(),
      project: { orgId: intent.orgId },
    },
    select: { id: true },
  });
  if (suppressed) {
    await fail(intent.id, "recipient is suppressed");
    return { state: "FAILED" };
  }

  const projectId = intent.campaign.projectId;
  if (!projectId) {
    await fail(intent.id, "campaign has no projectId for unsubscribe tokens");
    return { state: "FAILED" };
  }

  const composed = composeCampaignMessage({
    intentId: intent.id,
    subject: intent.variant.subject,
    bodyText: intent.variant.bodyText,
    bodyHtml: intent.variant.bodyHtml,
    lead: intent.lead,
    mailbox: { address: intent.mailbox.address, displayName: intent.mailbox.displayName },
    persona: {
      firstName: persona.firstName,
      lastName: persona.lastName,
      postalAddress: persona.postalAddress,
      signatureText: persona.signatureText,
    },
    unsubscribeUrl: unsubscribeUrl(projectId, intent.lead.email),
  });

  const domain = intent.mailbox.domain;
  const fromDomainVerified = Boolean(domain.spfOk && domain.dkimOk && domain.dmarcOk);
  const check = validateMessage({
    subject: composed.subject,
    bodyText: composed.bodyText,
    bodyHtml: composed.bodyHtml,
    fromAddress: composed.fromAddress,
    fromDisplayName: composed.fromDisplayName,
    personaName: composed.personaName,
    postalAddress: composed.postalAddress,
    unsubscribeUrl: composed.unsubscribeUrl,
    headers: composed.headers,
    isFirstTouch: intent.step.isFirstTouch,
    fromDomainVerified,
  });
  if (!check.ok) {
    await fail(intent.id, `compose rejected: ${check.defects.join(",")}`);
    return { state: "FAILED" };
  }

  const from = `${composed.fromDisplayName} <${composed.fromAddress}>`;
  const mta = provider();
  let smtpResponse: string;
  try {
    if (!mta) {
      smtpResponse = `stub 250 queued as stub-${intent.id}`;
    } else {
      let dkim: { domainName: string; keySelector: string; privateKey: string } | undefined;
      if (domain.dkimPrivateEnc && domain.dkimSelector) {
        dkim = {
          domainName: domain.name,
          keySelector: domain.dkimSelector,
          privateKey: decryptSecret(domain.dkimPrivateEnc),
        };
      }
      const sent = await mta.send({
        emailId: intent.id,
        from,
        to: [composed.to],
        subject: composed.subject,
        text: composed.bodyText,
        html: composed.bodyHtml ?? undefined,
        headers: composed.headers,
        dkim,
      });
      smtpResponse = sent.providerMessageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(intent.id, `submit failed: ${message}`);
    return { state: "FAILED" };
  }

  await prisma.sendIntent.update({
    where: { id: intent.id },
    data: {
      state: "SUBMITTED",
      submittedAt: new Date(),
      messageId: composed.messageId,
      smtpResponse,
      lastError: null,
    },
  });
  await prisma.lead.update({
    where: { id: intent.leadId },
    data: { status: "CONTACTED" },
  });
  await prisma.stepVariant.update({
    where: { id: intent.variant.id },
    data: { sentCount: { increment: 1 } },
  });
  return { state: "SUBMITTED" };
}

async function fail(id: string, lastError: string) {
  await prisma.sendIntent.update({
    where: { id },
    data: { state: "FAILED", lastError },
  });
}
