import { z } from "zod";

const DEV_AUTH_SECRET = "dev-insecure-secret-change-me";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().default("postgresql://ems:ems@localhost:5432/ems"),
  // Connection string for the queue / cache store.
  QUEUE_URL: z.string().default("redis://localhost:6379"),
  // Region label the mail relay sends from (internal; not a cloud-vendor region).
  MAIL_RELAY_REGION: z.string().default("primary"),
  // Optional named configuration set applied to relay sends (event tracking).
  MAIL_RELAY_CONFIG_SET: z.string().optional(),
  // Bounce / return-path domain for VERP. When set, outbound MTA sends use an
  // envelope sender of `bounce+<emailId>@<this>` so DSNs route back to us
  // correlated to the email id. OPT-IN (no default) and fail-safe: leave it
  // UNSET until the inbound path is live — the domain's MX must point at our MTA
  // (with the Postfix transport → feedback-ingest wired) and it needs an SPF
  // record. Enabling it before then would send bounces to a black hole instead
  // of the customer's own domain. Enable as the final step of the feedback-loop
  // runbook (infra/sidecars/ems-feedback.md), e.g. "bounce.electronicmailservices.com".
  MAIL_BOUNCE_DOMAIN: z.string().optional(),
  API_URL: z.string().default("http://localhost:8787"),
  APP_URL: z.string().default("http://localhost:3000"),
  // Defense-in-depth Host allowlist (host-header-injection guard). Optional,
  // comma-separated EXTRA hostnames allowed in addition to API_URL/APP_URL's
  // hosts. Only enforced when NODE_ENV=production (/health, /livez, /readyz and
  // /.well-known stay exempt for platform health checks + MTA-STS probes). Set this only if the
  // public Host legitimately differs from API_URL — e.g. an apex+www pair.
  ALLOWED_HOSTS: z.string().optional(),
  // Session JWT signing key. A weak dev default keeps local/test boots working,
  // but production is fail-closed (see guard below) so forged sessions are
  // impossible if the real secret is missing.
  AUTH_SECRET: z.string().default(DEV_AUTH_SECRET),
  // AES-256-GCM key (64 hex chars = 32 bytes) for encrypting DKIM private keys
  // at rest (NFR-004). No default — encrypt/decrypt fails closed if unset.
  DKIM_ENC_KEY: z.string().optional(),
  // Platform managed-DNS token (Zone:Read + DNS:Edit) for one-click record
  // publishing on zones ems controls. Optional — manual copy/paste always
  // works; per-project BYO tokens can override at the call site.
  DNS_API_TOKEN: z.string().optional(),
  // The email auto-promoted to God Mode superadmin on first login. The super
  // admin then adds other admins (with scopes) from the panel.
  GOD_SUPERADMIN_EMAIL: z.string().optional(),
  // Shared secret the MTA presents when POSTing bounce/complaint/delivery
  // feedback to /mta/feedback. No default — the endpoint is closed unless set.
  MTA_FEEDBACK_SECRET: z.string().optional(),
  // Platform-owned domains on which anyone can claim an inbox with NO DNS of
  // their own (POST /inboxes). Comma-separated; the FIRST is the default when
  // the caller doesn't name one. Deliberately plural: the same machinery serves
  // agent inboxes (agents.…) and the "just give me a working address" human /
  // company mode (inbox.…) — only the branding differs. See
  // planning/INBOX_MODES.md. Sending works as soon as the platform's SPF/DKIM
  // cover the domain; RECEIVING additionally requires its MX to point at the
  // mailbox MTA (/mta/mailbox-domains picks it up once an inbox exists there).
  SHARED_INBOX_DOMAINS: z.string().default("agents.electronicmailservices.com,inbox.electronicmailservices.com"),
  // Kill switch for the pooled shared-inbox domains. "off" refuses customer
  // create/send on those domains (platform `internal` mail still allowed).
  // Reputation on a shared domain is everyone-or-no-one — flip this before
  // a tenant can burn `agents.electronicmailservices.com`.
  SHARED_INBOX_SENDING: z.enum(["on", "off"]).default("on"),
  // Better Stack heartbeat URLs (optional). Workers / maillog-bridge GET these
  // on a timer so a stalled pipeline pages even when the API still answers.
  // Unset = no-op (local/dev). See infra/observability.md.
  BETTERSTACK_HEARTBEAT_WORKERS: z.string().optional(),
  BETTERSTACK_HEARTBEAT_MAILLOG: z.string().optional(),
  // TEST/DEV ONLY: allow webhook endpoints on localhost / private IPs (the SSRF
  // guard otherwise blocks them). Lets the SC-001 e2e point at a local receiver.
  // NEVER set this in production.
  WEBHOOK_ALLOW_PRIVATE: z.string().optional(),
  // Connected-account sending (send from a client's own Gmail / Outlook). OAuth
  // app credentials for the "Connect mailbox" flow — optional; connected
  // sending is unavailable until set.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  MS_OAUTH_CLIENT_ID: z.string().optional(),
  MS_OAUTH_CLIENT_SECRET: z.string().optional(),
  MS_OAUTH_TENANT: z.string().default("common"),
  MS_OAUTH_REDIRECT_URI: z.string().optional(),
  // Stripe Connect billing (agencies charge their clients). All optional — the
  // BillingProvider fails closed to a no-op when STRIPE_SECRET_KEY is unset, so
  // the product runs fine without payments configured. Set the secret key to
  // enable the Connect flow; set the webhook secret to verify Stripe callbacks.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // ---- EMS cold-outreach variables (E01-044 example → E01-045 schema) ----
  // Observation store. Postgres holds decisions; ClickHouse holds what happened.
  // Local-stack defaults match infra/docker-compose.yml; production overrides all four.
  CLICKHOUSE_URL: z.string().default("http://127.0.0.1:8123"),
  CLICKHOUSE_DB: z.string().default("ems"),
  CLICKHOUSE_USER: z.string().default("ems"),
  CLICKHOUSE_PASSWORD: z.string().default("ems"),
  // Local SMTP sink. Dev never sends real mail unless this is explicitly unset
  // AND EMS_ALLOW_REAL_SEND=1.
  SMTP_URL: z.string().default("smtp://127.0.0.1:1025"),
  EMS_ALLOW_REAL_SEND: z.enum(["0", "1"]).default("0"),
  // Inference — the single sanctioned AI dependency (planning/AI.md).
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  AI_MONTHLY_CEILING_USD: z.string().default("250"),
  // Fleet control plane. The agent signs every report; the API refuses unsigned.
  EMS_AGENT_SIGNING_KEY: z.string().optional(),
  EMS_NODE_ALLOWLIST: z.string().optional(),
  // Registrar + DNS seams (packages/registrar). CLOUDFLARE_DNS_TOKEN is the
  // current name; DNS_API_TOKEN (and its legacy CLOUDFLARE_API_TOKEN) stay as aliases.
  CLOUDFLARE_DNS_TOKEN: z.string().optional(),
  REGISTRAR_PROVIDER: z.string().default("cloudflare"),
  REGISTRAR_API_KEY: z.string().optional(),
  // Dedicated domain receiving every sending domain's DMARC rua/ruf + TLS-RPT.
  AGGREGATE_REPORT_DOMAIN: z.string().optional(),
  // Verification runs from its own IP that never sends campaigns (E12-017).
  VERIFY_NODE_URL: z.string().optional(),
  // Seed accounts for placement probing. Read only by apps/seedbox; this key
  // must not exist on any host that also sends campaigns (E21-094).
  SEEDBOX_CREDENTIAL_KEY: z.string().optional(),
  // Handoff target: the moment a lead opts in, they leave EMS.
  HANDOFF_TARGET_URL: z.string().optional(),
  HANDOFF_API_KEY: z.string().optional(),
  // Object storage (S3-compatible) for raw MIME, DMARC XML, exports, backups.
  STORAGE_ACCOUNT_ID: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default("ems-assets"),
  // Analytics event store (Phase 1d). See infra/observability.md.
  ANALYTICS_TOKEN: z.string().optional(),
  ANALYTICS_URL: z.string().optional(),
});

