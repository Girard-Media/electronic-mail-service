import { promises as dns } from "node:dns";
import { Hono } from "hono";
import { z } from "zod";
import { setCookie, getCookie } from "hono/cookie";
import { sign } from "hono/jwt";
import {
  env,
  errors,
  ApiError,
  PLATFORM_SCOPES,
  isPlatformScope,
  hashPassword,
  resolveTxt,
  planPricing,
  PLAN_IDS,
  generateTotpSecret,
  totpAuthUrl,
  verifyTotp,
  encryptSecret,
  decryptSecret,
} from "@ems/core";
import { prisma } from "@ems/db";
import { sessionAuth, SESSION_COOKIE, GOD_COOKIE } from "../middleware/session.js";
import {
  requirePlatformAdmin,
  requireScope,
  requireSuperadmin,
  audit,
  type GodVars,
} from "../middleware/platform.js";
import { grantOperatorPlan } from "../lib/operator-plan.js";

// God Mode — platform super-admin control plane. Mounted at /god, locked to
// platform admins (session auth + platform-admin check). Impersonation sessions
// are refused here (see requirePlatformAdmin).
export const god = new Hono<{ Variables: GodVars }>();

god.use("*", sessionAuth, requirePlatformAdmin);

const IMPERSONATE_MAX_AGE = 60 * 60 * 4; // 4h — shorter-lived than a normal session

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
}

god.get("/me", async (c) => {
  const [user, admin] = await Promise.all([
    prisma.user.findUnique({
      where: { id: c.get("userId") },
      select: { email: true, name: true },
    }),
    prisma.platformAdmin.findUnique({
      where: { userId: c.get("userId") },
      select: { totpEnabledAt: true, totpSecret: true },
    }),
  ]);
  return c.json({
    userId: c.get("userId"),
    email: user?.email,
    name: user?.name,
    role: c.get("platformRole"),
    superadmin: c.get("platformRole") === "superadmin",
    scopes: c.get("platformScopes"),
    allScopes: PLATFORM_SCOPES,
    totpEnabled: Boolean(admin?.totpEnabledAt),
    totpPending: Boolean(admin?.totpSecret && !admin.totpEnabledAt),
  });
});

god.post("/totp/begin", async (c) => {
  const user = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { email: true },
  });
  const admin = await prisma.platformAdmin.findUnique({
    where: { userId: c.get("userId") },
    select: { totpEnabledAt: true },
  });
  if (admin?.totpEnabledAt) {
    throw errors.conflict("totp_already_enabled", "Authenticator is already enabled.");
  }
  const secret = generateTotpSecret();
  await prisma.platformAdmin.update({
    where: { userId: c.get("userId") },
    data: { totpSecret: encryptSecret(secret), totpEnabledAt: null },
  });
  await audit(c.get("userId"), "totp.begin", { type: "user", id: c.get("userId") });
  return c.json({
    secret,
    otpauth: totpAuthUrl(user?.email || "god", secret),
  });
});

