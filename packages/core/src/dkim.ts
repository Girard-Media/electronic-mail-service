import { generateKeyPairSync } from "node:crypto";

export interface DkimKeypair {
  selector: string;
  /** PEM (pkcs8) private key — stored server-side, used by nodemailer to sign. */
  privateKey: string;
  /** base64 DER of the SPKI public key — the `p=` value in the DKIM DNS TXT. */
  publicKey: string;
}

// Generate an RSA-2048 DKIM keypair for a customer sending domain. We hold the
// private key (DB) and sign in-app per message; the customer publishes the
// public key as a DNS TXT at <selector>._domainkey.<domain>.
export function generateDkimKeypair(selector = "ems"): DkimKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const p = publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return { selector, privateKey, publicKey: p };
}

/** The DNS records a customer publishes to authenticate <domain> for sending. */
export function domainDnsRecords(domain: string, publicKey: string) {
  return [
    {
      type: "TXT",
      host: `ems._domainkey.${domain}`,
      value: `v=DKIM1; k=rsa; p=${publicKey}`,
      purpose: "dkim",
    },
    {
      type: "TXT",
      host: domain,
      value: "v=spf1 include:_spf.electronicmailservices.com ~all",
      purpose: "spf",
    },
    {
      type: "TXT",
      host: `_dmarc.${domain}`,
      value: "v=DMARC1; p=none;",
      purpose: "dmarc",
    },
  ];
}
