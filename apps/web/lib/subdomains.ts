// Pure subdomain helpers — NO imports of @ems/core (which eagerly validates env)
// or Prisma, so proxy.ts can import this and stay lightweight (the docs warn proxy
// should not rely on heavy shared modules). Single source of truth for what counts as a
// tenant subdomain vs a reserved/system label.

// Labels that must NEVER be handed to a tenant: platform surfaces, mail/DNS records,
// and anything that would collide with a marketing route or look like a system host.
// proxy.ts passes these THROUGH to the root app (they are not tenant rewrites); the
// (future) subdomain-assignment endpoint must reject them too.
export const RESERVED_SUBDOMAINS = new Set<string>([
  // platform + app surfaces
  "www", "app", "api", "admin", "dashboard", "account", "accounts", "auth", "login",
  "signup", "register", "billing", "god", "internal", "system", "sys", "root", "status",
  "go", "link", "links", "u", "t", "track", "click", "connect",
  // marketing routes (avoid apex-path/subdomain confusion)
  "blog", "docs", "doc", "features", "pricing", "deliverability", "about", "legal",
  "privacy", "terms", "tos", "gdpr", "contact", "support", "help", "sales",
  // mail / DNS / deliverability
  "mail", "email", "mailer", "smtp", "imap", "pop", "pop3", "mx", "webmail", "inbox",
  "bounce", "mta", "mta-sts", "dmarc", "_dmarc", "spf", "dkim", "ns", "ns1", "ns2",
  "postmaster", "hostmaster", "webmaster", "abuse", "noreply", "no-reply", "info",
  // infra / environments
  "cdn", "assets", "static", "media", "img", "images", "files", "download", "downloads",
  "dev", "staging", "stage", "test", "demo", "preview", "sandbox", "ci", "git", "vpn",
  "ftp", "ssh", "metrics", "grafana", "prometheus", "kibana", "security", "vault",
  // common reservations
  "my", "me", "us", "new", "edit", "settings", "profile", "home", "public",
]);

// DNS label rules: 1–63 chars, a–z 0–9 and hyphen, no leading/trailing hyphen.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSubdomain(input: string): boolean {
  const sub = input.trim().toLowerCase();
  if (!LABEL_RE.test(sub)) return false;
  if (RESERVED_SUBDOMAINS.has(sub)) return false;
  // Reject xn-- (punycode) to avoid homograph/IDN confusion on the wildcard.
  if (sub.startsWith("xn--")) return false;
  return true;
}

// Extract the tenant subdomain from a Host header, given the platform root domain.
// Returns null for the apex, www, the root itself, or any host not under the root
// (custom domains are Phase 4). Handles dev hosts of the form `tenant.localhost[:port]`.
export function extractSubdomain(host: string | null, rootDomain: string): string | null {
  if (!host) return null;
  // Strip port and a single trailing dot (FQDN form `acme.electronicmailservices.com.`) so
  // fully-qualified hosts normalize to the same label as their bare form.
  const hostname = (host.split(":")[0] ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return null;
  const root = rootDomain.trim().toLowerCase();

  // Local dev: `tenant.localhost`
  if (hostname === "localhost") return null;
  if (hostname.endsWith(".localhost")) {
    const label = hostname.slice(0, -".localhost".length);
    return label.split(".")[0] || null;
  }

  // Apex and www are the root marketing site, not a tenant.
  if (hostname === root || hostname === `www.${root}`) return null;

  if (hostname.endsWith(`.${root}`)) {
    const prefix = hostname.slice(0, hostname.length - root.length - 1);
    // For a.b.electronicmailservices.com take the left-most label as the tenant.
    return prefix.split(".")[0] || null;
  }

  return null; // not under the root domain → custom domain (Phase 4) or unrelated
}

// Is `h` a plausible registrable hostname (for a tenant custom domain)? Rejects path
// traversal, ports, schemes, and malformed input so the value is safe as a route
// segment + DB key.
export function isValidHostname(h: string): boolean {
  const host = h.trim().toLowerCase();
  if (host.length < 4 || host.length > 253) return false;
  if (!host.includes(".") || host.includes("..")) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (/^[-.]|[-.]$/.test(host)) return false;
  return true;
}

// Classify a Host header into where it should route. proxy.ts can't touch the DB, so a
// `custom` host is optimistically rewritten to /domain/<host>; the route resolves it
// against Organization.customDomain (404 if unknown). `tenant` is a label under the
// root domain; `root` is the apex/www/localhost (served by the marketing+blog app).
export type HostClass =
  | { kind: "root" }
  | { kind: "tenant"; subdomain: string }
  | { kind: "custom"; host: string };

export function classifyHost(host: string | null, rootDomain: string): HostClass {
  const sub = extractSubdomain(host, rootDomain);
  if (sub) return { kind: "tenant", subdomain: sub };

  // extractSubdomain returned null → apex/www/localhost (root) OR a non-root host.
  if (!host) return { kind: "root" };
  const hostname = (host.split(":")[0] ?? "").trim().toLowerCase().replace(/\.$/, "");
  const root = rootDomain.trim().toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === root ||
    hostname === `www.${root}` ||
    hostname.endsWith(`.${root}`)
  ) {
    return { kind: "root" };
  }
  // A different registrable domain → tenant custom-domain candidate.
  return isValidHostname(hostname) ? { kind: "custom", host: hostname } : { kind: "root" };
}