god.post("/totp/confirm", async (c) => {
  const p = z.object({ code: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Enter the 6-digit authenticator code.");
  const admin = await prisma.platformAdmin.findUnique({
    where: { userId: c.get("userId") },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (!admin?.totpSecret) throw errors.validation("Start authenticator setup first.");
  if (admin.totpEnabledAt) throw errors.conflict("totp_already_enabled", "Authenticator is already enabled.");
  if (!verifyTotp(decryptSecret(admin.totpSecret), p.data.code)) throw errors.totpInvalid();
  await prisma.platformAdmin.update({
    where: { userId: c.get("userId") },
    data: { totpEnabledAt: new Date() },
  });
  await audit(c.get("userId"), "totp.enable", { type: "user", id: c.get("userId") });
  return c.json({ ok: true, totpEnabled: true });
});

god.get("/overview", async (c) => {
  requireScope(c, "metrics");
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [users, orgs, projects, domains, verifiedDomains, keys, emails, sent, delivered, bounced, complained, failed, last24, last7, top] =
    await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.project.count(),
      prisma.domain.count(),
      prisma.domain.count({ where: { status: "verified" } }),
      prisma.apiKey.count({ where: { revokedAt: null } }),
      prisma.email.count(),
      prisma.email.count({ where: { status: "sent" } }),
      prisma.email.count({ where: { status: "delivered" } }),
      prisma.email.count({ where: { status: "bounced" } }),
      prisma.email.count({ where: { status: "complained" } }),
      prisma.email.count({ where: { status: "failed" } }),
      prisma.email.count({ where: { createdAt: { gte: since24 } } }),
      prisma.email.count({ where: { createdAt: { gte: since7 } } }),
      prisma.email.groupBy({
        by: ["projectId"],
        _count: { _all: true },
        orderBy: { _count: { projectId: "desc" } },
        take: 5,
      }),
    ]);
  const projs = await prisma.project.findMany({
    where: { id: { in: top.map((t) => t.projectId) } },
    select: { id: true, name: true, org: { select: { name: true } } },
  });
  const topOrgs = top
    .map((t) => {
      const p = projs.find((x) => x.id === t.projectId);
      return { org: p?.org.name ?? "—", project: p?.name ?? "—", sends: t._count._all };
    })
    .filter((t) => t.sends > 0);
  return c.json({
    users,
    orgs,
    projects,
    domains,
    verifiedDomains,
    keys,
    emails,
    sent,
    delivered,
    bounced,
    complained,
    accepted: sent + delivered + bounced + complained,
    failed,
    // Confirmed-delivery rate over messages we have feedback for; null until the
    // feedback loop has data. Accepted-by-MTA is reported separately as `accepted`.
    deliveryRate: delivered + bounced + complained > 0
      ? Math.round((delivered / (delivered + bounced + complained)) * 100)
      : null,
    last24h: last24,
    last7d: last7,
    topOrgs,
  });
});

god.get("/profitability", async (c) => {
  requireScope(c, "profitability");
  const grouped = await prisma.organization.groupBy({
    by: ["plan"],
    _count: { _all: true },
  });
  let mrr = 0;
  const planRows = grouped.map((g) => {
    const price = planPricing(g.plan).monthlyUsd;
    const subtotal = price * g._count._all;
    mrr += subtotal;
    return { plan: g.plan, count: g._count._all, price, subtotal };
  });
  const sent = await prisma.email.count({ where: { status: "sent" } });
  const COST_PER_1K = 0.1; // self-hosted infra estimate (USD per 1k sends)
  const costEstimate = +((sent / 1000) * COST_PER_1K).toFixed(2);
  return c.json({
    currency: "USD",
    mrr,
    arr: mrr * 12,
    planRows: planRows.sort((a, b) => b.subtotal - a.subtotal),
    sentTotal: sent,
    costPer1k: COST_PER_1K,
    costEstimate,
    grossMarginPct: mrr ? Math.round(((mrr - costEstimate) / mrr) * 100) : 0,
    note: "Estimate — list-price MRR by plan and a self-hosted send-cost model. Real billing/metering is not yet integrated.",
  });
});

// ---- Reputation Center: live sender-reputation tracking ----
const SENDING_IP = process.env.SENDING_IP ?? "31.220.104.223";
const SENDING_DOMAIN = process.env.SENDING_DOMAIN ?? "electronicmailservices.com";
const DKIM_SELECTOR = "mail";
const DNSBLS = [
  { name: "Spamhaus ZEN", zone: "zen.spamhaus.org" },
  { name: "Barracuda", zone: "b.barracudacentral.org" },
  { name: "SpamCop", zone: "bl.spamcop.net" },
  { name: "UCEPROTECT-1", zone: "dnsbl-1.uceprotect.net" },
  { name: "SORBS", zone: "dnsbl.sorbs.net" },
];

async function checkBlocklist(ip: string, zone: string): Promise<"listed" | "clean" | "unknown"> {
  const rev = ip.split(".").reverse().join(".");
  try {
    const r = await dns.resolve4(`${rev}.${zone}`);
    // 127.255.x.x = query refused/rate-limited (not a real listing).
    return r.some((a) => a.startsWith("127.") && !a.startsWith("127.255.")) ? "listed" : "unknown";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? "clean" : "unknown";
  }
}

god.get("/reputation", async (c) => {
  requireScope(c, "metrics");
  const since = (h: number) => new Date(Date.now() - h * 3600 * 1000);

  // --- Authentication / identity stack (live DNS) ---
  const [ptrNames, spf, dkim, dmarc] = await Promise.all([
    dns.reverse(SENDING_IP).catch(() => [] as string[]),
    resolveTxt(SENDING_DOMAIN),
    resolveTxt(`${DKIM_SELECTOR}._domainkey.${SENDING_DOMAIN}`),
    resolveTxt(`_dmarc.${SENDING_DOMAIN}`),
  ]);
  const ptr = ptrNames[0] ?? null;
  // FCrDNS: the PTR hostname must resolve back to the sending IP.
  let fcrdns = false;
  if (ptr) {
    const fwd = await dns.resolve4(ptr).catch(() => [] as string[]);
    fcrdns = fwd.includes(SENDING_IP);
  }
  const spfRecords = spf.filter((t) => /^v=spf1/i.test(t));
  const auth = {
    ip: SENDING_IP,
    domain: SENDING_DOMAIN,
    ptr,
    ptrExpected: `mail.${SENDING_DOMAIN}`,
    fcrdns,
    spf: spfRecords.length === 1, // exactly one valid SPF (multiple = PERMERROR)
    spfCount: spfRecords.length,
    dkim: dkim.some((t) => /(^|;)?p=/.test(t) || /v=DKIM1/i.test(t)),
    dmarc: dmarc.some((t) => /^v=DMARC1/i.test(t)),
  };

  // --- Blocklists (live DNSBL queries) ---
  const blocklists = await Promise.all(
    DNSBLS.map(async (b) => ({ name: b.name, status: await checkBlocklist(SENDING_IP, b.zone) })),
  );

  // --- Sending health (from our data) over rolling windows ---
  async function windowStats(h: number) {
    const where = { createdAt: { gte: since(h) } };
    const [total, sent, delivered, bounced, failed, complained] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.count({ where: { ...where, status: "sent" } }),
      prisma.email.count({ where: { ...where, status: "delivered" } }),
      prisma.email.count({ where: { ...where, status: "bounced" } }),
      prisma.email.count({ where: { ...where, status: "failed" } }),
      prisma.email.count({ where: { ...where, status: "complained" } }),
    ]);
    // Accepted = handed off to the receiver (bounces/complaints were accepted first).
    const accepted = sent + delivered + bounced + complained;
    const confirmed = delivered + bounced + complained;
    return {
      total,
      sent,
      delivered,
      accepted,
      bounced,
      failed,
      complained,
      bounceRate: +((bounced / (accepted || 1)) * 100).toFixed(2),
      complaintRate: +((complained / (accepted || 1)) * 100).toFixed(3),
      acceptedRate: total ? +((accepted / total) * 100).toFixed(1) : 0,
      // Confirmed delivery, null until feedback exists — never claim unproven delivery.
      deliveredRate: confirmed ? +((delivered / confirmed) * 100).toFixed(1) : null,
    };
  }
  const [h24, d7, d30, lastDelivered] = await Promise.all([
    windowStats(24),
    windowStats(24 * 7),
    windowStats(24 * 30),
    prisma.emailEvent.findFirst({
      where: { type: "delivered" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);
  // Delivery drop: 24h confirmed-delivery rate fell more than 15 points vs 7d.
  const deliveryDrop =
    h24.deliveredRate != null &&
    d7.deliveredRate != null &&
    d7.deliveredRate - h24.deliveredRate > 15;
  // Sending with zero terminal feedback in 24h — the loop that turns "sent" into
  // delivered/bounced is silent (the surprise "deliverability went down" case).
  const staleFeedback =
    h24.accepted > 0 && h24.delivered === 0 && h24.bounced === 0 && h24.complained === 0;

  // --- 14-day volume series ---
  const series = await prisma.$queryRaw<
    { day: Date; sent: bigint; bounced: bigint }[]
  >`SELECT date_trunc('day', "createdAt") AS day,
      count(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
      count(*) FILTER (WHERE status = 'bounced') AS bounced
    FROM "Email" WHERE "createdAt" >= now() - interval '14 days'
    GROUP BY day ORDER BY day ASC`;
  const volume = series.map((r) => ({
    day: r.day,
    sent: Number(r.sent),
    bounced: Number(r.bounced),
  }));

  // --- Warmup tracker ---
  const first = await prisma.email.findFirst({
    where: { status: { in: ["sent", "delivered"] } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const dayMs = 24 * 3600 * 1000;
  const dayIndex = first
    ? Math.floor((Date.now() - first.createdAt.getTime()) / dayMs) + 1
    : 0;
  // Conservative ramp: 50 on day 1, doubling daily, capped at 100k/day.
  const recommendedToday = dayIndex
    ? Math.min(50 * 2 ** (dayIndex - 1), 100000)
    : 50;
  const sentToday = await prisma.email.count({
    where: { status: { in: ["sent", "delivered"] }, createdAt: { gte: since(24) } },
  });

  return c.json({
    auth,
    blocklists,
    health: { h24, d7, d30 },
    watchdog: {
      deliveryDrop,
      staleFeedback,
      lastDeliveredAt: lastDelivered?.occurredAt ?? null,
    },
    volume,
    warmup: { dayIndex, recommendedToday, sentToday, startedAt: first?.createdAt ?? null },
  });
});

god.get("/users", async (c) => {
  requireScope(c, "users");
  const q = c.req.query("q")?.trim();
  const users = await prisma.user.findMany({
    where: q ? { email: { contains: q, mode: "insensitive" } } : {},
    take: 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      platformAdmin: { select: { role: true } },
      memberships: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { role: true, org: { select: { id: true, name: true, plan: true } } },
      },
    },
  });
  return c.json({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      admin: u.platformAdmin?.role ?? null,
      org: u.memberships[0]?.org ?? null,
      orgRole: u.memberships[0]?.role ?? null,
    })),
  });
});

god.get("/orgs", async (c) => {
  requireScope(c, "users");
  const orgs = await prisma.organization.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
      _count: { select: { memberships: true, projects: true } },
    },
  });
  return c.json({ data: orgs });
});

