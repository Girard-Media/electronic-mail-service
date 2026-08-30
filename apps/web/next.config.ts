import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "@ems/core/security-headers";

const HEADER_LIST = Object.entries(
  securityHeaders({
    production: process.env.NODE_ENV === "production",
    html: true,
  }),
).map(([key, value]) => ({ key, value }));

const nextConfig: NextConfig = {
  // Don't advertise the stack on every HTML response.
  poweredByHeader: false,
  // Slim, self-contained server bundle for the Coolify Docker deploy.
  output: "standalone",
  // Trace workspace packages from the MONOREPO ROOT into the standalone bundle,
  // otherwise @ems/core + @ems/db (and Prisma's engine) get left out.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Workspace packages ship as TS source (exports './src/index.ts', not built dist),
  // so Next must transpile them rather than treat them as prebuilt node_modules.
  transpilePackages: ["@ems/core", "@ems/db"],
  // Keep Prisma's query engine external (don't bundle it into the server output).
  serverExternalPackages: ["@prisma/client"],
  // Stable build id across replicas (set GIT_HASH in CI/Coolify); empty/unset → Next
  // default (still baked per-image, so replicas of one deploy stay consistent). Use ||
  // not ?? — an empty-string GIT_HASH must fall back, else BUILD_ID is "" and the
  // standalone server throws "Invariant: buildID is required" on boot.
  generateBuildId: async () => process.env.GIT_HASH || null,
  // Phase 0b: ISR cache → fleet Valkey so a revalidate on one container is seen by ALL
  // replicas (the default in-memory cache is per-instance → cross-replica staleness).
  // The handler fails open (no REDIS_URL or any Redis error → local regeneration), so
  // this is safe even on a single box or in dev. cacheMaxMemorySize:0 disables the
  // in-memory layer so Valkey is the single source of truth.
  cacheHandler: path.join(import.meta.dirname, "cache-handler.cjs"),
  cacheMaxMemorySize: 0,
  // The Next dashboard port (apps/web/app/dashboard) is still a deferred placeholder:
  // the live, working dashboard is the Hono app on app.electronicmailservices.com. The `um_session`
  // cookie is host-only on app/api.electronicmailservices.com (locked wildcard-isolation topology),
  // so it never reaches this apex origin — meaning the Next /dashboard can never
  // authenticate and dead-ends on its sign-in gate. Until the port completes, send every
  // marketing "Dashboard"/"Start free" CTA to the real dashboard. Temporary (307) so it
  // isn't cached once the port goes live and this redirect is removed.
  async headers() {
    return [{ source: "/:path*", headers: HEADER_LIST }];
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "https://app.electronicmailservices.com/dashboard",
        permanent: false,
      },
      {
        source: "/dashboard/:path*",
        destination: "https://app.electronicmailservices.com/dashboard/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
