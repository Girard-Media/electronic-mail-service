/**
 * IP diligence — run this BEFORE paying for a VPS, or immediately after and be
 * prepared to release the address. planning/INFRA.md §3.
 *
 * A dirty IP is worse than no IP. Releasing and retrying is cheap now and
 * catastrophic later.
 *
 * Backlog: E03-001..E03-005.
 *
 *   pnpm tsx scripts/ip-diligence.mts 203.0.113.10
 *   pnpm tsx scripts/ip-diligence.mts 203.0.113.10 --ptr mta01.example.com
 *   pnpm tsx scripts/ip-diligence.mts --egress-only        # run ON the node
 *   pnpm tsx scripts/ip-diligence.mts 203.0.113.10 --json  # machine-readable
 *
 * Uses the host resolver by default: Spamhaus refuses queries from public
 * resolvers. --public-resolver forces 1.1.1.1/9.9.9.9 when the local resolver
 * is untrusted, at the cost of an inconclusive Spamhaus result.
 *
 * Exit codes: 0 clean · 1 listed or failed a hard check · 2 usage error.
 */

import { Resolver } from "node:dns/promises";
import net from "node:net";

// ── DNSBL zones. Per-IP and per-domain, polled on a schedule in production
//    (E09-027/028); here we sweep once against a candidate address.
const IP_ZONES = [
  { zone: "zen.spamhaus.org", label: "Spamhaus ZEN", severity: "critical" },
  { zone: "b.barracudacentral.org", label: "Barracuda", severity: "critical" },
  { zone: "bl.spamcop.net", label: "SpamCop", severity: "high" },
  { zone: "dnsbl.sorbs.net", label: "SORBS", severity: "medium" },
  { zone: "dnsbl-1.uceprotect.net", label: "UCEPROTECT-1", severity: "medium" },
  { zone: "ips.backscatterer.org", label: "Backscatterer", severity: "low" },
  { zone: "psbl.surriel.com", label: "PSBL", severity: "medium" },
  { zone: "db.wpbl.info", label: "WPBL", severity: "low" },
] as const;

// Spamhaus encodes the reason in the final octet of the 127.0.0.x answer.
const SPAMHAUS_CODES: Record<string, string> = {
  "127.0.0.2": "SBL — direct spam source",
  "127.0.0.3": "SBL CSS — snowshoe / listed range",
  "127.0.0.4": "XBL — exploited machine",
  "127.0.0.9": "SBL DROP — do not use this address",
  "127.0.0.10": "PBL — ISP-declared non-MTA space",
  "127.0.0.11": "PBL — Spamhaus-declared non-MTA space",
};

// 127.255.255.x is Spamhaus signalling a REFUSED QUERY, never a listing.
// Public resolvers are blocked by Spamhaus, so a naive read of this answer
// produces a false positive that would cost a good IP.
const SPAMHAUS_ERRORS: Record<string, string> = {
  "127.255.255.252": "query malformed",
  "127.255.255.253": "query via unsupported method",
  "127.255.255.254": "query via a public/open resolver — Spamhaus refuses these",
  "127.255.255.255": "query volume exceeded",
};

const DELIST_URL: Record<string, string> = {
  "zen.spamhaus.org": "https://check.spamhaus.org/",
  "b.barracudacentral.org": "https://www.barracudacentral.org/rbl/removal-request",
  "bl.spamcop.net": "https://www.spamcop.net/bl.shtml",
  "dnsbl.sorbs.net": "https://www.sorbs.net/",
  "dnsbl-1.uceprotect.net": "https://www.uceprotect.net/en/rblcheck.php",
};

// A representative spread of receiving MXs. Egress to :25 must work for all of
// them; providers commonly block the port silently on a new account (E03-003).
const EGRESS_TARGETS = [
  { host: "gmail-smtp-in.l.google.com", label: "Google" },
  { host: "outlook-com.olc.protection.outlook.com", label: "Microsoft" },
  { host: "mta7.am0.yahoodns.net", label: "Yahoo" },
];

type Severity = "critical" | "high" | "medium" | "low" | "inconclusive";

interface Listing {
  zone: string;
  label: string;
  severity: Severity;
  answers: string[];
  reason: string | null;
  delistUrl: string | null;
}