// Backward-compatible env aliases: the live box may still set the old variable
// names. Map them onto the new names before parsing so deployments never break;
// the new names always win when both are present.
const rawEnv = {
  ...process.env,
  QUEUE_URL: process.env.QUEUE_URL ?? process.env.REDIS_URL,
  MAIL_RELAY_REGION: process.env.MAIL_RELAY_REGION ?? process.env.AWS_REGION,
  MAIL_RELAY_CONFIG_SET:
    process.env.MAIL_RELAY_CONFIG_SET ?? process.env.SES_CONFIGURATION_SET,
  DNS_API_TOKEN:
    process.env.DNS_API_TOKEN ?? process.env.CLOUDFLARE_DNS_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN,
  // Singular predecessor of SHARED_INBOX_DOMAINS (A1 shipped with one domain).
  SHARED_INBOX_DOMAINS:
    process.env.SHARED_INBOX_DOMAINS ?? process.env.AGENT_INBOX_DOMAIN,
};

const parsed = schema.parse(rawEnv);

/**
 * Fail fast with the variable NAME in the error. Subsystem boot code calls
 * this for secrets that are optional in the schema but required for that
 * subsystem (e.g. DKIM_ENC_KEY before decrypting, MTA_FEEDBACK_SECRET before
 * opening the feedback route).
 */
export function requireEnv(name: keyof Env): string {
  const value = parsed[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value);
}

// Fail fast at boot in production: connection strings must be explicitly set
// (localhost dev defaults are refused) and the session secret must be real.
// Every check names the variable. Dev/test keep working on defaults.
if (parsed.NODE_ENV === "production") {
  const explicitlySet = (name: string): boolean =>
    process.env[name] !== undefined && process.env[name] !== "";
  const missing = ["DATABASE_URL", "CLICKHOUSE_URL"].filter((v) => !explicitlySet(v));
  if (!explicitlySet("QUEUE_URL") && !explicitlySet("REDIS_URL")) missing.push("QUEUE_URL (or REDIS_URL)");
  for (const name of missing) {
    throw new Error(`Missing required environment variable in production: ${name}`);
  }
  if (!process.env.AUTH_SECRET || parsed.AUTH_SECRET === DEV_AUTH_SECRET) {
    throw new Error(
      "AUTH_SECRET must be set in production — the insecure dev default is refused.",
    );
  }
  if (parsed.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters in production.");
  }
}

export const env = parsed;
export type Env = z.infer<typeof schema>;
