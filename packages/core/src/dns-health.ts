// Mail-health telemetry — "what is running based on DNS records", baked into
// ems (our own engine, zero external deps; DNS-over-HTTPS only). Read-only:
// it NEVER mutates records. Powers the per-domain health report + the pre-publish
// safety preview so a one-click publish can never silently clobber live mail.

const DOH = "https://cloudflare-dns.com/dns-query";

type DohAnswer = { name: string; type: number; data: string };
const RR = { A: 1, TXT: 16, MX: 15, CNAME: 5 } as const;

async function doh(name: string, type: number): Promise<DohAnswer[]> {
  try {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { Answer?: DohAnswer[] };
    return (j.Answer ?? []).filter((a) => a.type === type);
  } catch {
    return [];
  }
}

const unq = (s: string) => s.replace(/^"|"$/g, "").replace(/"\s*"/g, "").trim();
const txtValues = (a: DohAnswer[]) => a.map((x) => unq(x.data));

// ---- SPF: count DNS-lookup mechanisms recursively (the 10-lookup limit, RFC 7208) ----
const LOOKUP_MECH = /(?:^|\s)(?:(include):([^\s]+)|(a)(?::[^\s]+)?|(mx)(?::[^\s]+)?|(ptr)(?:[^\s]*)|(exists):[^\s]+|(redirect)=([^\s]+))/gi;

async function spfLookupCost(
  spf: string,
  seen = new Set<string>(),
  depth = 0,
): Promise<number> {
  if (depth > 10) return 0;
  let cost = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(LOOKUP_MECH);
  while ((m = re.exec(spf))) {
    const include = m[1] && m[2];
    const redirect = m[7] && m[8];
    if (include || redirect) {
      cost += 1; // the include/redirect itself counts as one lookup
      const target = (include ? m[2] : m[8])!.toLowerCase();
      if (!seen.has(target)) {
        seen.add(target);
        const nested = txtValues(await doh(target, RR.TXT)).find((t) => /^v=spf1/i.test(t));
        if (nested) cost += await spfLookupCost(nested, seen, depth + 1);
      }
    } else {
      cost += 1; // a / mx / ptr / exists each cost one lookup
    }
  }
  return cost;
}

// Known sending platforms, recognised from SPF includes or MX hosts.
const SENDER_SIGNS: { rx: RegExp; name: string }[] = [
  { rx: /_spf\.google\.com|aspmx\.l\.google\.com|googlemail\.com/i, name: "Google Workspace" },
  { rx: /\bspf\.protection\.outlook\.com|mail\.protection\.outlook\.com/i, name: "Microsoft 365" },
  { rx: /(?:send|spf)\.resend\.com/i, name: "Resend" },
  { rx: /_spf\.ems\.com/i, name: "ems" },
  { rx: /_spf\.elasticemail\.com/i, name: "ElasticEmail" },
  { rx: /amazonses\.com/i, name: "Amazon SES" },
  { rx: /sendgrid\.net/i, name: "SendGrid" },
  { rx: /mailgun\.org|mailgun\.com/i, name: "Mailgun" },
  { rx: /\bspf\.mandrillapp\.com|mailchimp/i, name: "Mailchimp/Mandrill" },
  { rx: /pphosted\.com|messagelabs\.com/i, name: "Proofpoint" },
  { rx: /mimecast\.com/i, name: "Mimecast" },
  { rx: /postmarkapp\.com/i, name: "Postmark" },
];

export type HealthLevel = "ok" | "warn" | "error";
export interface MailHealth {
  domain: string;
  checkedAt: string;
  score: number; // 0-100
  mx: { host: string; priority: number }[];
  spf: {
    record: string | null;
    recordCount: number;
    lookups: number;
    lookupLimit: number;
    overLimit: boolean;
    all: string | null; // ~all / -all / ?all / +all
  };
  dmarc: { record: string | null; policy: string | null; pct: string | null; rua: string[] };
  dkim: { selector: string; present: boolean }[];
  senders: string[]; // detected platforms (send + inbound)
  risks: { level: HealthLevel; title: string; detail: string }[];
}

// ---- Native-mailbox receiving readiness -------------------------------------
// A mailbox at name@<domain> only receives if that domain's MX points at our
// MTA. Most domains route mail elsewhere (Google/Microsoft), so we detect the
// current handler and tell the user exactly what to do — and, crucially, to use
// a SUBDOMAIN so their existing email keeps working untouched.
export const MAILBOX_MX_HOST = "mail.electronicmailservices.com";

export interface MailboxReceiving {
  domain: string;
  checkedAt: string;
  ready: boolean; // MX includes our MTA
  mx: { host: string; priority: number }[];
  handledBy: string | null; // detected current provider, or first MX host
  conflictsWithExistingMail: boolean; // already routes mail somewhere else
  expectedMx: string;
  record: { type: "MX"; host: string; value: string; priority: number };
  advice: string;
}

