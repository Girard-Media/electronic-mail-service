import dns from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { env } from "./env.js";

// SSRF guard for customer-supplied webhook URLs. A tenant must not be able to
// point our delivery worker at internal services (loopback, RFC-1918, link-local,
// cloud metadata, ULA). Creation-time hostname/literal checks are the first
// layer; delivery re-resolves at connect time so a public name cannot rebind to
// a private IP between save and POST. Redirects are not followed — a 3xx is a
// failed delivery, same as Stripe/GitHub webhooks.

const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("224.0.0.0", 3, "ipv4"); // multicast + reserved
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("ff00::", 8, "ipv6");

const BLOCKED_NAME =
  "That host isn't allowed — use a public https endpoint (no localhost or private IPs).";

function unwrapIp(address: string): { ip: string; type: "ipv4" | "ipv6" } | null {
  const kind = isIP(address);
  if (kind === 4) return { ip: address, type: "ipv4" };
  if (kind === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      const tail = address.slice(7);
      if (isIP(tail) === 4) return { ip: tail, type: "ipv4" };
    }
    return { ip: address, type: "ipv6" };
  }
  return null;
}

/** True when this address is loopback, private, link-local, ULA, or reserved. */
export function isBlockedAddress(address: string): boolean {
  const parsed = unwrapIp(address);
  if (!parsed) return false;
  return PRIVATE.check(parsed.ip, parsed.type);
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // IPv6 ULA prefixes (`fc`/`fd`) must only apply to addresses, not names
  // (`fd.com` is a real public hostname).
  if (isIP(h) !== 0) return isBlockedAddress(h);
  return false;
}

/**
 * Validate a customer webhook URL is a public https endpoint. Throws an Error
 * with a user-facing message when it isn't.
 */
export function assertPublicWebhookUrl(raw: string): void {
  // Test/dev escape hatch so the SC-001 e2e can use a localhost receiver.
  // NEVER set WEBHOOK_ALLOW_PRIVATE in production.
  if (env.WEBHOOK_ALLOW_PRIVATE === "true") return;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Enter a valid URL.");
  }
  if (u.protocol !== "https:") {
    throw new Error("Webhook URLs must use https.");
  }
  if (!u.hostname || isBlockedHostname(u.hostname)) {
    throw new Error(BLOCKED_NAME);
  }
}

/** Connect-time resolver for https.request — rejects if ANY A/AAAA is private. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  const fail = (msg: string) => {
    const e = Object.assign(new Error(msg), { code: "ENOTFOUND" });
    callback(e, "", 4);
  };
  if (env.WEBHOOK_ALLOW_PRIVATE === "true") {
    dns.lookup(hostname, options, callback);
    return;
  }
  if (isBlockedHostname(hostname)) {
    fail(BLOCKED_NAME);
    return;
  }
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      fail(BLOCKED_NAME);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0];
    if (!first) {
      fail("ENOTFOUND");
      return;
    }
    callback(null, first.address, first.family);
  });
};

/**
 * POST (or otherwise fetch) a customer webhook URL with SSRF controls:
 * https-only, no private literals, connect-time DNS re-check, no redirects.
 */
export function fetchPublicWebhook(
  raw: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<{ ok: boolean; status: number }> {
  if (env.WEBHOOK_ALLOW_PRIVATE === "true") {
    return fetch(raw, {
      method: init.method ?? "POST",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    }).then((res) => ({ ok: res.ok, status: res.status }));
  }

  assertPublicWebhookUrl(raw);
  const u = new URL(raw);
  const timeoutMs = init.timeoutMs ?? 10_000;
  const method = init.method ?? "POST";
  const headers: Record<string, string> = { ...init.headers };
  const body = init.body ?? "";
  if (body && headers["Content-Length"] === undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        timeout: timeoutMs,
        servername: u.hostname,
        lookup: publicLookup,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
