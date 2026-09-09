import { resolveTxt, mailboxReceivingStatus, domainDnsRecords, MAILBOX_MX_HOST } from "@ems/core";
import type { DomainAuthFlags } from "@ems/fleet";

export function fleetDnsBlueprint(name: string, publicKey: string) {
  return domainDnsRecords(name, publicKey);
}

export async function checkFleetAuth(name: string, publicKey: string | null): Promise<{
  flags: DomainAuthFlags;
  issues: string[];
}> {
  const issues: string[] = [];
  const recs = publicKey ? domainDnsRecords(name, publicKey) : [];
  const dkimRec = recs.find((r) => r.purpose === "dkim");
  const spfRec = recs.find((r) => r.purpose === "spf");
  const dmarcRec = recs.find((r) => r.purpose === "dmarc");

  const [dkimTxt, spfTxt, dmarcTxt, mx] = await Promise.all([
    dkimRec ? resolveTxt(dkimRec.host) : Promise.resolve([] as string[]),
    spfRec ? resolveTxt(spfRec.host) : Promise.resolve([] as string[]),
    dmarcRec ? resolveTxt(dmarcRec.host) : Promise.resolve([] as string[]),
    mailboxReceivingStatus(name),
  ]);

  const pub = (publicKey ?? "").replace(/\s+/g, "");
  const dkimOk = Boolean(pub) && dkimTxt.some((a) => a.includes(pub));
  const spfOk = spfTxt.some((a) => /include:_spf\.electronicmailservices\.com/i.test(a));
  const dmarcOk = dmarcTxt.some((a) => /^v=dmarc1/i.test(a.replace(/\s+/g, "")));
  const mxOk = mx.ready === true;

  if (!dkimOk) issues.push(`DKIM missing at ${dkimRec?.host ?? `ems._domainkey.${name}`}`);
  if (!spfOk) issues.push(`SPF must include:_spf.electronicmailservices.com on ${name}`);
  if (!dmarcOk) issues.push(`DMARC missing at _dmarc.${name}`);
  if (!mxOk) issues.push(`MX must point at ${MAILBOX_MX_HOST}`);

  return { flags: { spfOk, dkimOk, dmarcOk, mxOk }, issues };
}
