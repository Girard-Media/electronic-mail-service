import { promises as dnsp } from "node:dns";
import { isIP } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { bounceReturnPath } from "./verp.js";
import type { MailProvider } from "./provider.js";
import type {
  NormalizedMessage,
  DnsRecord,
  VerificationStatus,
  DomainAuthInput,
} from "./types.js";

export interface SmtpProviderOptions {
  /** smtp://user:pass@host:port (or smtp://host:port for an open internal relay) */
  url: string;
  /**
   * Bounce domain for the VERP return-path (e.g. "bounce.electronicmailservices.com"). When
   * set, the envelope sender becomes `bounce+<emailId>@<domain>` so DSNs route
   * back to our MTA correlated to the email id. When unset, nodemailer's default
   * envelope (= the From address) is used — bounces would go to the sender.
   */
  bounceDomain?: string;
}

/**
 * Sends through ems' OWN MTA over SMTP (no third-party cloud). The MTA
 * handles DKIM signing and outbound delivery to recipient MX. This is the
 * default sending path; no third-party cloud sender is used.
 */
export class SmtpProvider implements MailProvider {
  readonly name = "smtp";
  private readonly u: URL;
  private readonly bounceDomain?: string;
  private tx: Transporter | null = null;

  constructor(opts: SmtpProviderOptions) {
    this.u = new URL(opts.url);
    this.bounceDomain = opts.bounceDomain;
  }

  // Build (and cache) the transport, connecting to the MTA's *IPv4* address.
  // The container network resolves the MTA to both A and AAAA, but the MTA only
  // trusts the IPv4 range for relay — an IPv6 hop is rejected with "554 Access
  // denied". Resolving the A record and connecting to the literal IPv4 is the
  // only reliable way to force IPv4 (nodemailer ignores family/ipv4first hints).
  private async transport(): Promise<Transporter> {
    if (this.tx) return this.tx;
    let host = this.u.hostname;
    if (!isIP(host)) {
      try {
        const [ip] = await dnsp.resolve4(host);
        if (ip) host = ip;
      } catch {
        // fall back to the hostname if A-record resolution fails
      }
    }
    this.tx = nodemailer.createTransport({
      host,
      port: this.u.port ? Number(this.u.port) : 25,
      secure: this.u.protocol === "smtps:",
      // The internal MTA presents a self-signed STARTTLS cert on the trusted
      // container network — accept it (this hop never leaves the host).
      tls: { rejectUnauthorized: false, servername: this.u.hostname },
      auth: this.u.username
        ? {
            user: decodeURIComponent(this.u.username),
            pass: decodeURIComponent(this.u.password),
          }
        : undefined,
    });
    return this.tx;
  }

  async send(
    msg: NormalizedMessage,
  ): Promise<{ providerMessageId: string }> {
    const tx = await this.transport();
    // Deterministic Message-ID + ref header so bounce DSNs and ISP feedback-loop
    // reports (which quote the original message) correlate back to this email id.
    const refHeaders: Record<string, string> = { "X-Entity-Ref-ID": msg.emailId };
    for (const [k, v] of Object.entries(msg.headers ?? {})) {
      if (!/^[A-Za-z0-9-]+$/.test(k)) continue;
      refHeaders[k] = String(v).replace(/[\r\n\0]+/g, " ");
    }
    // VERP return-path: override the SMTP envelope sender so DSNs come back to
    // OUR bounce domain (keyed to the email id), not the customer's From domain.
    // The header From: is untouched, and DKIM (signed with the From domain's
    // key) keeps DMARC aligned regardless of this envelope domain.
    const envelope = this.bounceDomain
      ? {
          from: bounceReturnPath(msg.emailId, this.bounceDomain),
          to: [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])],
        }
      : undefined;
    const info = await tx.sendMail({
      messageId: `<${msg.emailId}@electronicmailservices.com>`,
      envelope,
      from: msg.from,
      to: msg.to,
      cc: msg.cc,
      bcc: msg.bcc,
      replyTo: msg.replyTo,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: refHeaders,
      // Content only. Never pass `path` — nodemailer would fetch/read it (SSRF).
      attachments: msg.attachments
        ?.filter((a) => Boolean(a.content))
        .map((a) => ({
          filename: a.filename,
          content: a.content,
          encoding: "base64" as const,
          ...(a.contentType ? { contentType: a.contentType } : {}),
        })),
      // per-domain DKIM: sign in-app with the customer domain's key (the MTA
      // relays as-is). electronicmailservices.com falls through to the MTA's own signing.
      dkim: msg.dkim
        ? {
            domainName: msg.dkim.domainName,
            keySelector: msg.dkim.keySelector,
            privateKey: msg.dkim.privateKey,
          }
        : undefined,
    });
    return { providerMessageId: info.messageId };
  }

  // Domain auth (DKIM/SPF/DMARC) is managed at the MTA + DNS layer for the
  // self-hosted setup; these return the records the dashboard surfaces.
  async setupDomainAuth(_input: DomainAuthInput): Promise<DnsRecord[]> {
    return [];
  }

  async getDomainStatus(_domainName: string): Promise<VerificationStatus> {
    return "verified";
  }
}