const PlanId = z.enum(PLAN_IDS as [string, ...string[]]);

// Set a tenant's plan. Operator-owned orgs are auto-lifted to enterprise; this
// is how God Mode upgrades (or downgrades) everyone else.
god.patch("/orgs/:id", async (c) => {
  requireScope(c, "users");
  const id = c.req.param("id");
  const p = z
    .object({ plan: PlanId })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid plan is required.");
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, plan: true, name: true },
  });
  if (!org) throw errors.notFound("Organization not found.");
  const updated = await prisma.organization.update({
    where: { id },
    data: { plan: p.data.plan },
    select: { id: true, plan: true, name: true },
  });
  await audit(c.get("userId"), "org.plan", {
    type: "org",
    id,
    meta: { from: org.plan, to: p.data.plan, name: org.name },
  });
  return c.json(updated);
});

// Create a user (full tenant: user + org + default project), like signup.
god.post("/users", async (c) => {
  requireScope(c, "users");
  const p = z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) {
    throw errors.validation(p.error.issues.map((i) => i.message).join("; "));
  }
  const email = p.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new ApiError(409, "email_taken", "An account with that email already exists.");
  }
  const orgName = p.data.name || email.split("@")[0] || "org";
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: p.data.name ?? null,
        passwordHash: hashPassword(p.data.password),
      },
    });
    const org = await tx.organization.create({
      data: {
        name: orgName,
        slug: `${slugify(orgName)}-${Math.random().toString(36).slice(2, 7)}`,
      },
    });
    await tx.membership.create({
      data: { orgId: org.id, userId: user.id, role: "owner" },
    });
    await tx.project.create({
      data: { orgId: org.id, name: "default", slug: "default" },
    });
    return { user, org };
  });
  await audit(c.get("userId"), "user.create", {
    type: "user",
    id: created.user.id,
    meta: { email },
  });
  return c.json({ id: created.user.id, email });
});

