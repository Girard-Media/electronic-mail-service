import type {
  NormalizedMessage,
  DnsRecord,
  VerificationStatus,
  DomainAuthInput,
} from "./types.js";

/**
 * The core seam (DECISIONS D2). The shipped default is the self-hosted SMTP
 * relay; multi-provider routing and additional backends all implement this same
 * interface so the public API never changes.
 */
export interface MailProvider {
  readonly name: string;

  /** Dispatch a normalized message. Returns the provider's message id. */
  send(msg: NormalizedMessage): Promise<{ providerMessageId: string }>;

  /**
   * Register a sending identity and return the DNS records the customer must
   * publish (DKIM CNAMEs, SPF/MAIL FROM, DMARC suggestion, tracking CNAME).
   */
  setupDomainAuth(input: DomainAuthInput): Promise<DnsRecord[]>;

  /** Re-check whether the domain's authentication is live. */
  getDomainStatus(domainName: string): Promise<VerificationStatus>;
}
