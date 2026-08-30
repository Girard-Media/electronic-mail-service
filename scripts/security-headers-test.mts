// Crash-structure headers + launch-honesty wiring so the API, Next, and
// marketing surfaces cannot silently drop them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "../packages/core/src/security-headers.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

const json = securityHeaders({ production: false, html: false });
ok("json: nosniff", json["X-Content-Type-Options"] === "nosniff");
ok("json: deny framing", json["X-Frame-Options"] === "DENY");
ok("json: no HSTS in non-prod", json["Strict-Transport-Security"] === undefined);
ok("json CSP forbids frames", json["Content-Security-Policy"]?.includes("frame-ancestors 'none'") === true);

const htmlProd = securityHeaders({ production: true, html: true });
ok(
  "html prod: HSTS without preload",
  htmlProd["Strict-Transport-Security"] === "max-age=63072000; includeSubDomains",
);
ok(
  "html CSP forbids object + framing",
  htmlProd["Content-Security-Policy"]?.includes("object-src 'none'") === true &&
    htmlProd["Content-Security-Policy"]?.includes("frame-ancestors 'none'") === true,
);
ok(
  "html CSP does not allow Google/jsDelivr CDNs",
  !htmlProd["Content-Security-Policy"]?.includes("fonts.googleapis.com") &&
    !htmlProd["Content-Security-Policy"]?.includes("cdn.jsdelivr.net"),
);

const indexTs = src("apps/api/src/index.ts");
ok("API applies securityHeaders after next()", indexTs.includes("securityHeaders({ production:"));
ok("API does not skip existing headers", indexTs.includes("if (!c.res.headers.has(k))"));

const nextCfg = src("apps/web/next.config.ts");
ok("Next poweredByHeader is false", /poweredByHeader:\s*false/.test(nextCfg));
ok("Next headers() uses securityHeaders", nextCfg.includes("securityHeaders({"));
ok(
  "Next imports the headers module, not the core barrel (env parse is a boot side-effect)",
  nextCfg.includes('@ems/core/security-headers'),
);

ok("CI workflow exists", src(".github/workflows/ci.yml").includes("pnpm typecheck"));
ok("CI runs pnpm test", src(".github/workflows/ci.yml").includes("pnpm test"));

ok(
  "legal chrome is not legal advice",
  src("apps/web/components/LegalDoc.tsx").includes("not legal advice"),
);
ok(
  "privacy page exists",
  src("apps/web/app/(marketing)/privacy/page.tsx").includes("What we store") &&
    src("apps/web/app/(marketing)/privacy/page.tsx").includes("hello@electronicmailservices.com"),
);
ok(
  "security page uses aligned-not-certified wording",
  src("apps/web/app/(marketing)/security/page.tsx").includes("SOC 2-aligned") &&
    src("apps/web/app/(marketing)/security/page.tsx").includes("not SOC 2 certified"),
);
ok("footer links privacy + terms", src("apps/web/components/SiteFooter.tsx").includes('href="/privacy"') && src("apps/web/components/SiteFooter.tsx").includes('href="/terms"'));
ok(
  "tenant Sign in is the live Hono dashboard",
  src("apps/web/components/TenantHomeView.tsx").includes("https://app.electronicmailservices.com/dashboard"),
);
ok(
  "docs do not present npm install as live",
  src("apps/web/app/(marketing)/docs/dev/page.tsx").includes("not on npm yet"),
);

const appTs = src("apps/api/src/routes/app.ts");
ok(
  "tenant DNS never falls back to platform DNS_API_TOKEN",
  appTs.includes("Never fall back to the platform") &&
    !/return dnsToken\(own\)/.test(appTs),
);
ok(
  "dashboard keys default to sending_access",
  /permission:\s*"sending_access"/.test(appTs) ||
    appTs.includes('permission: z.enum(["full_access", "sending_access"]).default("sending_access")'),
);
ok(
  "catch-all refuses null domainId (no global updateMany)",
  appTs.includes("Catch-all is only available on custom-domain inboxes"),
);
ok(
  "email verify redirects to TRUSTED_ORIGIN, not request Host",
  src("apps/api/src/routes/auth.ts").includes("TRUSTED_ORIGIN}/dashboard?verified=1") &&
    !src("apps/api/src/routes/auth.ts").includes("const origin = new URL(c.req.url).origin"),
);

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nsecurity-headers-test: all passed");
