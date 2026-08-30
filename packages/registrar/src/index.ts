/**
 * @ems/registrar — the RegistrarProvider and DnsProvider seams.
 *
 * Buying sending domains in bulk needs *a* registrar; that is one of the two
 * tolerated third parties beyond hosting and inference (planning/VISION.md §2.4).
 * Both are behind interfaces so a provider swap is one adapter.
 */

export interface DomainQuote {
  name: string;
  available: boolean;
  priceUsd: number | null;
  renewUsd: number | null;
}

export interface RegistrarProvider {
  readonly id: string;
  search(names: string[]): Promise<DomainQuote[]>;
  purchase(name: string, opts: { years: number; whoisPrivacy: boolean }): Promise<{ orderId: string }>;
  setNameservers(name: string, nameservers: string[]): Promise<void>;
  setAutoRenew(name: string, on: boolean): Promise<void>;
  list(): Promise<Array<{ name: string; expiresAt: Date }>>;
}

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT";

export interface DnsRecord {
  type: DnsRecordType;
  name: string;
  content: string;
  priority?: number;
  ttl?: number;
  /** Sending records must never be proxied — orange-cloud breaks mail. */
  proxied?: false;
}

export interface DnsProvider {
  readonly id: string;
  upsertRecord(zone: string, record: DnsRecord): Promise<void>;
  deleteRecord(zone: string, record: Pick<DnsRecord, "type" | "name">): Promise<void>;
  listRecords(zone: string): Promise<DnsRecord[]>;
  /** Must verify against several public resolvers before reporting true (E04-024). */
  verifyPropagation(record: DnsRecord, resolvers: string[]): Promise<boolean>;
}

/**
 * The record set every sending domain gets (planning/INFRA.md §5).
 * SPF is a single hard-fail ip4 with no includes: we control the only sender.
 */
export function desiredRecords(opts: {
  domain: string;
  nodeIp: string;
  ptrHost: string;
  dkimSelector: string;
  dkimPublicKey: string;
  aggregateDomain: string;
  siteIp: string;
  dmarcPolicy: "none" | "quarantine" | "reject";
}): DnsRecord[] {
  const {
    domain, nodeIp, ptrHost, dkimSelector, dkimPublicKey,
    aggregateDomain, siteIp, dmarcPolicy,
  } = opts;
  return [
    { type: "A", name: "@", content: siteIp, proxied: false },
    { type: "A", name: ptrHost.split(".")[0] ?? "mta01", content: nodeIp, proxied: false },
    { type: "MX", name: "@", content: ptrHost, priority: 10 },
    { type: "CNAME", name: "bounce", content: ptrHost, proxied: false },
    { type: "TXT", name: "@", content: `v=spf1 ip4:${nodeIp} -all` },
    { type: "TXT", name: `${dkimSelector}._domainkey`, content: `v=DKIM1; k=rsa; p=${dkimPublicKey}` },
    {
      type: "TXT",
      name: "_dmarc",
      content:
        `v=DMARC1; p=${dmarcPolicy}; rua=mailto:dmarc@${aggregateDomain}; ` +
        `ruf=mailto:dmarc@${aggregateDomain}; fo=1; adkim=s; aspf=s`,
    },
    { type: "TXT", name: "_smtp._tls", content: `v=TLSRPTv1; rua=mailto:tlsrpt@${aggregateDomain}` },
  ];
}

/** TLDs that carry an inherent reputation penalty. Refuse to buy these (E04-060). */
export const PENALISED_TLDS = [
  "xyz", "top", "club", "info", "biz", "online", "site", "click",
  "link", "work", "loan", "download", "review", "country", "stream",
] as const;
