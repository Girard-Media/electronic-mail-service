import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { prisma, Prisma } from "@ems/db";
import {
  sendEmailSchema,
  errors,
  ApiError,
  generateApiKey,
  generateDkimKeypair,
  domainDnsRecords,
  encryptSecret,
  decryptSecret,
  findZoneForDomain,
  publishDnsRecords,
  publishMx,
  listZones,
  analyzeMailHealth,
  mailboxReceivingStatus,
  MAILBOX_MX_HOST,
  env,
  withinLimit,
  isUnlimited,
  renderEmail,
  parseTemplateContent,
  normalizeEmail,
  isValidSyntax,
  assertPublicWebhookUrl,
  type DnsRecord,
} from "@ems/core";
import { sessionAuth, type SessionVars } from "../middleware/session.js";
import { dashWriteGuard } from "../lib/require-perm.js";
import { team } from "./team.js";
import { subaccounts } from "./subaccounts.js";
import { billing } from "./billing.js";
import { privacy } from "./privacy.js";
import { campaigns } from "./campaigns.js";
import { inbox } from "./inbox.js";
import { enqueueEmail, cancelEmail } from "../lib/send.js";
import { sendFromMailbox, replyToMessage } from "../lib/mailbox-actions.js";
import { checkDomainRecords } from "../lib/domain-records.js";
import { effectiveOrgPlan } from "../lib/operator-plan.js";
import { verifyEmailList } from "../lib/verify.js";
import { assertVerifiedNameFree, markDomainVerified } from "../lib/domain-claim.js";
import {
  listConnected,
  disconnectAccount,
  connectAvailable,
} from "../lib/connected-accounts.js";
import {
  ResendSource,
  SendGridSource,
  PostmarkSource,
  MailgunSource,
  type MigrationSource,
  type Inventory,
} from "ems-migrate";

// Dashboard API (session-authed). Mounted at /app. Everything is scoped to the
// session's project — no API key needed in the browser.
export const dash = new Hono<{ Variables: SessionVars }>();

dash.use("*", sessionAuth);
dash.use("*", dashWriteGuard);

// Team management (members, invites, RBAC) lives in its own focused router.
dash.route("/team", team);
// Sub-accounts (agency layer) + active-org switching.
dash.route("/subaccounts", subaccounts);
// Billing (Stripe Connect) — connect status + onboarding for agencies.
dash.route("/billing", billing);
// GDPR stubs: account export + delete.
dash.route("/privacy", privacy);
dash.route("/campaigns", campaigns);
dash.route("/inbox", inbox);

// Resolve the session org's plan limits (server is the sole authority — the
// dashboard's checks are UX only). God Mode operator workspaces self-heal to
// the unlimited plan here so a leftover Free row can't cap the operator.
async function orgPlanLimits(orgId: string) {
  return effectiveOrgPlan(orgId);
}

// Plan + current usage — powers the dashboard's "Plan & usage" card and upgrade
// prompts. Counts domains org-wide (the plan is per-org).
dash.get("/plan", async (c) => {
  const orgId = c.get("orgId");
  const { plan, limits, operator } = await orgPlanLimits(orgId);
  const period = new Date().toISOString().slice(0, 7);
  const [domains, webhooks, seats, sendsAgg] = await Promise.all([
    prisma.domain.count({ where: { project: { orgId } } }),
    prisma.webhookEndpoint.count({ where: { project: { orgId } } }),
    prisma.membership.count({ where: { orgId } }),
    // Org-wide sends this period (summed across projects) to match the per-org limit.
    prisma.usageRecord.aggregate({ _sum: { sends: true }, where: { orgId, period } }),
  ]);
  return c.json({
    plan,
    operator,
    limits,
    usage: { domains, webhooks, seats, sends: sendsAgg._sum.sends ?? 0, period },
  });
});

dash.get("/stats", async (c) => {
  const projectId = c.get("projectId");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Status is monotonic (queued→sent→delivered/bounced/complained), so a confirmed
  // message no longer counts as `sent`. Count each terminal state separately and
  // derive "accepted" (handed off to the receiver) from the union.
  const [total, sent, delivered, failed, bounced, complained, last24h, domains, keys] =
    await Promise.all([
      prisma.email.count({ where: { projectId } }),
      prisma.email.count({ where: { projectId, status: "sent" } }),
      prisma.email.count({ where: { projectId, status: "delivered" } }),
      prisma.email.count({ where: { projectId, status: "failed" } }),
      prisma.email.count({ where: { projectId, status: "bounced" } }),
      prisma.email.count({ where: { projectId, status: "complained" } }),
      prisma.email.count({ where: { projectId, createdAt: { gte: since } } }),
      prisma.domain.count({ where: { projectId } }),
      prisma.apiKey.count({ where: { projectId, revokedAt: null } }),
    ]);
  const accepted = sent + delivered + bounced + complained;
  return c.json({
    total,
    sent,
    delivered,
    accepted,
    failed,
    bounced,
    complained,
    // Confirmed-delivery rate over messages we have feedback for. Null when no
    // feedback has landed yet — never imply delivery we cannot prove.
    deliveryRate: delivered + bounced + complained > 0
      ? +((delivered / (delivered + bounced + complained)) * 100).toFixed(1)
      : null,
    last24h,
    domains,
    keys,
  });
});

dash.get("/emails", async (c) => {
  const projectId = c.get("projectId");
  const list = await prisma.email.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, to: true, subject: true, status: true, createdAt: true },
  });
  return c.json({
    data: list.map((e) => ({
      id: e.id,
      to: e.to,
      subject: e.subject,
      status: e.status,
      created_at: e.createdAt,
    })),
  });
});

