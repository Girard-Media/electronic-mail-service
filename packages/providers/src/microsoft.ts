import { randomUUID } from "node:crypto";
import type { MailProvider } from "./provider.js";
import type {
  NormalizedMessage,
  NormalizedAttachment,
  DnsRecord,
  VerificationStatus,
  DomainAuthInput,
} from "./types.js";

const GRAPH_SENDMAIL = "https://graph.microsoft.com/v1.0/me/sendMail";

export interface MicrosoftProviderOptions {
  /** Returns a currently-valid Graph access token (caller owns refresh). */
  getAccessToken: () => Promise<string>;
}

// Split "Display Name <addr@host>" or a bare address into Graph's shape.
function parseAddress(s: string): { address: string; name?: string } {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, address: m[2]!.trim() };
  return { address: s.trim() };
}

const recipients = (list?: string[]) =>
  (list ?? []).map((s) => {
    const { address, name } = parseAddress(s);
    return { emailAddress: name ? { address, name } : { address } };
  });

const graphAttachment = (a: NormalizedAttachment) => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: a.filename,
  contentType: a.contentType || "application/octet-stream",
  contentBytes: a.content ?? "",
});

/**
 * Sends through a connected Microsoft 365 / Outlook mailbox via the Microsoft
 * Graph `sendMail` endpoint (sends as the authenticated mailbox). OAuth handles
 * identity, so domain DNS auth is not applicable — those methods are no-ops.
 */
export class MicrosoftProvider implements MailProvider {
  readonly name = "microsoft";

  constructor(private readonly opts: MicrosoftProviderOptions) {}

  async send(msg: NormalizedMessage): Promise<{ providerMessageId: string }> {
    const token = await this.opts.getAccessToken();

    // Graph only accepts custom internet headers prefixed with "x-".
    const xHeaders = Object.entries(msg.headers ?? {})
      .filter(([k]) => /^x-/i.test(k))
      .map(([name, value]) => ({ name, value }));
    const attachments = (msg.attachments ?? []).map(graphAttachment);

    const message: Record<string, unknown> = {
      subject: msg.subject,
      body: {
        contentType: msg.html ? "HTML" : "Text",
        content: msg.html ?? msg.text ?? "",
      },
      toRecipients: recipients(msg.to),
      ccRecipients: recipients(msg.cc),
      bccRecipients: recipients(msg.bcc),
      replyTo: recipients(msg.replyTo),
    };
    if (xHeaders.length) message.internetMessageHeaders = xHeaders;
    if (attachments.length) message.attachments = attachments;

    const r = await fetch(GRAPH_SENDMAIL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    // sendMail returns 202 Accepted with an empty body (no message id).
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`Graph sendMail failed (${r.status}): ${detail.slice(0, 300)}`);
    }
    return { providerMessageId: `msgraph-${randomUUID()}` };
  }

  async setupDomainAuth(_input: DomainAuthInput): Promise<DnsRecord[]> {
    return [];
  }
  async getDomainStatus(_domainName: string): Promise<VerificationStatus> {
    return "verified";
  }
}