interface Verdict {
  address: string | null;
  checkedAt: string;
  ptr: { expected: string | null; actual: string[]; forwardConfirmed: boolean } | null;
  listings: Listing[];
  clean: boolean;
  egress25: Array<{ target: string; label: string; ok: boolean; banner: string | null; error: string | null }>;
  hardFailures: string[];
  recommendation: "accept" | "release" | "investigate";
}

function reverseIpv4(ip: string): string {
  return ip.split(".").reverse().join(".");
}

function isIpv4(s: string): boolean {
  return net.isIPv4(s);
}

/** A DNSBL "not listed" is NXDOMAIN. Anything else is an answer worth reading. */
async function checkZone(ip: string, z: (typeof IP_ZONES)[number], resolver: Resolver): Promise<Listing | null> {
  const query = `${reverseIpv4(ip)}.${z.zone}`;
  try {
    const answers = await resolver.resolve4(query);
    if (answers.length === 0) return null;

    const isSpamhaus = z.zone.endsWith("spamhaus.org");

    // Refused query — report it as inconclusive, never as a listing.
    if (isSpamhaus) {
      const refusal = answers.map((a) => SPAMHAUS_ERRORS[a]).find(Boolean);
      if (refusal) {
        return {
          zone: z.zone,
          label: z.label,
          severity: "inconclusive",
          answers,
          reason: `${refusal} — drop --public-resolver, or use a Spamhaus DQS key`,
          delistUrl: null,
        };
      }
    }

    // Reason codes are Spamhaus-specific; other zones reuse 127.0.0.2 with
    // entirely different meanings, so do not mislabel them.
    const reason = isSpamhaus ? (answers.map((a) => SPAMHAUS_CODES[a]).find(Boolean) ?? null) : null;
    return {
      zone: z.zone,
      label: z.label,
      severity: z.severity,
      answers,
      reason,
      delistUrl: DELIST_URL[z.zone] ?? null,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return null; // not listed
    // A timeout is not an all-clear. Say so rather than implying a pass.
    return {
      zone: z.zone,
      label: z.label,
      severity: "inconclusive",
      answers: [],
      reason: `lookup failed (${code ?? "unknown"}) — NOT a clean result, re-run`,
      delistUrl: null,
    };
  }
}

async function checkPtr(ip: string, expected: string | null, resolver: Resolver) {
  let actual: string[] = [];
  try {
    actual = await resolver.reverse(ip);
  } catch {
    actual = [];
  }
  // Forward-confirmed reverse DNS: the PTR name must resolve back to this IP.
  let forwardConfirmed = false;
  for (const name of actual) {
    try {
      const forward = await resolver.resolve4(name);
      if (forward.includes(ip)) forwardConfirmed = true;
    } catch {
      /* keep going */
    }
  }
  return { expected, actual, forwardConfirmed };
}

function probe25(host: string, timeoutMs = 8000): Promise<{ ok: boolean; banner: string | null; error: string | null }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = "";
    let settled = false;
    const done = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, banner: banner.trim() || null, error });
    };
    socket.setTimeout(timeoutMs);
    socket.on("data", (buf) => {
      banner += buf.toString("utf8");
      if (banner.includes("\n")) done(banner.trimStart().startsWith("220"), null);
    });
    socket.on("timeout", () => done(false, "timeout — port 25 egress is likely blocked"));
    socket.on("error", (e) => done(false, e.message));
    socket.connect(25, host);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const egressOnly = argv.includes("--egress-only");
  const ptrIdx = argv.indexOf("--ptr");
  const expectedPtr = ptrIdx >= 0 ? (argv[ptrIdx + 1] ?? null) : null;
  const address = argv.find((a) => isIpv4(a)) ?? null;

  if (!address && !egressOnly) {
    console.error("usage: tsx scripts/ip-diligence.mts <ipv4> [--ptr <host>] [--json] [--public-resolver]");
    console.error("       tsx scripts/ip-diligence.mts --egress-only     (run on the node itself)");
    process.exit(2);
  }

  // Spamhaus REFUSES queries from public resolvers, so the default here is the
  // host's own resolver. Pass --public-resolver to force 1.1.1.1/9.9.9.9 when
  // the local resolver is untrusted; expect Spamhaus to come back inconclusive.
  // Production polling uses a dedicated resolver plus a Spamhaus DQS key (E09-031).
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  if (argv.includes("--public-resolver")) resolver.setServers(["1.1.1.1", "9.9.9.9"]);

  const verdict: Verdict = {
    address,
    checkedAt: new Date().toISOString(),
    ptr: null,
    listings: [],
    clean: true,
    egress25: [],
    hardFailures: [],
    recommendation: "accept",
  };

  if (address) {
    verdict.ptr = await checkPtr(address, expectedPtr, resolver);
    const results = await Promise.all(IP_ZONES.map((z) => checkZone(address, z, resolver)));
    verdict.listings = results.filter((r): r is Listing => r !== null);
  }

  verdict.egress25 = await Promise.all(
    EGRESS_TARGETS.map(async (t) => ({ target: t.host, label: t.label, ...(await probe25(t.host)) })),
  );

  // ── Hard failures. Any one of these means release the address.
  const realListings = verdict.listings.filter((l) => l.severity !== "inconclusive");
  const inconclusive = verdict.listings.filter((l) => l.severity === "inconclusive");
  const critical = realListings.filter((l) => l.severity === "critical" && l.answers.length > 0);
  if (critical.length > 0) {
    verdict.hardFailures.push(`listed on ${critical.map((l) => l.label).join(", ")}`);
  }
  if (verdict.egress25.every((e) => !e.ok)) {
    verdict.hardFailures.push("no port 25 egress to any tested MX");
  }
  if (address && verdict.ptr && verdict.ptr.actual.length === 0) {
    verdict.hardFailures.push("no PTR record — confirm the provider grants rDNS control");
  }
  if (address && verdict.ptr && verdict.ptr.actual.length > 0 && !verdict.ptr.forwardConfirmed) {
    verdict.hardFailures.push("PTR does not forward-confirm (invariant I2)");
  }

  verdict.clean = verdict.hardFailures.length === 0 && realListings.length === 0;
  verdict.recommendation = verdict.hardFailures.length > 0
    ? "release"
    : realListings.length > 0 || inconclusive.length > 0
      ? "investigate"
      : "accept";

  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.recommendation === "release" ? 1 : 0);
  }

  // ── Human report
  const line = "─".repeat(64);
  console.log(`\n  IP DILIGENCE  ${address ?? "(egress only)"}`);
  console.log(`  ${verdict.checkedAt}`);
  console.log(line);

  if (verdict.ptr) {
    const p = verdict.ptr;
    console.log("\n  REVERSE DNS");
    console.log(`    PTR             ${p.actual.length ? p.actual.join(", ") : "— none —"}`);
    if (p.expected) console.log(`    expected        ${p.expected}`);
    console.log(`    forward-confirm ${p.forwardConfirmed ? "yes" : "NO"}`);
  }

  console.log("\n  BLOCKLISTS");
  if (verdict.listings.length === 0) {
    console.log(`    clean across ${IP_ZONES.length} zones`);
  } else {
    for (const l of verdict.listings) {
      console.log(`    [${l.severity.toUpperCase()}] ${l.label}  ${l.answers.join(" ") || "(lookup issue)"}`);
      if (l.reason) console.log(`             ${l.reason}`);
      if (l.delistUrl) console.log(`             delist: ${l.delistUrl}`);
    }
  }

  console.log("\n  PORT 25 EGRESS");
  for (const e of verdict.egress25) {
    const mark = e.ok ? "ok  " : "FAIL";
    console.log(`    ${mark}  ${e.label.padEnd(10)} ${e.banner ?? e.error ?? ""}`);
  }

  console.log(`\n${line}`);
  if (verdict.hardFailures.length > 0) {
    console.log("\n  RECOMMENDATION: RELEASE THIS ADDRESS\n");
    for (const f of verdict.hardFailures) console.log(`    · ${f}`);
    console.log("\n  A dirty IP is worse than no IP. Release and retry — cheap now,");
    console.log("  catastrophic after the fleet is built on it.\n");
    process.exit(1);
  }
  if (realListings.length > 0) {
    console.log("\n  RECOMMENDATION: INVESTIGATE before committing\n");
    process.exit(0);
  }
  if (inconclusive.length > 0) {
    console.log("\n  RECOMMENDATION: INVESTIGATE — no listings found, but");
    console.log(`  ${inconclusive.length} zone(s) could not be checked conclusively:\n`);
    for (const l of inconclusive) console.log(`    · ${l.label}: ${l.reason}`);
    console.log("\n  An unchecked zone is not a clean zone. Re-run before committing.\n");
    process.exit(0);
  }
  console.log("\n  RECOMMENDATION: ACCEPT — clean history, egress open, rDNS controllable\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
