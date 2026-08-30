import { env } from "./env.js";

// Managed-DNS automation for one-click record publishing + propagation
// checks. A platform token (env.DNS_API_TOKEN) covers the zones ems
// owns; a per-project token can be passed to `token` to support BYO-DNS
// (white-label) without changing callers.

const DNS_API = "https://api.cloudflare.com/client/v4";
const DOH = "https://cloudflare-dns.com/dns-query";

export function dnsToken(override?: string | null): string | null {
  const o = override?.trim();
  return o || env.DNS_API_TOKEN || null;
}
export function dnsConfigured(override?: string | null): boolean {
  return Boolean(dnsToken(override));
}

interface CfResp<T = unknown> {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
}
type TxtRecord = { id: string; name: string; content: string };

async function cf<T>(path: string, token: string, init?: RequestInit): Promise<CfResp<T>> {
  const r = await fetch(`${DNS_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return (await r.json().catch(() => ({ success: false }))) as CfResp<T>;
}
function cfError(r: CfResp): string {
  return r.errors?.map((e) => e.message).join("; ") || "DNS provider error";
}

const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/"\s*"/g, "").trim();

/** Find the active managed-DNS zone governing `domain` (tries domain then each parent). */
export async function findZoneForDomain(
  domain: string,
  token: string,
): Promise<{ id: string; name: string } | null> {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const j = await cf<{ id: string; name: string }[]>(
      `/zones?name=${encodeURIComponent(candidate)}&status=active`,
      token,
    );
    if (j.success && j.result?.length) {
      return { id: j.result[0]!.id, name: j.result[0]!.name };
    }
  }
  return null;
}

/** List every active zone in the managed-DNS account for `token` (paginated) — the
 *  source for "sync from Cloudflare": pull all your domains, then bulk-verify. */
export async function listZones(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await cf<{ id: string; name: string }[]>(
      `/zones?status=active&per_page=50&page=${page}`,
      token,
    );
    if (!j.success || !j.result?.length) break;
    out.push(...j.result.map((z) => ({ id: z.id, name: z.name })));
    if (j.result.length < 50) break;
  }
  return out;
}

/** Publish an MX record (idempotent) for `host` → `value` at `priority`, to the
 *  managed-DNS zone governing `host`. Powers one-click mailbox-receiving setup.
 *  Only ever touches the exact `host` record — never the apex unless host IS the
 *  apex — so a subdomain publish can't disturb live apex mail. */
export async function publishMx(
  host: string,
  value: string,
  priority: number,
  token: string,
): Promise<{ zone: string; action: "created" | "unchanged" }> {
  const zone = await findZoneForDomain(host, token);
  if (!zone) {
    throw new Error(`${host} isn't a zone in your connected DNS account — add it there, or add the record manually.`);
  }
  const want = value.replace(/\.$/, "").toLowerCase();
  const existing = await cf<{ id: string; content: string }[]>(
    `/zones/${zone.id}/dns_records?type=MX&name=${encodeURIComponent(host)}&per_page=100`,
    token,
  );
  if (
    existing.success &&
    (existing.result ?? []).some((r) => r.content.replace(/\.$/, "").toLowerCase() === want)
  ) {
    return { zone: zone.name, action: "unchanged" };
  }
  const j = await cf(`/zones/${zone.id}/dns_records`, token, {
    method: "POST",
    body: JSON.stringify({ type: "MX", name: host, content: value, priority, ttl: 1, comment: "ems mailbox" }),
  });
  if (!j.success) throw new Error(cfError(j));
  return { zone: zone.name, action: "created" };
}

async function listTxt(zoneId: string, name: string, token: string): Promise<TxtRecord[]> {
  const j = await cf<TxtRecord[]>(
    `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=100`,
    token,
  );
  return j.success ? j.result ?? [] : [];
}
async function createTxt(zoneId: string, name: string, content: string, token: string) {
  const j = await cf(`/zones/${zoneId}/dns_records`, token, {
    method: "POST",
    body: JSON.stringify({ type: "TXT", name, content, ttl: 1, comment: "ems" }),
  });
  if (!j.success) throw new Error(cfError(j));
}
async function updateTxt(zoneId: string, id: string, name: string, content: string, token: string) {
  const j = await cf(`/zones/${zoneId}/dns_records/${id}`, token, {
    method: "PUT",
    body: JSON.stringify({ type: "TXT", name, content, ttl: 1, comment: "ems" }),
  });
  if (!j.success) throw new Error(cfError(j));
}

/** Merge our include into an existing SPF record without clobbering theirs. */
export function mergeSpf(existing: string, includeHost: string): string {
  const s = unquote(existing);
  if (s.includes(`include:${includeHost}`)) return s;
  if (/\s[~\-?+]?all\s*$/.test(s)) {
    return s.replace(/\s([~\-?+]?all)\s*$/, ` include:${includeHost} $1`);
  }
  return `${s} include:${includeHost}`;
}

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
  purpose: "dkim" | "spf" | "dmarc" | string;
}
export interface PublishResult {
  purpose: string;
  host: string;
  action: "created" | "updated" | "merged" | "unchanged" | "skipped" | "error";
  detail?: string;
}

/**
 * Publish a domain's records to its CF zone. DKIM is authoritative (create or
 * update the selector host); SPF is merged into any existing record; DMARC is
 * only created when absent so we never weaken an existing policy.
 */
export async function publishDnsRecords(
  records: DnsRecord[],
  opts: { zoneId: string; token: string },
): Promise<PublishResult[]> {
  const { zoneId, token } = opts;
  const out: PublishResult[] = [];
  for (const rec of records) {
    try {
      const existing = await listTxt(zoneId, rec.host, token);
      if (rec.purpose === "spf") {
        const spf = existing.find((e) => /^"?v=spf1/i.test(unquote(e.content)));
        if (spf) {
          const merged = mergeSpf(spf.content, "_spf.electronicmailservices.com");
          if (unquote(spf.content) === merged) {
            out.push({ purpose: rec.purpose, host: rec.host, action: "unchanged" });
          } else {
            await updateTxt(zoneId, spf.id, rec.host, merged, token);
            out.push({ purpose: rec.purpose, host: rec.host, action: "merged" });
          }
          continue;
        }
      }
      if (rec.purpose === "dmarc" && existing.length) {
        out.push({
          purpose: rec.purpose,
          host: rec.host,
          action: "skipped",
          detail: "existing DMARC left untouched",
        });
        continue;
      }
      const match = existing.find((e) => unquote(e.content) === unquote(rec.value));
      if (match) {
        out.push({ purpose: rec.purpose, host: rec.host, action: "unchanged" });
      } else if (existing.length) {
        await updateTxt(zoneId, existing[0]!.id, rec.host, rec.value, token);
        out.push({ purpose: rec.purpose, host: rec.host, action: "updated" });
      } else {
        await createTxt(zoneId, rec.host, rec.value, token);
        out.push({ purpose: rec.purpose, host: rec.host, action: "created" });
      }
    } catch (e) {
      out.push({
        purpose: rec.purpose,
        host: rec.host,
        action: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/** Resolve a host's TXT records over DoH, whitespace-stripped for matching. */
export async function resolveTxt(host: string): Promise<string[]> {
  try {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=TXT`, {
      headers: { accept: "application/dns-json" },
    });
    const j = (await r.json()) as { Answer?: { data?: string }[] };
    return (j.Answer ?? []).map((a) =>
      String(a.data ?? "").replace(/"/g, "").replace(/\s+/g, ""),
    );
  } catch {
    return [];
  }
}
