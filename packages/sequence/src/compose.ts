/**
 * Compose a campaign message (send-path step 5).
 * Personalise, optional spintax, CAN-SPAM footer, RFC 8058 headers.
 * Does not send. Validation lives in @ems/policy.validateMessage.
 */

import { interpolate } from "@ems/core";
import { hash32 } from "./schedule.js";

export interface ComposeInput {
  intentId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  lead: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    title?: string | null;
    companyName?: string | null;
  };
  mailbox: { address: string; displayName: string };
  persona: { firstName: string; lastName: string; postalAddress: string; signatureText?: string | null };
  unsubscribeUrl: string;
}

export interface ComposedCampaignMessage {
  fromAddress: string;
  fromDisplayName: string;
  personaName: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  postalAddress: string;
  unsubscribeUrl: string;
  headers: Record<string, string>;
  messageId: string;
}

/** Expand `{hello|hi}` using a stable seed. Leaves `{not-a-spin}` alone. */
export function expandSpintax(input: string, seed: string): string {
  return input.replace(/\{([^{}|]*\|[^{}]*)\}/g, (_, inner: string) => {
    const parts = inner.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return `{${inner}}`;
    return parts[hash32(`${seed}:${inner}`) % parts.length] ?? parts[0] ?? "";
  });
}

function vars(lead: ComposeInput["lead"]) {
  return {
    firstName: lead.firstName ?? "",
    lastName: lead.lastName ?? "",
    title: lead.title ?? "",
    companyName: lead.companyName ?? "",
    email: lead.email,
    company: lead.companyName ?? "",
  };
}

function personalize(template: string, lead: ComposeInput["lead"], seed: string): string {
  return interpolate(expandSpintax(template, seed), vars(lead));
}

export function composeCampaignMessage(input: ComposeInput): ComposedCampaignMessage {
  const seed = input.intentId;
  const personaName = `${input.persona.firstName} ${input.persona.lastName}`.replace(/\s+/g, " ").trim();
  const fromDisplayName = personaName || input.mailbox.displayName;
  const postal = input.persona.postalAddress.trim();
  const unsub = input.unsubscribeUrl.trim();
  const sig = (input.persona.signatureText ?? fromDisplayName).trim();
  const footer = `\n\n--\n${sig}\n${postal}\nUnsubscribe: ${unsub}`;

  const subject = personalize(input.subject, input.lead, `${seed}:subject`);
  const bodyText = personalize(input.bodyText, input.lead, `${seed}:text`) + footer;
  const bodyHtml = input.bodyHtml
    ? personalize(input.bodyHtml, input.lead, `${seed}:html`) +
      `<p style="color:#666;font-size:12px">--<br>${escapeHtml(sig)}<br>${escapeHtml(postal)}<br>` +
      `Unsubscribe: <a href="${escapeHtml(unsub)}">${escapeHtml(unsub)}</a></p>`
    : null;

  const messageId = `<${input.intentId}@electronicmailservices.com>`;
  return {
    fromAddress: input.mailbox.address.toLowerCase(),
    fromDisplayName,
    personaName,
    to: input.lead.email.toLowerCase(),
    subject,
    bodyText,
    bodyHtml,
    postalAddress: postal,
    unsubscribeUrl: unsub,
    messageId,
    headers: {
      "Message-ID": messageId,
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
