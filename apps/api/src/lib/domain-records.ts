import { resolveTxt, type DnsRecord } from "@ems/core";

// Shared DNS verification for a sending domain. Used by BOTH the dashboard
// (session auth) and the public /domains API (key auth) so a domain verifies
// identically however it was added.
export type RecordCheck = {
  key: string;
  type: string;
  host: string;
  value: string;
  status: "verified" | "missing" | "mismatch";
  found: string | null;
};

export async function checkDomainRecords(domain: {
  dnsRecords: unknown;
  dkimPublicKey: string | null;
}): Promise<{ checks: RecordCheck[]; dkimOk: boolean }> {
  const recs = (domain.dnsRecords as unknown as DnsRecord[]) ?? [];
  const pub = (domain.dkimPublicKey ?? "").replace(/\s+/g, "");
  const checks = await Promise.all(
    recs.map(async (r): Promise<RecordCheck> => {
      const answers = await resolveTxt(r.host);
      let ok = false;
      if (r.purpose === "dkim") ok = pub ? answers.some((a) => a.includes(pub)) : false;
      else if (r.purpose === "spf")
        ok = answers.some((a) => /include:_spf\.ems\.com/i.test(a));
      else if (r.purpose === "dmarc") ok = answers.some((a) => /^v=dmarc1/i.test(a));
      else ok = answers.some((a) => a.includes(r.value.replace(/\s+/g, "")));
      return {
        key: r.purpose,
        type: r.type,
        host: r.host,
        value: r.value,
        status: ok ? "verified" : answers.length ? "mismatch" : "missing",
        found: answers[0] ?? null,
      };
    }),
  );
  // DKIM is the gate: without it we refuse to send for the domain at all.
  const dkimOk = checks.find((c) => c.key === "dkim")?.status === "verified";
  return { checks, dkimOk };
}