// Single email + its delivery event timeline (queued→sent→delivered/bounced/…).
dash.get("/emails/:id", async (c) => {
  const email = await prisma.email.findFirst({
    where: { id: c.req.param("id"), projectId: c.get("projectId") },
    select: {
      id: true, from: true, to: true, cc: true, bcc: true, subject: true,
      status: true, routedVia: true, providerMessageId: true,
      createdAt: true, sentAt: true, scheduledAt: true,
      events: { orderBy: { occurredAt: "asc" }, select: { type: true, occurredAt: true, payload: true } },
    },
  });
  if (!email) throw errors.notFound("Email not found.");
  return c.json(email);
});

// Pull back a scheduled/queued message before it sends (mirrors POST /emails/:id/cancel).
dash.post("/emails/:id/cancel", async (c) => {
  return c.json(await cancelEmail(c.get("projectId"), c.req.param("id")));
});

dash.post("/test-email", async (c) => {
  const parsed = sendEmailSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.validation(parsed.error.issues.map((i) => i.message).join("; "));
  }
  return c.json(await enqueueEmail(c.get("projectId"), parsed.data, null));
});

// --- API key management (in-UI, replaces the bootstrap endpoint) ---
dash.get("/keys", async (c) => {
  const keys = await prisma.apiKey.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return c.json({ data: keys });
});

dash.post("/keys", async (c) => {
  const p = z
    .object({
      name: z.string().min(1).default("API key"),
      permission: z.enum(["full_access", "sending_access"]).default("sending_access"),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  const name = p.success ? p.data.name : "API key";
  const permission = p.success ? p.data.permission : "sending_access";
  const k = generateApiKey("live");
  const created = await prisma.apiKey.create({
    data: {
      projectId: c.get("projectId"),
      name,
      permission,
      prefix: k.prefix,
      hashedKey: k.hashedKey,
    },
    select: { id: true, name: true, prefix: true },
  });
  // token returned ONCE
  return c.json({ ...created, key: k.token });
});

dash.delete("/keys/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const key = await prisma.apiKey.findFirst({ where: { id, projectId } });
  if (!key) throw errors.notFound("Key not found.");
  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return c.json({ ok: true });
});

// --- Custom sending domains (Resend-style) ---
dash.post("/domains", async (c) => {
  const p = z
    .object({ name: z.string().min(3) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("A domain name is required.");
  const name = p.data.name
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const projectId = c.get("projectId");
  await assertVerifiedNameFree(name, projectId);

  // Reinstate path: if the domain already exists but isn't verified, re-surface
  // its records and reset it to pending instead of 409'ing. This is what lets a
  // stuck "action needed" domain be re-added cleanly. We keep the existing DKIM
  // keypair (so anything already published still matches) and only mint one if
  // it's somehow missing. A *verified* domain is left untouched (don't clobber).
  const existing = await prisma.domain.findFirst({ where: { projectId, name } });
  if (existing) {
    if (existing.status === "verified") {
      throw new ApiError(409, "domain_exists", "That domain is already added and verified.");
    }
    let records = (existing.dnsRecords as unknown as DnsRecord[] | null) ?? [];
    const data: Prisma.DomainUpdateInput = { status: "pending", verifiedAt: null };
    if (!existing.dkimSelector || !existing.dkimPublicKey || !records.length) {
      const k = generateDkimKeypair("ems");
      records = domainDnsRecords(name, k.publicKey);
      data.dkimSelector = k.selector;
      data.dkimPublicKey = k.publicKey;
      data.dkimPrivateKey = encryptSecret(k.privateKey);
      data.dnsRecords = records as unknown as Prisma.InputJsonValue;
    }
    const dom = await prisma.domain.update({
      where: { id: existing.id },
      data,
      select: { id: true, name: true, status: true },
    });
    return c.json({ ...dom, records, reinstated: true });
  }

  // Plan gate: cap sending domains (org-wide). Reinstating an existing domain
  // above bypasses this — only brand-new domains count against the limit.
  const { limits } = await orgPlanLimits(c.get("orgId"));
  if (!isUnlimited(limits.sendingDomains)) {
    const count = await prisma.domain.count({ where: { project: { orgId: c.get("orgId") } } });
    if (!withinLimit(count, limits.sendingDomains)) {
      throw errors.planLimit(
        `Your plan includes ${limits.sendingDomains} sending domain${limits.sendingDomains === 1 ? "" : "s"}. Upgrade to add more.`,
      );
    }
  }

  const k = generateDkimKeypair("ems");
  const records = domainDnsRecords(name, k.publicKey);
  const domain = await prisma.domain.create({
    data: {
      projectId,
      name,
      dkimSelector: k.selector,
      dkimPublicKey: k.publicKey,
      // Encrypted at rest (NFR-004); decrypted only in the worker to sign.
      dkimPrivateKey: encryptSecret(k.privateKey),
      status: "pending",
      dnsRecords: records,
    },
    select: { id: true, name: true, status: true },
  });
  return c.json({ ...domain, records });
});

dash.get("/domains", async (c) => {
  const list = await prisma.domain.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      dnsRecords: true,
      verifiedAt: true,
      createdAt: true,
    },
  });
  return c.json({ data: list });
});

// Resolve every expected record over DoH and classify it. DKIM is the
// authoritative proof of control; SPF/DMARC are surfaced for deliverability.
// Mail-health telemetry for a project's domain — MX/SPF/DMARC/DKIM analysis,
// recursive SPF-lookup counting, detected senders, score + risks. Read-only.
dash.get("/domains/:id/health", async (c) => {
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { name: true, dkimSelector: true },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const selectors = [domain.dkimSelector, "google", "resend", "default", "k1", "s1"].filter(
    (s): s is string => Boolean(s),
  );
  return c.json(await analyzeMailHealth(domain.name, { dkimSelectors: selectors }));
});

