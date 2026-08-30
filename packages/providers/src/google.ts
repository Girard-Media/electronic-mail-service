import type { MailProvider } from "./provider.js";
import type {
  NormalizedMessage,
  DnsRecord,
  VerificationStatus,
  DomainAuthInput,
} from "./types.js";
import { buildMime, toBase64Url } from "./mime.js";

const GMAIL_SEND =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface GoogleProviderOptions {
  /**
   * Returns a currently-valid access token. The caller owns refresh +
   * persistence (and, for Workspace tenants, may mint the token via
   * domain-wide delegation instead of per-user OAuth).
   */
  getAccessToken: () => Promise<string>;
}

/**
 * Sends through a connected Google (Gmail / Workspace) mailbox via the Gmail
 * API. The mailbox is already an authenticated identity, so domain DNS auth is
 * not applicable here — those methods are no-ops.
 */
export class GoogleProvider implements MailProvider {
  readonly name = "google";

  constructor(private readonly opts: GoogleProviderOptions) {}

  async send(msg: NormalizedMessage): Promise<{ providerMessageId: string }> {
    const token = await this.opts.getAccessToken();
    const raw = toBase64Url(buildMime(msg));
    const r = await fetch(GMAIL_SEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`Gmail send failed (${r.status}): ${detail.slice(0, 300)}`);
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    return { providerMessageId: j.id ?? "gmail" };
  }

  async setupDomainAuth(_input: DomainAuthInput): Promise<DnsRecord[]> {
    return [];
  }
  async getDomainStatus(_domainName: string): Promise<VerificationStatus> {
    return "verified";
  }
}
