import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { Hono } from "hono";
import { ApiError, env, connection, sendQueue, classifyReadiness, timedProbe, liveBody, securityHeaders } from "@ems/core";
import { prisma } from "@ems/db";
import { emails } from "./routes/emails.js";
import { verify } from "./routes/verify.js";
import { admin } from "./routes/admin.js";
import { stats } from "./routes/stats.js";
import { domains } from "./routes/domains.js";
import { inboxes } from "./routes/inboxes.js";
import { apiKeys } from "./routes/api-keys.js";
import { mta } from "./routes/mta.js";
import { auth } from "./routes/auth.js";
import { dash } from "./routes/app.js";
import { connect } from "./routes/connect.js";
import { god } from "./routes/god.js";
import { unsubscribe } from "./routes/unsubscribe.js";
import { track } from "./routes/track.js";
import { billingHooks } from "./routes/billing.js";

const app = new Hono();

// ---- Host allowlist (defense-in-depth against Host-header injection) ----
// OPT-IN and FAIL-OPEN: this only enforces when ALLOWED_HOSTS is explicitly set on
// the box. The real host-header fix is that outbound links are built from the
// trusted API_URL origin (auth/team/billing routes); this is just a second layer.
// It must NEVER be able to brick the site by default — API_URL/APP_URL default to
// localhost, so enforcing against them in prod (as an earlier version did) 400s
// every real request. So: enforcement requires ALLOWED_HOSTS (e.g.
// "electronicmailservices.com,api.electronicmailservices.com"); when set, API_URL/APP_URL hosts are folded
// in. /health and /.well-known/* always stay open (health checks + MTA-STS probes).
function hostnameOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}
const ALLOWED_HOSTNAMES = new Set(
  [env.API_URL, env.APP_URL, ...(env.ALLOWED_HOSTS?.split(",") ?? [])]
    .map(hostnameOf)
    .filter((h): h is string => Boolean(h)),
);
app.use("*", async (c, next) => {
  await next();
  const html = (c.res.headers.get("content-type") ?? "").includes("text/html");
  for (const [k, v] of Object.entries(
    securityHeaders({ production: env.NODE_ENV === "production", html }),
  )) {
    if (!c.res.headers.has(k)) c.header(k, v);
  }
});