// Delete a user. Also removes any org where they were the only member (cascades
// that org's projects/emails/domains/keys); shared orgs are kept and only the
// membership is dropped. Guarded: no self-delete, and platform admins must be
// demoted first so God Mode can't be locked out by accident.
god.delete("/users/:id", async (c) => {
  requireScope(c, "users");
  const id = c.req.param("id");
  if (id === c.get("userId")) {
    throw errors.validation("You can't delete your own account from here.");
  }
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, platformAdmin: { select: { role: true } } },
  });
  if (!user) throw errors.notFound("User not found.");
  if (user.platformAdmin) {
    throw new ApiError(
      409,
      "is_admin",
      "Remove this user's platform-admin role (Admins tab) before deleting them.",
    );
  }
  const memberships = await prisma.membership.findMany({
    where: { userId: id },
    select: { orgId: true },
  });
  let deletedOrgs = 0;
  for (const m of memberships) {
    const count = await prisma.membership.count({ where: { orgId: m.orgId } });
    if (count <= 1) {
      await prisma.organization.delete({ where: { id: m.orgId } });
      deletedOrgs++;
    }
  }
  await prisma.user.delete({ where: { id } });
  await audit(c.get("userId"), "user.delete", {
    type: "user",
    id,
    meta: { email: user.email, deletedOrgs },
  });
  return c.json({ ok: true, deletedOrgs });
});

