// Provider-agnostic types. The public API normalizes drop-in payloads
// into NormalizedMessage before handing them to a MailProvider.

export interface NormalizedAttachment {
  filename: string;
  /** base64-encoded content. Remote `path` is rejected at ingest and ignored here. */
  content?: string;
  contentType?: string;
}

export interface NormalizedMessage {
  /** internal email id (for correlation with events) */
  emailId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: NormalizedAttachment[];
  /** relay configuration set wiring events back to us */
  configurationSet?: string;
  /** tags surfaced to the provider (relay message tags) */
  tags?: { name: string; value: string }[];
  /** per-domain DKIM signing (set when the From domain is a verified custom domain) */
  dkim?: { domainName: string; keySelector: string; privateKey: string };
}

export interface DnsRecord {
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  priority?: number;
  /** what this record is for, shown in the dashboard */
  purpose: "dkim" | "spf" | "dmarc" | "mail_from" | "tracking";
}

export type VerificationStatus = "pending" | "verified" | "failed";

export interface DomainAuthInput {
  name: string;
  region?: string;
  trackingDomain?: string;
}
