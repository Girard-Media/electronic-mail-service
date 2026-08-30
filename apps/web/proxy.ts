import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { classifyHost, RESERVED_SUBDOMAINS } from "./lib/subdomains";

// Next 16 proxy (the renamed middleware). ROUTING ONLY — no DB, no auth decisions.
// It maps `tenant.electronicmailservices.com/<path>` → `/s/<tenant>/<path>` and a verified custom
// domain `mail.acme.com/<path>` → `/domain/<host>/<path>`, so one app serves the root
// marketing/blog site AND every white-label surface. Since proxy can't reach the DB, a
// custom host is rewritten optimistically; the /domain route resolves it (404 if
// unknown). Tenant isolation + auth are enforced in the data layer (lib/tenant.ts) —
// NEVER here. Node.js runtime is the v16 default; we must NOT set `runtime` (it throws).
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "electronicmailservices.com";

export function proxy(request: NextRequest) {
  const cls = classifyHost(request.headers.get("host"), ROOT_DOMAIN);

  let target: string | null = null;
  if (cls.kind === "tenant" && !RESERVED_SUBDOMAINS.has(cls.subdomain)) {
    target = `/s/${cls.subdomain}`;
  } else if (cls.kind === "custom") {
    target = `/domain/${cls.host}`;
  }
  // Apex/www/reserved/localhost → serve the root app unchanged.
  if (!target) return NextResponse.next();

  const url = request.nextUrl.clone();
  // Guard against a double rewrite (an internal subrequest already under the surface).
  if (
    url.pathname === "/s" ||
    url.pathname.startsWith("/s/") ||
    url.pathname === "/domain" ||
    url.pathname.startsWith("/domain/")
  ) {
    return NextResponse.next();
  }
  url.pathname = `${target}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Run on page navigations only — exclude API, Next internals, and metadata/asset
  // files so a tenant host still loads CSS/JS/og-images and serves robots/sitemap from
  // the root. (Per the docs, _next/data still runs through proxy regardless — intended.)
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|favicon.svg|robots.txt|sitemap.xml|assets/).*)",
  ],
};
