import { Hono } from "hono";
import { z } from "zod";
import {
  analyzeMailHealth,
  errors,
  ApiError,
  generateDkimKeypair,
  domainDnsRecords,
  encryptSecret,
  isUnlimited,
  withinLimit,
  planLimits,
  type DnsRecord,
} from "@ems/core";
import { prisma, Prisma } from "@ems/db";
import { apiKeyAuth, requireFullAccess, type ApiVariables } from "../middleware/auth.js";
import { checkDomainRecords } from "../lib/domain-records.js";
import { assertVerifiedNameFree, markDomainVerified } from "../lib/domain-claim.js";

// Public (API-key) domain API: telemetry plus full CRUD, so a customer or an
// agent can add a sending domain, read the DNS records to publish, and verify
// it — the whole onboarding — without touching the dashboard.
export const domains = new Hono<{ Variables: ApiVariables }>();

domains.use("*", apiKeyAuth);

// GET /domains/health?domain=acme.com — mxtoolbox-grade mail-health report:
// MX, SPF (with recursive 10-lookup counting), DMARC policy, DKIM selectors, the
// detected sending platforms, a 0-100 score, and prioritized risks.
domains.get("/health", async (c) => {
  const domain = c.req.query("domain");
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    throw errors.validation("Provide a valid ?domain=example.com");
  }
  const dkim = c.req.query("dkim");
  return c.json(
    await analyzeMailHealth(domain, dkim ? { dkimSelectors: dkim.split(",") } : {}),
  );
});


// --- Domain management (full-access keys only) -----------------------------
// Mirrors the dashboard flow so a domain added over the API is identical to one
// added in the UI: mint a DKIM keypair, hand back the records to publish, then
// verify against live DNS.

const normalizeName = (raw: string) =>
  raw.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

// GET /domains — list this project's sending domains.
domains.get("/", async (c) => {
  const data = await prisma.domain.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, verifiedAt: true, createdAt: true },
  });
  return c.json({ data });
});

// POST /domains — add a sending domain; returns the DNS records to publish.
domains.post("/", async (c) => {
  requireFullAccess(c);
  const p = z
    .object({ name: z.string().min(3) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("A domain name is required.");
  const name = normalizeName(p.data.name);
  const projectId = c.get("projectId");
  await assertVerifiedNameFree(name, projectId);

  // Re-adding a stuck (pending/failed) domain re-surfaces its records rather
  // than 409ing, and keeps the existing keypair so anything already published
  // still matches. A verified domain is left alone.
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

  // Plan gate: sending domains are capped org-wide.
  const org = await prisma.organization.findUnique({
    where: { id: c.get("orgId") },
    select: { plan: true },
  });
  const limits = planLimits(org?.plan);
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
      // Encrypted at rest; decrypted only in the worker to sign.
      dkimPrivateKey: encryptSecret(k.privateKey),
      status: "pending",
      dnsRecords: records,
    },
    select: { id: true, name: true, status: true },
  });
  return c.json({ ...domain, records }, 201);
});

// GET /domains/:id — one domain plus the records it needs published.
domains.get("/:id", async (c) => {
  const domain = await prisma.domain.findFirst({
    where: { id: c.req.param("id"), projectId: c.get("projectId") },
    select: {
      id: true, name: true, status: true, verifiedAt: true,
      createdAt: true, dnsRecords: true,
    },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const { dnsRecords, ...rest } = domain;
  return c.json({ ...rest, records: (dnsRecords as unknown as DnsRecord[]) ?? [] });
});

// POST /domains/:id/verify — re-check live DNS and flip status. DKIM is the gate.
domains.post("/:id/verify", async (c) => {
  requireFullAccess(c);
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  const { checks, dkimOk } = await checkDomainRecords(domain);
  if (dkimOk) await markDomainVerified(id, domain.name, domain.projectId);
  else {
    await prisma.domain.update({
      where: { id },
      data: { status: "failed", verifiedAt: null },
    });
  }
  const updated = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true, name: true, status: true },
  });
  return c.json({ ...updated, verified: dkimOk, records: checks });
});

// DELETE /domains/:id — remove a sending domain. Sending from it stops immediately.
domains.delete("/:id", async (c) => {
  requireFullAccess(c);
  const id = c.req.param("id");
  const domain = await prisma.domain.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true },
  });
  if (!domain) throw errors.notFound("Domain not found.");
  await prisma.domain.delete({ where: { id } });
  return c.json({ id, deleted: true });
});