/** Does this domain's MX point at our MTA, so native mailboxes can receive? */
export async function mailboxReceivingStatus(
  domain: string,
): Promise<MailboxReceiving> {
  const root = domain.toLowerCase().trim().replace(/\.$/, "");
  const mxA = await doh(root, RR.MX);
  const mx = mxA
    .map((a) => {
      const [prio, ...host] = a.data.trim().split(/\s+/);
      return {
        priority: Number(prio) || 0,
        host: host.join(" ").replace(/\.$/, "").toLowerCase(),
      };
    })
    .sort((a, b) => a.priority - b.priority);
  const ready = mx.some((m) => m.host === MAILBOX_MX_HOST);
  const others = mx.filter((m) => m.host !== MAILBOX_MX_HOST);
  const detected =
    SENDER_SIGNS.find(
      (s) => s.name !== "ems" && s.rx.test(others.map((m) => m.host).join(" ")),
    )?.name ?? null;
  const handledBy = ready ? "ems" : (detected ?? others[0]?.host ?? null);
  const conflictsWithExistingMail = !ready && others.length > 0;
  const advice = ready
    ? "Receiving is configured — mail to this domain reaches your mailboxes."
    : conflictsWithExistingMail
      ? `Mail for this domain is handled by ${handledBy}. Don't change its MX or you'll break that mail — instead create mailboxes on a subdomain such as inbox.${root} and point only the subdomain's MX at ems.`
      : "Add this MX record so mail to this domain reaches your mailboxes.";
  return {
    domain: root,
    checkedAt: new Date().toISOString(),
    ready,
    mx,
    handledBy,
    conflictsWithExistingMail,
    expectedMx: MAILBOX_MX_HOST,
    record: { type: "MX", host: root, value: MAILBOX_MX_HOST, priority: 10 },
    advice,
  };
}

/** Analyze a domain's live mail DNS (MX, SPF, DMARC, DKIM) and score its health. */
export async function analyzeMailHealth(
  domain: string,
  opts: { dkimSelectors?: string[] } = {},
): Promise<MailHealth> {
  const root = domain.toLowerCase().trim();
  const selectors = opts.dkimSelectors ?? ["ems", "google", "resend", "default", "k1", "s1", "selector1", "selector2"];

  const [mxA, txtA, dmarcA, ...dkimA] = await Promise.all([
    doh(root, RR.MX),
    doh(root, RR.TXT),
    doh(`_dmarc.${root}`, RR.TXT),
    ...selectors.map((s) => doh(`${s}._domainkey.${root}`, RR.TXT).then((r) => doh(`${s}._domainkey.${root}`, RR.CNAME).then((c) => [...r, ...c]))),
  ]);

  // MX
  const mx = mxA
    .map((a) => {
      const [prio, ...host] = a.data.trim().split(/\s+/);
      return { priority: Number(prio) || 0, host: host.join(" ").replace(/\.$/, "") };
    })
    .sort((a, b) => a.priority - b.priority);

  // SPF
  const txts = txtValues(txtA);
  const spfRecords = txts.filter((t) => /^v=spf1/i.test(t));
  const spfRecord = spfRecords[0] ?? null;
  const lookups = spfRecord ? await spfLookupCost(spfRecord) : 0;
  const allMech = spfRecord?.match(/([~\-?+])all\s*$/)?.[0]?.trim() ?? null;

  // DMARC
  const dmarcRecord = txtValues(dmarcA).find((t) => /^v=DMARC1/i.test(t)) ?? null;
  const policy = dmarcRecord?.match(/\bp=([a-z]+)/i)?.[1] ?? null;
  const pct = dmarcRecord?.match(/\bpct=(\d+)/i)?.[1] ?? null;
  const rua = dmarcRecord?.match(/\brua=([^;]+)/i)?.[1]?.split(",").map((s) => s.trim()) ?? [];

  // DKIM (selector present if a TXT/CNAME answer exists)
  const dkim = selectors.map((selector, i) => ({ selector, present: (dkimA[i] ?? []).length > 0 }));

  // Detected senders (from SPF + MX)
  const haystack = [spfRecord ?? "", ...mx.map((m) => m.host)].join(" ");
  const senders = SENDER_SIGNS.filter((s) => s.rx.test(haystack)).map((s) => s.name);

  // ---- Risk assessment + score ----
  const risks: MailHealth["risks"] = [];
  let score = 100;
  if (mx.length === 0) { risks.push({ level: "warn", title: "No MX records", detail: "This domain can't receive email." }); score -= 5; }
  if (spfRecords.length === 0) { risks.push({ level: "error", title: "No SPF record", detail: "Add a v=spf1 record or senders may be marked spam." }); score -= 30; }
  if (spfRecords.length > 1) { risks.push({ level: "error", title: `${spfRecords.length} SPF records`, detail: "Exactly one SPF record is allowed — multiple cause a permerror. Merge them." }); score -= 30; }
  if (lookups > 10) { risks.push({ level: "error", title: `SPF over the 10-lookup limit (${lookups})`, detail: "Receivers return permerror and may reject mail. Remove unused includes or flatten." }); score -= 25; }
  else if (lookups >= 8) { risks.push({ level: "warn", title: `SPF near the lookup limit (${lookups}/10)`, detail: "Trim includes before you add another sender." }); score -= 8; }
  if (allMech === "+all") { risks.push({ level: "error", title: "SPF +all (open)", detail: "Anyone can spoof you. Use ~all or -all." }); score -= 20; }
  if (!dmarcRecord) { risks.push({ level: "warn", title: "No DMARC record", detail: "Add v=DMARC1 (start at p=none with rua reporting) — now required by Google/Yahoo bulk-sender rules." }); score -= 15; }
  else if (policy === "none") { risks.push({ level: "warn", title: "DMARC p=none (monitor only)", detail: "Not enforcing. Tighten to p=quarantine once you confirm all senders pass alignment." }); score -= 5; }
  if (!dkim.some((d) => d.present)) { risks.push({ level: "warn", title: "No DKIM selector found", detail: "DKIM signing strengthens deliverability and DMARC alignment." }); score -= 10; }

  return {
    domain: root,
    checkedAt: new Date().toISOString(),
    score: Math.max(0, Math.min(100, score)),
    mx,
    spf: {
      record: spfRecord,
      recordCount: spfRecords.length,
      lookups,
      lookupLimit: 10,
      overLimit: lookups > 10,
      all: allMech,
    },
    dmarc: { record: dmarcRecord, policy, pct, rua },
    dkim,
    senders,
    risks,
  };
}