// Live propagation status (pollable). Upgrades to verified when DKIM lands;
// never downgrades on a transient lookup miss.
dash.get("/domains/:id/status", async (c) => {
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const { checks, dkimOk } = await checkDomainRecords(domain);
  if (dkimOk && domain.status !== "verified") {
    try {
      await markDomainVerified(id, domain.name, domain.projectId);
    } catch {
      /* another project already verified this name */
    }
  }
  return c.json({
    id: domain.id,
    name: domain.name,
    status: dkimOk ? "verified" : domain.status,
    verified: dkimOk,
    records: checks,
    openTracking: domain.openTracking,
    clickTracking: domain.clickTracking,
  });
});

// Toggle per-domain open/click tracking. Opt-in (default off) so we never
// silently pixel-track transactional mail.
dash.patch("/domains/:id/tracking", async (c) => {
  const id = c.req.param("id");
  const p = z
    .object({ openTracking: z.boolean().optional(), clickTracking: z.boolean().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("openTracking/clickTracking must be booleans.");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const updated = await prisma.domain.update({
    where: { id },
    data: {
      ...(p.data.openTracking !== undefined ? { openTracking: p.data.openTracking } : {}),
      ...(p.data.clickTracking !== undefined ? { clickTracking: p.data.clickTracking } : {}),
    },
    select: { openTracking: true, clickTracking: true },
  });
  return c.json(updated);
});

// Resolve the managed-DNS token for a project: its own (BYO, decrypted) wins,
// else the platform token.
async function projectDnsToken(projectId: string): Promise<string | null> {
  const proj = await prisma.project.findUnique({
    where: { id: projectId },
    select: { dnsToken: true },
  });
  // BYO token only. Never fall back to the platform DNS_API_TOKEN — that
  // token can list/publish every zone we own (electronicmailservices.com, agents.*, mail.*).
  const own = proj?.dnsToken ? decryptSecret(proj.dnsToken) : null;
  return own?.trim() || null;
}

// Is this domain in a managed-DNS zone we can publish to? (called once on open)
dash.get("/domains/:id/dns-provider", async (c) => {
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const token = await projectDnsToken(c.get("projectId"));
  if (!token) return c.json({ configured: false, available: false, zone: null });
  const zone = await findZoneForDomain(domain.name, token).catch(() => null);
  return c.json({ configured: true, available: Boolean(zone), zone: zone?.name ?? null });
});

// "Sync from Cloudflare" — list every zone in the project's connected DNS account,
// flagging which are already added, so the user can bulk-select domains to verify.
dash.get("/domains/dns-provider/zones", async (c) => {
  const projectId = c.get("projectId");
  const token = await projectDnsToken(projectId);
  if (!token) return c.json({ configured: false, zones: [] });
  const [zones, existing] = await Promise.all([
    listZones(token).catch(() => []),
    prisma.domain.findMany({ where: { projectId }, select: { name: true } }),
  ]);
  const have = new Set(existing.map((d) => d.name));
  return c.json({
    configured: true,
    zones: zones
      .map((zn) => ({ name: zn.name, added: have.has(zn.name) }))
      .sort((a, b) => Number(a.added) - Number(b.added) || a.name.localeCompare(b.name)),
  });
});

// Bulk add + publish a set of selected zones in one click. Each domain is created
// (DKIM keypair + records) if new, then its records are published to its zone;
// verification then happens via the normal status poll.
dash.post("/domains/bulk", async (c) => {
  const projectId = c.get("projectId");
  const p = z
    .object({ names: z.array(z.string().min(3)).min(1).max(50) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("Select at least one domain to add.");
  const token = await projectDnsToken(projectId);
  // Plan gate: only add up to the remaining sending-domain allowance; the rest
  // come back as a plan-limit error rather than silently exceeding the cap.
  const { limits } = await orgPlanLimits(c.get("orgId"));
  let remaining = isUnlimited(limits.sendingDomains)
    ? Number.POSITIVE_INFINITY
    : Math.max(
        0,
        limits.sendingDomains -
          (await prisma.domain.count({ where: { project: { orgId: c.get("orgId") } } })),
      );
  const results: { name: string; status: "published" | "added" | "error"; detail?: string }[] = [];
  for (const raw of p.data.names) {
    const name = raw.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    try {
      let domain = await prisma.domain.findFirst({ where: { projectId, name } });
      if (!domain) {
        if (remaining <= 0) {
          results.push({ name, status: "error", detail: "plan domain limit reached — upgrade to add more" });
          continue;
        }
        remaining--;
        await assertVerifiedNameFree(name, projectId);
        const k = generateDkimKeypair("ems");
        domain = await prisma.domain.create({
          data: {
            projectId,
            name,
            dkimSelector: k.selector,
            dkimPublicKey: k.publicKey,
            dkimPrivateKey: encryptSecret(k.privateKey),
            status: "pending",
            dnsRecords: domainDnsRecords(name, k.publicKey),
          },
        });
      }
      if (!token) {
        results.push({ name, status: "added", detail: "no DNS provider connected — add records manually" });
        continue;
      }
      const zone = await findZoneForDomain(name, token);
      if (!zone) {
        results.push({ name, status: "added", detail: "not in your DNS account — add records manually" });
        continue;
      }
      const recs = (domain.dnsRecords as unknown as DnsRecord[]) ?? [];
      const pub = await publishDnsRecords(recs, { zoneId: zone.id, token });
      results.push({
        name,
        status: pub.every((r) => r.action !== "error") ? "published" : "error",
        detail: zone.name,
      });
    } catch (e) {
      results.push({ name, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({ results, ok: results.every((r) => r.status !== "error") });
});

// ---- Import from another ESP (Resend / SendGrid / Postmark), read-only preview.
// Pulls the source account's inventory so the dashboard can show a plan and offer
// downloads. NO mutation here: domains are added via /domains/bulk after the user
// confirms. The source API key is used once for this request and never stored. ----
const importSchema = z.object({
  provider: z.enum(["resend", "sendgrid", "postmark", "mailgun"]),
  apiKey: z.string().trim().optional(),
  accountToken: z.string().trim().optional(),
  region: z.enum(["us", "eu"]).optional(),
});

function buildImportSource(p: z.infer<typeof importSchema>): MigrationSource {
  switch (p.provider) {
    case "resend":
      if (!p.apiKey) throw errors.validation("A Resend API key is required.");
      return new ResendSource({ apiKey: p.apiKey });
    case "sendgrid":
      if (!p.apiKey) throw errors.validation("A SendGrid API key is required.");
      return new SendGridSource({ apiKey: p.apiKey });
    case "postmark":
      if (!p.apiKey && !p.accountToken) {
        throw errors.validation("A Postmark Server and/or Account token is required.");
      }
      return new PostmarkSource({ serverToken: p.apiKey, accountToken: p.accountToken });
    case "mailgun":
      if (!p.apiKey) throw errors.validation("A Mailgun API key is required.");
      return new MailgunSource({ apiKey: p.apiKey, region: p.region });
  }
}

dash.post("/import", async (c) => {
  const p = importSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("Choose a provider and paste an API key.");
  const inv: Inventory = await buildImportSource(p.data).inventory();
  const contacts = inv.audiences.reduce((n, a) => n + a.contacts.length, 0);
  return c.json({
    provider: inv.source,
    counts: {
      domains: inv.domains.length,
      templates: inv.templates.length,
      audiences: inv.audiences.length,
      contacts,
      apiKeys: inv.apiKeys.length,
    },
    domains: inv.domains.map((d) => ({ name: d.name, status: d.status })),
    apiKeys: inv.apiKeys.map((k) => ({ name: k.name })),
    notes: inv.notes,
    // Full bodies for client-side download (template HTML, contact CSVs). The key
    // is never echoed back.
    kit: {
      templates: inv.templates
        .filter((t) => t.html || t.text)
        .map((t) => ({ name: t.name, subject: t.subject, html: t.html, text: t.text })),
      audiences: inv.audiences
        .filter((a) => a.contacts.length)
        .map((a) => ({ name: a.name, contacts: a.contacts })),
    },
  });
});

// One-click publish of all records to the domain's managed-DNS zone.
dash.post("/domains/:id/dns-provider/publish", async (c) => {
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const token = await projectDnsToken(c.get("projectId"));
  if (!token) {
    throw new ApiError(
      400,
      "dns_provider_not_configured",
      "No managed-DNS provider is connected for this account.",
    );
  }
  const zone = await findZoneForDomain(domain.name, token);
  if (!zone) {
    throw new ApiError(
      404,
      "zone_not_found",
      `"${domain.name}" isn't in a connected managed-DNS account. Add the records at your DNS provider instead.`,
    );
  }
  const records = (domain.dnsRecords as unknown as DnsRecord[]) ?? [];
  const results = await publishDnsRecords(records, { zoneId: zone.id, token });
  return c.json({
    zone: zone.name,
    results,
    ok: results.every((r) => r.action !== "error"),
  });
});

// Manual re-check button — like /status but also persists a failed verdict.
dash.post("/domains/:id/verify", async (c) => {
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const { checks, dkimOk } = await checkDomainRecords(domain);
  const updated = await prisma.domain.update({
    where: { id },
    data: { status: dkimOk ? "verified" : "failed", verifiedAt: dkimOk ? new Date() : null },
  });
  return c.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    verified: dkimOk,
    records: checks,
  });
});

// Re-check every not-yet-verified domain in the project and flip status — so a
// bulk add/sync doesn't require opening each domain to make its status update.
// Concurrency-capped so a large account doesn't burst hundreds of DoH lookups.
dash.post("/domains/recheck-all", async (c) => {
  const projectId = c.get("projectId");
  const domains = await prisma.domain.findMany({
    where: { projectId, status: { in: ["pending", "failed"] } },
    select: { id: true, dnsRecords: true, dkimPublicKey: true },
  });
  let verified = 0;
  let pending = 0;
  const CHUNK = 8;
  for (let i = 0; i < domains.length; i += CHUNK) {
    await Promise.all(
      domains.slice(i, i + CHUNK).map(async (d) => {
        try {
          const { dkimOk } = await checkDomainRecords(d);
          if (dkimOk) {
            try {
              const row = await prisma.domain.findUnique({
                where: { id: d.id },
                select: { name: true, projectId: true },
              });
              if (row) await markDomainVerified(d.id, row.name, row.projectId);
              verified++;
            } catch {
              pending++;
            }
          } else pending++;
        } catch {
          pending++;
        }
      }),
    );
  }
  return c.json({ checked: domains.length, verified, pending });
});

dash.delete("/domains/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  // Idempotent: if it's already gone, succeed — a domain must never get "stuck"
  // undeletable. Detach the send log first (the FK is ON DELETE SET NULL, but
  // being explicit means the delete can't fail on a referencing row), then remove
  // with deleteMany so a row that vanished in a race doesn't throw P2025.
  const d = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!d) return c.json({ ok: true });
  await prisma.email.updateMany({ where: { domainId: id }, data: { domainId: null } });
  await prisma.domain.deleteMany({ where: { id, projectId } });
  return c.json({ ok: true });
});

// --- Suppression list (FR-042): addresses we won't send to ---
dash.get("/suppressions", async (c) => {
  const list = await prisma.suppression.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, address: true, reason: true, source: true, createdAt: true },
  });
  return c.json({ data: list });
});

dash.post("/suppressions", async (c) => {
  const p = z
    .object({
      address: z.string().email(),
      reason: z.enum(["hard_bounce", "complaint", "manual", "invalid"]).default("manual"),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid email address is required.");
  const address = p.data.address.toLowerCase();
  const projectId = c.get("projectId");
  const row = await prisma.suppression.upsert({
    where: { projectId_address: { projectId, address } },
    create: { projectId, address, reason: p.data.reason, source: "dashboard" },
    update: { reason: p.data.reason },
    select: { id: true, address: true, reason: true },
  });
  return c.json(row);
});

dash.delete("/suppressions/:id", async (c) => {
  const id = c.req.param("id");
  const row = await prisma.suppression.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!row) throw errors.notFound("Suppression not found.");
  await prisma.suppression.delete({ where: { id } });
  return c.json({ ok: true });
});

// --- Email templates (block-based builder). content = { blocks, settings };
// rendered to HTML by the shared renderer and sendable via templateId. ---
const templateContentSchema = z.object({
  // Each block must at least be an object with a string `type` (rejects null /
  // primitives that would otherwise be persisted and crash the renderer).
  blocks: z.array(z.object({ type: z.string() }).passthrough()).max(200),
  settings: z.record(z.string(), z.any()).optional(),
});

dash.get("/templates", async (c) => {
  const data = await prisma.emailTemplate.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, subject: true, usageCount: true, lastUsedAt: true, updatedAt: true },
  });
  return c.json({ data });
});