god.get("/logs", async (c) => {
  requireScope(c, "logs");
  const [emails, audits] = await Promise.all([
    prisma.email.findMany({
      take: 40,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        from: true,
        to: true,
        subject: true,
        status: true,
        createdAt: true,
        project: { select: { org: { select: { name: true } } } },
      },
    }),
    prisma.platformAuditLog.findMany({ take: 40, orderBy: { createdAt: "desc" } }),
  ]);
  const actorIds = [...new Set(audits.map((a) => a.actorUserId))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(actors.map((a) => [a.id, a.email]));
  return c.json({
    emails: emails.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      subject: e.subject,
      status: e.status,
      org: e.project?.org.name ?? "—",
      createdAt: e.createdAt,
    })),
    audit: audits.map((a) => ({
      id: a.id,
      actor: emailById.get(a.actorUserId) ?? a.actorUserId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      meta: a.meta,
      createdAt: a.createdAt,
    })),
  });
});

// ---- Admin management ----
god.get("/admins", async (c) => {
  requireScope(c, "admins");
  const admins = await prisma.platformAdmin.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      scopes: true,
      createdAt: true,
      userId: true,
      user: { select: { email: true, name: true } },
    },
  });
  return c.json({
    data: admins.map((a) => ({
      id: a.id,
      userId: a.userId,
      email: a.user.email,
      name: a.user.name,
      role: a.role,
      scopes: a.role === "superadmin" ? [...PLATFORM_SCOPES] : a.scopes,
      createdAt: a.createdAt,
    })),
  });
});