app.use("*", async (c, next) => {
  // Fail open unless explicitly opted in: dev, or ALLOWED_HOSTS unset → no gating.
  if (env.NODE_ENV !== "production" || !env.ALLOWED_HOSTS) return next();
  const path = c.req.path;
  if (
    path === "/health" ||
    path === "/livez" ||
    path === "/readyz" ||
    path.startsWith("/.well-known/")
  ) {
    return next();
  }
  const hostname = (c.req.header("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    throw new ApiError(400, "bad_host", "Unrecognized Host header.");
  }
  return next();
});

function load(rel: string): string | null {
  try {
    return readFileSync(new URL(rel, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

// ---- Dashboard + God Mode shells (static, served from apps/api/public) ----
const siteCss = load("../public/site.css");
if (siteCss) {
  app.get("/assets/site.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(siteCss);
  });
}

const favicon = load("../public/favicon.svg");
if (favicon) {
  app.get("/favicon.svg", (c) => {
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(favicon);
  });
  // Browsers also probe /favicon.ico — point it at the SVG.
  app.get("/favicon.ico", (c) => {
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    return c.body(favicon);
  });
}

// Marketing HTML used to live here. The public site is Next on electronicmailservices.com;
// serving a second copy from the API was how stale 5k/SSO/dedicated-IP claims
// leaked after the honesty pass. Keep only the app shells.
const PAGES: Record<string, string> = {
  "/dashboard": "../public/dashboard.html",
  "/god": "../public/god.html",
};
for (const [route, rel] of Object.entries(PAGES)) {
  const html = load(rel);
  if (html)
    app.get(route, (c) => {
      c.header("Cache-Control", "no-store, must-revalidate");
      return c.html(html);
    });
}

const MARKETING_ORIGIN = "https://electronicmailservices.com";

// The API root is an API root: a tiny JSON service descriptor, no assets.
// It must NOT redirect to the marketing site — hostssh's blue-green asset gate
// follows the redirect, reads the Next page's HTML, then resolves its
// /_next/* assets against THIS container (which has no such route) and fails
// the deploy on 5 phantom 404s. Marketing sub-paths below still redirect.
app.get("/", (c) =>
  c.json({
    service: "ems-api",
    docs: `${MARKETING_ORIGIN}/docs/dev`,
    website: MARKETING_ORIGIN,
    health: { live: "/livez", ready: "/readyz" },
  }),
);

for (const path of [
  "/features",
  "/pricing",
  "/deliverability",
  "/docs",
  "/docs/user",
  "/docs/dev",
]) {
  app.get(path, (c) => c.redirect(`${MARKETING_ORIGIN}${path}`, 302));
}

// ---- API ----
// Liveness: the process is up. Always 200 if we can answer — never put Postgres
// or Redis here (a blip would become a container kill loop). /health is the
// legacy alias so existing hostssh / docker checks keep working.
const live = () => liveBody("ems-api");
app.get("/livez", (c) => c.json(live()));
app.get("/health", (c) => c.json(live()));

// Readiness: can we serve? 503 when Postgres or Redis is unreachable. Queue
// backup is "degraded" (still 200) so Better Stack can warn without paging "down".
app.get("/readyz", async (c) => {
  const [postgres, redis, counts] = await Promise.all([
    timedProbe(() => prisma.$queryRaw`SELECT 1`),
    timedProbe(() => connection.ping()),
    sendQueue
      .getJobCounts("waiting", "failed")
      .catch(() => ({ waiting: 0, failed: 0 })),
  ]);
  const { body, http } = classifyReadiness({
    postgres,
    redis,
    sendQueue: { waiting: counts.waiting ?? 0, failed: counts.failed ?? 0 },
  });
  return c.json(body, http);
});

// MTA-STS policy (RFC 8461) — served at https://mta-sts.electronicmailservices.com/.well-known/
// mta-sts.txt once that subdomain is routed here. "testing" mode reports downgrade
// failures without blocking delivery; flip to "enforce" after monitoring TLS-RPT.
app.get("/.well-known/mta-sts.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body("version: STSv1\nmode: testing\nmx: mail.electronicmailservices.com\nmax_age: 604800\n");
});
app.route("/emails", emails); // drop-in surface (API-key auth)
app.route("/verify", verify); // email-list verification (API-key auth)
app.route("/admin", admin); // tenant provisioning (BOOTSTRAP_SECRET)
app.route("/stats", stats); // overview counts (API-key auth)
app.route("/domains", domains); // domain CRUD + mail-health telemetry (API-key auth)
app.route("/inboxes", inboxes); // agent inboxes: CRUD, messages, threads, send/reply (API-key auth)
app.route("/api-keys", apiKeys); // API-key management (full-access API-key auth)
app.route("/mta", mta); // inbound delivery feedback from our MTA (shared-secret)

// Confirm a mailbox forward destination. GET shows a confirm form; POST
// consumes the token so mail-client prefetch cannot auto-verify.
function htmlEsc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch
  ));
}
function forwardPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title></head><body style="font-family:system-ui;padding:40px;max-width:40rem">${body}</body></html>`;
}
app.get("/forwards/verify", async (c) => {
  const token = (c.req.query("token") ?? "").trim();
  if (!token) return c.text("Missing token.", 400);
  const row = await prisma.mailForward.findFirst({ where: { verifyToken: token } });
  if (!row) return c.text("This forwarding link is invalid or already used.", 404);
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(
    forwardPage(
      "Confirm forwarding",
      `<h1>Confirm forwarding</h1><p>Copies of inbound mail will be sent to <b>${htmlEsc(row.destination)}</b>.</p>
       <form method="post" action="/forwards/verify"><input type="hidden" name="token" value="${htmlEsc(token)}"><button type="submit">Confirm</button></form>`,
    ),
  );
});
app.post("/forwards/verify", async (c) => {
  const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const token = String(body.token ?? c.req.query("token") ?? "").trim();
  if (!token) return c.text("Missing token.", 400);
  const row = await prisma.mailForward.findFirst({ where: { verifyToken: token } });
  if (!row) return c.text("This forwarding link is invalid or already used.", 404);
  await prisma.mailForward.update({
    where: { id: row.id },
    data: { verifiedAt: new Date(), verifyToken: null },
  });
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(
    forwardPage(
      "Forwarding confirmed",
      `<h1>Forwarding confirmed</h1><p>Copies of inbound mail will now be sent to <b>${htmlEsc(row.destination)}</b>.</p>`,
    ),
  );
});
app.route("/auth", auth); // dashboard session auth (signup/login/logout/me)
app.route("/app", dash); // dashboard API (session auth): stats, logs, send, keys
app.route("/connect", connect); // connect a Gmail/Outlook mailbox (OAuth, session)
app.route("/god", god); // God Mode control plane (platform-admin only)
app.route("/u", unsubscribe); // one-click unsubscribe target (List-Unsubscribe header)
app.route("/t", track); // open-pixel + click-redirect tracking (signed tokens, public)
app.route("/billing", billingHooks); // Stripe webhook (signature-verified, public)

app.onError((err, c) => {
  if (err instanceof ApiError) {
    c.status(err.statusCode as 400);
    return c.json(err.toJSON());
  }
  console.error(err);
  c.status(500);
  return c.json({
    statusCode: 500,
    name: "internal_error",
    message: "Internal server error.",
  });
});

// Apply pending DB migrations before serving (idempotent + advisory-locked) so a
// production deploy is self-sufficient regardless of the platform's start
// command. Fails closed: a migration error aborts boot, so the platform keeps
// the previous healthy container rather than serving a schema-mismatched API.
if (process.env.NODE_ENV === "production" && process.env.SKIP_BOOT_MIGRATE !== "true") {
  try {
    console.log("[boot] applying database migrations…");
    execSync("pnpm --filter @ems/db migrate:deploy", { stdio: "inherit" });
  } catch (err) {
    console.error("[boot] migration failed — refusing to start.", err);
    process.exit(1);
  }
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`ems api listening on :${port}`);