dash.post("/templates", async (c) => {
  const p = z
    .object({
      name: z.string().min(1).max(120),
      subject: z.string().max(300).default(""),
      content: templateContentSchema,
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A template name and block content are required.");
  const t = await prisma.emailTemplate.create({
    data: {
      projectId: c.get("projectId"),
      name: p.data.name,
      subject: p.data.subject,
      content: p.data.content as Prisma.InputJsonValue,
    },
    select: { id: true, name: true, subject: true },
  });
  return c.json(t);
});

dash.get("/templates/:id", async (c) => {
  const t = await prisma.emailTemplate.findFirst({
    where: { id: c.req.param("id"), projectId: c.get("projectId") },
  });
  if (!t) throw errors.notFound("Template not found.");
  return c.json(t);
});

dash.put("/templates/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await prisma.emailTemplate.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true },
  });
  if (!existing) throw errors.notFound("Template not found.");
  const p = z
    .object({
      name: z.string().min(1).max(120).optional(),
      subject: z.string().max(300).optional(),
      content: templateContentSchema.optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid template update.");
  const t = await prisma.emailTemplate.update({
    where: { id },
    data: {
      ...(p.data.name !== undefined ? { name: p.data.name } : {}),
      ...(p.data.subject !== undefined ? { subject: p.data.subject } : {}),
      ...(p.data.content !== undefined ? { content: p.data.content as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, name: true, subject: true },
  });
  return c.json(t);
});

dash.delete("/templates/:id", async (c) => {
  await prisma.emailTemplate.deleteMany({
    where: { id: c.req.param("id"), projectId: c.get("projectId") },
  });
  return c.json({ ok: true });
});

// Live preview: render arbitrary block content with this org's branding + sample
// data, so the editor can show a faithful preview without saving.
dash.post("/templates/preview", async (c) => {
  const p = z
    .object({ content: templateContentSchema, data: z.record(z.string(), z.any()).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Provide block content to preview.");
  const org = await prisma.organization.findUnique({
    where: { id: c.get("orgId") },
    select: { name: true, logoUrl: true, primaryColor: true },
  });
  const ctx = {
    organization: {
      name: org?.name ?? "Your Company",
      logo: org?.logoUrl ?? "",
      primaryColor: org?.primaryColor ?? "#6d5efc",
    },
    data: p.data.data ?? {
      firstName: "Alex",
      email: "alex@example.com",
      verifyUrl: "https://app.example.com/verify",
      resetUrl: "https://app.example.com/reset",
      loginUrl: "https://app.example.com/login",
      receiptUrl: "https://app.example.com/receipt",
      url: "https://app.example.com",
      amount: 4900,
      orderId: "1042",
      date: "2026-06-25",
    },
  };
  const html = renderEmail(parseTemplateContent(p.data.content), ctx);
  return c.json({ html });
});

// --- White-label branding (org-level). GET returns the current brand; PUT
// updates it (owner/admin only). Colour + logo are validated server-side; the
// dashboard applies these on boot via /auth/me. ---
dash.get("/branding", async (c) => {
  const org = await prisma.organization.findUnique({
    where: { id: c.get("orgId") },
    select: { name: true, logoUrl: true, primaryColor: true, poweredBy: true },
  });
  if (!org) throw errors.notFound("Organization not found.");
  return c.json(org);
});

dash.put("/branding", async (c) => {
  const membership = await prisma.membership.findFirst({
    where: { userId: c.get("userId"), orgId: c.get("orgId") },
    select: { role: true },
  });
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw errors.forbidden("Only an owner or admin can change branding.");
  }
  const p = z
    .object({
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #6d5efc.")
        .nullable()
        .optional(),
      logoUrl: z
        .string()
        .url()
        .startsWith("https://", "Logo URL must start with https://.")
        .max(500)
        .nullable()
        .optional(),
      poweredBy: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation(p.error.issues.map((i) => i.message).join("; "));
  // Removing the "Powered by EMS" badge is the custom-branding upsell.
  if (p.data.poweredBy === false) {
    const { limits } = await orgPlanLimits(c.get("orgId"));
    if (!limits.customBranding) {
      throw errors.planLimit(
        "Removing “Powered by EMS” needs a plan with custom branding. Upgrade to enable it.",
      );
    }
  }
  const data: { primaryColor?: string | null; logoUrl?: string | null; poweredBy?: boolean } = {};
  if (p.data.primaryColor !== undefined) data.primaryColor = p.data.primaryColor;
  if (p.data.logoUrl !== undefined) data.logoUrl = p.data.logoUrl;
  if (p.data.poweredBy !== undefined) data.poweredBy = p.data.poweredBy;
  const org = await prisma.organization.update({
    where: { id: c.get("orgId") },
    data,
    select: { name: true, logoUrl: true, primaryColor: true, poweredBy: true },
  });
  return c.json(org);
});

// --- Native mailboxes (P1: receive + read). A mailbox lives on a verified
// sending domain; inbound mail is stored by POST /mta/inbound. ---
dash.get("/mailboxes", async (c) => {
  const domainId = c.req.query("domainId");
  const projectId = c.get("projectId");
  const list = await prisma.mailbox.findMany({
    where: { projectId, ...(domainId ? { domainId } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, address: true, displayName: true, status: true,
      usedBytes: true, quotaBytes: true, createdAt: true,
      keepCopy: true, catchAll: true,
      _count: { select: { messages: true, forwards: true } },
    },
  });
  const unreadRows = list.length
    ? await prisma.message.groupBy({
        by: ["mailboxId"],
        where: { mailboxId: { in: list.map((m) => m.id) }, seen: false, folder: "inbox" },
        _count: { _all: true },
      })
    : [];
  const unreadBy = Object.fromEntries(unreadRows.map((r) => [r.mailboxId, r._count._all]));
  return c.json({
    data: list.map((m) => ({
      id: m.id, address: m.address, displayName: m.displayName, status: m.status,
      usedBytes: Number(m.usedBytes), quotaBytes: Number(m.quotaBytes),
      messages: m._count.messages, unread: unreadBy[m.id] ?? 0,
      keepCopy: m.keepCopy, catchAll: m.catchAll, forwardCount: m._count.forwards,
      createdAt: m.createdAt,
    })),
  });
});

// Receiving readiness for native mailboxes: does the domain's MX point at our
// MTA? Pass ?domain= to check a candidate (create flow); omit to get the status
// of every domain that already has a mailbox (list view). Read-only DNS lookup.
dash.get("/mailboxes/receiving", async (c) => {
  const projectId = c.get("projectId");
  const candidate = (c.req.query("domain") || "").toLowerCase().trim();
  if (candidate) {
    if (!/^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(candidate)) {
      throw errors.validation("Enter a valid domain.");
    }
    return c.json(await mailboxReceivingStatus(candidate));
  }
  const rows = await prisma.mailbox.findMany({
    where: { projectId },
    select: { address: true },
  });
  const domains = [
    ...new Set(
      rows
        .map((r) => r.address.split("@")[1])
        .filter((d): d is string => Boolean(d)),
    ),
  ];
  const data = await Promise.all(domains.map((d) => mailboxReceivingStatus(d)));
  return c.json({ data });
});

// One-click: publish the MX record for `host` (the mailbox domain, or a subdomain
// like inbox.acme.com) to the connected DNS provider so receiving works without
// copy-pasting. Only ever touches the given host — never an apex unless host is
// the apex — so it can't disturb live Workspace mail on a parent domain.
dash.post("/mailboxes/publish-mx", async (c) => {
  const p = z.object({ host: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A host is required.");
  const host = p.data.host.toLowerCase().trim().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(host)) {
    throw errors.validation("Enter a valid host.");
  }
  const token = await projectDnsToken(c.get("projectId"));
  if (!token) {
    throw errors.validation("Connect your DNS provider first (Domains → Connect) to publish automatically.");
  }
  try {
    return c.json(await publishMx(host, MAILBOX_MX_HOST, 10, token));
  } catch (e) {
    throw errors.validation(e instanceof Error ? e.message : "Could not publish the MX record.");
  }
});

dash.post("/mailboxes", async (c) => {
  const projectId = c.get("projectId");
  const p = z
    .object({ address: z.string().email(), displayName: z.string().optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("A valid mailbox address is required.");
  const address = p.data.address.toLowerCase();
  const domainName = address.split("@")[1];
  const domain = await prisma.domain.findFirst({
    where: { projectId, name: domainName, status: "verified" },
    select: { id: true },
  });
  if (!domain) {
    throw errors.validation(`Add and verify the domain ${domainName} before creating a mailbox there.`);
  }
  try {
    const mb = await prisma.mailbox.create({
      data: { projectId, domainId: domain.id, address, displayName: p.data.displayName },
      select: { id: true, address: true, displayName: true, status: true },
    });
    return c.json(mb);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "mailbox_exists", "That mailbox already exists.");
    }
    throw e;
  }
});

dash.delete("/mailboxes/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  await prisma.mailbox.deleteMany({ where: { id, projectId } });
  return c.json({ ok: true });
});

dash.get("/mailboxes/:id", async (c) => {
  const id = c.req.param("id");
  const mb = await prisma.mailbox.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: {
      id: true, address: true, displayName: true, status: true,
      keepCopy: true, catchAll: true, usedBytes: true, quotaBytes: true,
      forwards: {
        select: { id: true, destination: true, verifiedAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!mb) throw errors.notFound("Mailbox not found.");
  return c.json({
    ...mb,
    usedBytes: Number(mb.usedBytes),
    quotaBytes: Number(mb.quotaBytes),
  });
});

dash.patch("/mailboxes/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const p = z
    .object({
      displayName: z.string().max(80).optional(),
      keepCopy: z.boolean().optional(),
      catchAll: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid mailbox update.");
  const mb = await prisma.mailbox.findFirst({
    where: { id, projectId },
    select: { id: true, domainId: true },
  });
  if (!mb) throw errors.notFound("Mailbox not found.");
  if (p.data.catchAll === true) {
    if (!mb.domainId) {
      throw errors.validation("Catch-all is only available on custom-domain inboxes.");
    }
    await prisma.$transaction([
      prisma.mailbox.updateMany({
        where: { domainId: mb.domainId, catchAll: true, NOT: { id } },
        data: { catchAll: false },
      }),
      prisma.mailbox.update({
        where: { id },
        data: {
          catchAll: true,
          ...(p.data.keepCopy !== undefined ? { keepCopy: p.data.keepCopy } : {}),
          ...(p.data.displayName !== undefined ? { displayName: p.data.displayName } : {}),
        },
      }),
    ]);
  } else {
    await prisma.mailbox.update({
      where: { id },
      data: {
        ...(p.data.catchAll !== undefined ? { catchAll: p.data.catchAll } : {}),
        ...(p.data.keepCopy !== undefined ? { keepCopy: p.data.keepCopy } : {}),
        ...(p.data.displayName !== undefined ? { displayName: p.data.displayName } : {}),
      },
    });
  }
  return c.json({ ok: true });
});

dash.post("/mailboxes/:id/send", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const p = z
    .object({
      to: z.string().email(),
      subject: z.string().min(1),
      text: z.string().optional(),
      html: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success || (!p.data.text && !p.data.html)) {
    throw errors.validation("to, subject, and a body (text or html) are required.");
  }
  await sendFromMailbox(projectId, id, p.data);
  return c.json({ ok: true });
});

dash.post("/mailboxes/:id/forwards", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const p = z
    .object({ destination: z.string().email() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid destination email is required.");
  const dest = p.data.destination.toLowerCase();
  const mb = await prisma.mailbox.findFirst({
    where: { id, projectId },
    select: { id: true, address: true, projectId: true },
  });
  if (!mb) throw errors.notFound("Mailbox not found.");
  if (dest === mb.address) throw errors.validation("Can't forward a mailbox to itself.");
  const token = randomBytes(24).toString("base64url");
  let row;
  try {
    row = await prisma.mailForward.create({
      data: { mailboxId: mb.id, destination: dest, verifyToken: token },
      select: { id: true, destination: true, verifiedAt: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "forward_exists", "That destination is already on this mailbox.");
    }
    throw e;
  }
  const link = `${new URL(env.API_URL).origin}/forwards/verify?token=${token}`;
  try {
    await enqueueEmail(
      projectId,
      {
        from: "ems <hello@electronicmailservices.com>",
        to: dest,
        subject: `Confirm forwarding from ${mb.address}`,
        text: `Confirm that ${mb.address} may send you a copy of inbound mail:\n${link}`,
        html: `<p>Confirm that <b>${mb.address}</b> may send you a copy of inbound mail:</p><p><a href="${link}">Confirm forwarding</a></p>`,
      } as Parameters<typeof enqueueEmail>[1],
      null,
      { internal: true },
    );
  } catch {
    /* best-effort — the row exists; they can resend by deleting + adding */
  }
  return c.json(row);
});

dash.delete("/mailboxes/:id/forwards/:fid", async (c) => {
  const { id, fid } = c.req.param();
  const mb = await prisma.mailbox.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true },
  });
  if (!mb) throw errors.notFound("Mailbox not found.");
  await prisma.mailForward.deleteMany({ where: { id: fid, mailboxId: mb.id } });
  return c.json({ ok: true });
});

dash.get("/mailboxes/:id/messages", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const mb = await prisma.mailbox.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!mb) throw errors.notFound("Mailbox not found.");
  const folder = c.req.query("folder") ?? "inbox";
  const q = (c.req.query("q") ?? "").trim();
  const msgs = await prisma.message.findMany({
    where: {
      mailboxId: id,
      folder,
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { fromAddr: { contains: q, mode: "insensitive" } },
              { snippet: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { id: true, fromAddr: true, subject: true, snippet: true, seen: true, flagged: true, receivedAt: true },
  });
  return c.json({ data: msgs });
});

dash.get("/messages/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const msg = await prisma.message.findFirst({
    where: { id, mailbox: { projectId } },
    select: {
      id: true, fromAddr: true, toAddrs: true, subject: true, text: true, html: true,
      seen: true, flagged: true, folder: true, receivedAt: true, mailboxId: true,
      messageId: true, inReplyTo: true, threadId: true,
    },
  });
  if (!msg) throw errors.notFound("Message not found.");
  if (!msg.seen) await prisma.message.update({ where: { id }, data: { seen: true } });
  // Conversation: every message in the same thread (across folders), oldest first.
  const thread = msg.threadId
    ? await prisma.message.findMany({
        where: { mailboxId: msg.mailboxId, threadId: msg.threadId },
        orderBy: { receivedAt: "asc" },
        select: { id: true, fromAddr: true, subject: true, snippet: true, folder: true, seen: true, receivedAt: true },
      })
    : [];
  return c.json({ ...msg, thread });
});

// Update a message: move folder / mark seen / flag. Scoped to the project.
dash.patch("/messages/:id", async (c) => {
  const id = c.req.param("id");
  const p = z
    .object({
      folder: z.enum(["inbox", "sent", "archive", "spam", "trash"]).optional(),
      seen: z.boolean().optional(),
      flagged: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid message update.");
  const msg = await prisma.message.findFirst({
    where: { id, mailbox: { projectId: c.get("projectId") } },
    select: { id: true },
  });
  if (!msg) throw errors.notFound("Message not found.");
  await prisma.message.update({
    where: { id },
    data: {
      ...(p.data.folder !== undefined ? { folder: p.data.folder } : {}),
      ...(p.data.seen !== undefined ? { seen: p.data.seen } : {}),
      ...(p.data.flagged !== undefined ? { flagged: p.data.flagged } : {}),
    },
  });
  return c.json({ ok: true });
});

// Reply to a message from the mailbox address (sent through the MTA on the
// mailbox's verified domain). Carries In-Reply-To/References + threadId so it
// threads in the recipient's client and in our own conversation view, and is
// stored in the mailbox's "sent" folder.
dash.post("/messages/:id/reply", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const p = z
    .object({ text: z.string().optional(), html: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success || (!p.data.text && !p.data.html)) {
    throw errors.validation("A reply body (text or html) is required.");
  }
  await replyToMessage(projectId, id, p.data);
  return c.json({ ok: true });
});

// --- Webhooks (FR-060,061): subscribe customer URLs to email events ---
const WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.inbound", // mail RECEIVED by a hosted mailbox (MTA → /mta/inbound fan-out)
] as const;

dash.get("/webhooks", async (c) => {
  const list = await prisma.webhookEndpoint.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      eventTypes: true,
      enabled: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
  });
  return c.json({ data: list, events: WEBHOOK_EVENTS });
});

dash.post("/webhooks", async (c) => {
  const p = z
    .object({
      url: z.string().url(),
      eventTypes: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid https URL is required.");
  // SSRF guard: only public https endpoints (no localhost / private / metadata IPs).
  try {
    assertPublicWebhookUrl(p.data.url);
  } catch (e) {
    throw errors.validation(e instanceof Error ? e.message : "Invalid webhook URL.");
  }
  // Plan gate: cap webhook endpoints (org-wide).
  const { limits } = await orgPlanLimits(c.get("orgId"));
  if (!isUnlimited(limits.webhookEndpoints)) {
    const count = await prisma.webhookEndpoint.count({
      where: { project: { orgId: c.get("orgId") } },
    });
    if (!withinLimit(count, limits.webhookEndpoints)) {
      throw errors.planLimit(
        `Your plan includes ${limits.webhookEndpoints} webhook endpoint${limits.webhookEndpoints === 1 ? "" : "s"}. Upgrade to add more.`,
      );
    }
  }
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const created = await prisma.webhookEndpoint.create({
    data: {
      projectId: c.get("projectId"),
      url: p.data.url,
      eventTypes: p.data.eventTypes,
      secret: encryptSecret(secret),
    },
    select: { id: true, url: true, eventTypes: true },
  });
  // secret returned ONCE so the customer can verify the HMAC signature
  return c.json({ ...created, secret });
});

dash.patch("/webhooks/:id", async (c) => {
  const id = c.req.param("id");
  const ep = await prisma.webhookEndpoint.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!ep) throw errors.notFound("Webhook not found.");
  const p = z
    .object({
      enabled: z.boolean().optional(),
      eventTypes: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid update.");
  await prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...(p.data.enabled !== undefined ? { enabled: p.data.enabled } : {}),
      ...(p.data.eventTypes ? { eventTypes: p.data.eventTypes } : {}),
    },
  });
  return c.json({ ok: true });
});

dash.delete("/webhooks/:id", async (c) => {
  const id = c.req.param("id");
  const ep = await prisma.webhookEndpoint.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!ep) throw errors.notFound("Webhook not found.");
  await prisma.webhookEndpoint.delete({ where: { id } });
  return c.json({ ok: true });
});

// --- List verification: validate addresses BEFORE sending (protects rep) ---
dash.post("/verify", async (c) => {
  const p = z
    .object({ emails: z.array(z.string()).min(1).max(2000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Provide 1–2000 email addresses.");
  return c.json(await verifyEmailList(c.get("projectId"), p.data.emails));
});

// Add a set of addresses (e.g. the undeliverable/risky from a verify run) to
// the suppression list so they're never sent to.
dash.post("/verify/suppress", async (c) => {
  const p = z
    .object({ addresses: z.array(z.string()).min(1).max(5000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Provide addresses to suppress.");
  const projectId = c.get("projectId");
  const addrs = [...new Set(p.data.addresses.map(normalizeEmail).filter(isValidSyntax))];
  const res = await prisma.suppression.createMany({
    data: addrs.map((address) => ({ projectId, address, reason: "invalid" as const, source: "verify" })),
    skipDuplicates: true,
  });
  return c.json({ added: res.count });
});

// --- BYO managed-DNS token (per-project, encrypted) for one-click DNS on the
// customer's own zones. We never return the token; only whether one is set. ---
dash.get("/dns-provider-token", async (c) => {
  const proj = await prisma.project.findUnique({
    where: { id: c.get("projectId") },
    select: { dnsToken: true },
  });
  return c.json({
    connected: Boolean(proj?.dnsToken),
    // Always false: tenant one-click DNS is BYO-token only (no platform fallthrough).
    platformFallback: false,
  });
});

dash.post("/dns-provider-token", async (c) => {
  const p = z
    .object({ token: z.string().min(20) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A managed-DNS API token is required.");
  // Verify the token works (and has the needed scope) before storing it.
  const r = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: { Authorization: `Bearer ${p.data.token}` },
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean };
  if (!j.success) {
    throw new ApiError(400, "invalid_token", "That managed-DNS token failed verification.");
  }
  await prisma.project.update({
    where: { id: c.get("projectId") },
    data: { dnsToken: encryptSecret(p.data.token) },
  });
  return c.json({ ok: true, connected: true });
});

dash.delete("/dns-provider-token", async (c) => {
  await prisma.project.update({
    where: { id: c.get("projectId") },
    data: { dnsToken: null },
  });
  return c.json({ ok: true, connected: false });
});

// ---- Connected sending accounts (send from a client's own Gmail / Outlook) ----
// Connecting happens via the top-level /connect/:provider OAuth redirect flow;
// these endpoints list and remove the stored accounts.
dash.get("/connected-accounts", async (c) => {
  return c.json({
    available: {
      google: connectAvailable("google"),
      microsoft: connectAvailable("microsoft"),
    },
    accounts: await listConnected(c.get("projectId")),
  });
});

dash.delete("/connected-accounts/:id", async (c) => {
  await disconnectAccount(c.get("projectId"), c.req.param("id"));
  return c.json({ ok: true });
});