god.post("/admins", async (c) => {
  requireSuperadmin(c);
  const p = z
    .object({
      email: z.string().email(),
      role: z.enum(["admin", "superadmin"]).default("admin"),
      scopes: z.array(z.string()).default([]),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("A valid email is required.");
  if (p.data.role === "superadmin" && c.get("platformRole") !== "superadmin") {
    throw new ApiError(403, "forbidden", "Only a superadmin can grant superadmin.");
  }
  const scopes = p.data.scopes.filter(isPlatformScope);
  const user = await prisma.user.findUnique({
    where: { email: p.data.email.toLowerCase() },
    select: { id: true },
  });
  if (!user) {
    throw new ApiError(404, "user_not_found", "That user must sign up before being made an admin.");
  }
  const existing = await prisma.platformAdmin.findUnique({ where: { userId: user.id } });
  if (existing) throw new ApiError(409, "already_admin", "That user is already a platform admin.");
  const created = await prisma.platformAdmin.create({
    data: { userId: user.id, role: p.data.role, scopes, createdById: c.get("userId") },
  });
  await grantOperatorPlan(user.id);
  await audit(c.get("userId"), "admin.add", {
    type: "user",
    id: user.id,
    meta: { email: p.data.email, role: p.data.role, scopes },
  });
  return c.json({ id: created.id, ok: true });
});

god.patch("/admins/:id", async (c) => {
  requireSuperadmin(c);
  const target = await prisma.platformAdmin.findUnique({ where: { id: c.req.param("id") } });
  if (!target) throw errors.notFound("Admin not found.");
  const p = z
    .object({
      scopes: z.array(z.string()).optional(),
      role: z.enum(["admin", "superadmin"]).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid update.");
  // Don't let the last superadmin be demoted out of existence.
  if (target.role === "superadmin" && p.data.role === "admin") {
    const supers = await prisma.platformAdmin.count({ where: { role: "superadmin" } });
    if (supers <= 1) {
      throw new ApiError(409, "last_superadmin", "Can't demote the last superadmin.");
    }
  }
  const updated = await prisma.platformAdmin.update({
    where: { id: target.id },
    data: {
      ...(p.data.scopes ? { scopes: p.data.scopes.filter(isPlatformScope) } : {}),
      ...(p.data.role ? { role: p.data.role } : {}),
    },
  });
  await grantOperatorPlan(target.userId);
  await audit(c.get("userId"), "admin.update", {
    type: "user",
    id: target.userId,
    meta: { scopes: updated.scopes, role: updated.role },
  });
  return c.json({ ok: true });
});

god.delete("/admins/:id", async (c) => {
  requireSuperadmin(c);
  const target = await prisma.platformAdmin.findUnique({ where: { id: c.req.param("id") } });
  if (!target) throw errors.notFound("Admin not found.");
  if (target.role === "superadmin") {
    const supers = await prisma.platformAdmin.count({ where: { role: "superadmin" } });
    if (supers <= 1) {
      throw new ApiError(409, "last_superadmin", "Can't remove the last superadmin.");
    }
  }
  await prisma.platformAdmin.delete({ where: { id: target.id } });
  await audit(c.get("userId"), "admin.remove", { type: "user", id: target.userId });
  return c.json({ ok: true });
});

// ---- Impersonation (real, audited, reversible) ----
god.post("/impersonate/:userId", async (c) => {
  requireScope(c, "impersonate");
  const totpBody = z.object({ totp: z.string() }).safeParse(await c.req.json().catch(() => null));
  const adminRow = await prisma.platformAdmin.findUnique({
    where: { userId: c.get("userId") },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (!adminRow?.totpEnabledAt || !adminRow.totpSecret) throw errors.totpRequired();
  if (!totpBody.success || !verifyTotp(decryptSecret(adminRow.totpSecret), totpBody.data.totp)) {
    throw errors.totpInvalid();
  }
  const userId = c.req.param("userId");
  if (userId === c.get("userId")) {
    throw errors.validation("You can't impersonate yourself.");
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, tokenVersion: true },
  });
  if (!target) throw errors.notFound("User not found.");
  // Bind the impersonation token to the admin's current tokenVersion so that
  // logging the admin out (or forcing a bump) immediately voids it.
  const adminUser = await prisma.user.findUnique({
    where: { id: c.get("userId") },
    select: { tokenVersion: true },
  });
  const membership = await prisma.membership.findFirst({
    where: { userId: target.id },
    include: { org: { include: { projects: { take: 1 } } } },
  });
  if (!membership || !membership.org.projects[0]) {
    throw new ApiError(409, "no_workspace", "That user has no workspace to impersonate.");
  }
  // Preserve the admin's own session so impersonation is reversible.
  const adminToken = getCookie(c, SESSION_COOKIE);
  if (adminToken) {
    setCookie(c, GOD_COOKIE, adminToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: IMPERSONATE_MAX_AGE,
    });
  }
  const token = await sign(
    {
      sub: target.id,
      ver: target.tokenVersion,
      imp: c.get("userId"),
      impVer: adminUser?.tokenVersion ?? 0,
      exp: Math.floor(Date.now() / 1000) + IMPERSONATE_MAX_AGE,
    },
    env.AUTH_SECRET,
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: IMPERSONATE_MAX_AGE,
  });
  await audit(c.get("userId"), "impersonate.start", {
    type: "user",
    id: target.id,
    meta: { email: target.email },
  });
  return c.json({ ok: true, user: { id: target.id, email: target.email } });
});
