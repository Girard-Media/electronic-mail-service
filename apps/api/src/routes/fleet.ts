import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@ems/db";
import { errors, generateDkimKeypair, encryptSecret } from "@ems/core";
import {
  canTransition,
  DOMAIN_TRANSITIONS,
  MAILBOX_TRANSITIONS,
  dailyCapacity,
  normalizeLocalPart,
  isRoleLocalPart,
  isValidLocalPart,
  mailboxSlotError,
  MAX_MAILBOXES_PER_DOMAIN,
  normalizePostalAddress,
  postalAddressError,
  personaSignature,
  nextStatusAfterDns,
  warmDomainError,
  activateDomainError,
  warmMailboxError,
  activateMailboxError,
  type DomainStatus,
  type MailboxStatus,
} from "@ems/fleet";
import { checkFleetAuth, fleetDnsBlueprint } from "../lib/fleet-dns.js";
import type { SessionVars } from "../middleware/session.js";

const AGE_MS = 14 * 24 * 3600_000;

export const fleet = new Hono<{ Variables: SessionVars }>();

const nameSchema = z.string().min(3).transform((s) =>
  s.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
);

/** Find a CAMPAIGN node or create a PROVISIONING stub so mailbox rows can exist before Epic 03 hardware. */
async function ensureCampaignNode(orgId: string): Promise<string> {
  const existing = await prisma.blastNode.findFirst({
    where: {
      role: "CAMPAIGN",
      status: { not: "RETIRED" },
      OR: [{ orgId }, { orgId: null }],
    },
    orderBy: [{ orgId: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (existing) return existing.id;
  const slug = orgId.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "org";
  const node = await prisma.blastNode.create({
    data: {
      orgId,
      name: `campaign-${slug}`,
      hostname: `mta-${slug}.pending.electronicmailservices.com`,
      role: "CAMPAIGN",
      status: "PROVISIONING",
      relayTestOk: false,
      dkimTestOk: false,
      egress25Ok: false,
      notes: "Stub node auto-created so mailboxes can be registered. Not routable until 90-verify.sh passes.",
    },
  });
  const n = Number.parseInt(node.id.replace(/\D/g, "").slice(-6) || "1", 10) % 65_000;
  await prisma.sendingIp.create({
    data: {
      nodeId: node.id,
      address: `10.254.${Math.floor(n / 256)}.${n % 256}`,
      status: "NEW",
      pool: "default",
    },
  });
  return node.id;
}

async function defaultIpId(nodeId: string): Promise<string | null> {
  const ip = await prisma.sendingIp.findFirst({
    where: { nodeId, status: { in: ["ACTIVE", "WARMING", "NEW"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return ip?.id ?? null;
}

function domainView(d: {
  id: string;
  name: string;
  status: string;
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  mxOk: boolean;
  ageReadyAt: Date | null;
  dkimSelector: string;
  dkimPublicKey: string | null;
  postalAddress: string | null;
  dailyCap: number;
  dnsIssues: string[];
}) {
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    spfOk: d.spfOk,
    dkimOk: d.dkimOk,
    dmarcOk: d.dmarcOk,
    mxOk: d.mxOk,
    ageReadyAt: d.ageReadyAt,
    postalAddress: d.postalAddress,
    dailyCap: d.dailyCap,
    dnsIssues: d.dnsIssues,
    records: d.dkimPublicKey ? fleetDnsBlueprint(d.name, d.dkimPublicKey) : [],
  };
}

fleet.get("/domains", async (c) => {
  const orgId = c.get("orgId");
  const rows = await prisma.fleetDomain.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { mailboxes: true } } },
  });
  return c.json({
    data: rows.map((d) => ({ ...domainView(d), mailboxCount: d._count.mailboxes })),
  });
});

fleet.post("/domains", async (c) => {
  const parsed = z.object({
    name: nameSchema,
    postalAddress: z.string().optional(),
    siteUrl: z.string().url().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("A domain name is required.");
  const orgId = c.get("orgId");
  const name = parsed.data.name;
  if (parsed.data.postalAddress) {
    const err = postalAddressError(parsed.data.postalAddress);
    if (err) throw errors.validation(err);
  }
  const taken = await prisma.fleetDomain.findUnique({ where: { name } });
  if (taken) throw errors.conflict("domain_taken", `The domain "${name}" is already registered.`);

  const keys = generateDkimKeypair("ems");
  const nodeId = await ensureCampaignNode(orgId);
  const ipId = await defaultIpId(nodeId);
  const row = await prisma.fleetDomain.create({
    data: {
      orgId,
      name,
      status: "REGISTERED",
      registeredAt: new Date(),
      dkimSelector: keys.selector,
      dkimPublicKey: keys.publicKey,
      dkimPrivateEnc: encryptSecret(keys.privateKey),
      postalAddress: parsed.data.postalAddress
        ? normalizePostalAddress(parsed.data.postalAddress)
        : null,
      siteUrl: parsed.data.siteUrl ?? null,
      ipId,
    },
  });
  return c.json({ data: domainView(row) }, 201);
});

fleet.get("/domains/:id", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetDomain.findFirst({
    where: { id: c.req.param("id"), orgId },
    include: { mailboxes: { select: { id: true, address: true, status: true, dailyCap: true } } },
  });
  if (!row) throw errors.notFound("Domain not found.");
  return c.json({ data: { ...domainView(row), mailboxes: row.mailboxes } });
});

fleet.post("/domains/:id/verify", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetDomain.findFirst({ where: { id: c.req.param("id"), orgId } });
  if (!row) throw errors.notFound("Domain not found.");
  const { flags, issues } = await checkFleetAuth(row.name, row.dkimPublicKey);
  let status = row.status as DomainStatus;
  const first = nextStatusAfterDns(status, flags);
  if (first !== status && canTransition(DOMAIN_TRANSITIONS, status, first)) status = first;
  const second = nextStatusAfterDns(status, flags);
  if (second !== status && canTransition(DOMAIN_TRANSITIONS, status, second)) status = second;
  const ageReadyAt =
    status === "AGING" && !row.ageReadyAt ? new Date(Date.now() + AGE_MS) : row.ageReadyAt;
  const updated = await prisma.fleetDomain.update({
    where: { id: row.id },
    data: { ...flags, dnsIssues: issues, lastDnsCheckAt: new Date(), status, ageReadyAt },
  });
  return c.json({ data: domainView(updated) });
});

fleet.post("/domains/:id/warm", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetDomain.findFirst({ where: { id: c.req.param("id"), orgId } });
  if (!row) throw errors.notFound("Domain not found.");
  const err = warmDomainError(row.status, row, row.ageReadyAt, new Date());
  if (err) throw errors.conflict("not_warmable", err);
  const updated = await prisma.fleetDomain.update({
    where: { id: row.id },
    data: { status: "WARMING" },
  });
  return c.json({ data: domainView(updated) });
});

fleet.post("/domains/:id/activate", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetDomain.findFirst({ where: { id: c.req.param("id"), orgId } });
  if (!row) throw errors.notFound("Domain not found.");
  const err = activateDomainError(row.status, row);
  if (err) throw errors.conflict("not_activatable", err);
  const updated = await prisma.fleetDomain.update({
    where: { id: row.id },
    data: { status: "ACTIVE" },
  });
  return c.json({ data: domainView(updated) });
});

fleet.get("/personas", async (c) => {
  const rows = await prisma.persona.findMany({
    where: { orgId: c.get("orgId") },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ data: rows });
});

fleet.post("/personas", async (c) => {
  const parsed = z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    title: z.string().trim().max(120).optional(),
    companyName: z.string().trim().min(1).max(160),
    postalAddress: z.string(),
    linkedinUrl: z.string().url().optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("firstName, lastName, companyName, and postalAddress are required.");
  const addrErr = postalAddressError(parsed.data.postalAddress);
  if (addrErr) throw errors.validation(addrErr);
  const postalAddress = normalizePostalAddress(parsed.data.postalAddress);
  const sig = personaSignature({ ...parsed.data, postalAddress });
  const row = await prisma.persona.create({
    data: {
      orgId: c.get("orgId"),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      title: parsed.data.title ?? null,
      companyName: parsed.data.companyName,
      postalAddress,
      linkedinUrl: parsed.data.linkedinUrl ?? null,
      signatureText: sig.text,
      signatureHtml: sig.html,
    },
  });
  return c.json({ data: row }, 201);
});

fleet.get("/mailboxes", async (c) => {
  const domainId = c.req.query("domainId") || undefined;
  const rows = await prisma.fleetMailbox.findMany({
    where: { orgId: c.get("orgId"), ...(domainId ? { domainId } : {}) },
    orderBy: { address: "asc" },
    include: { domain: { select: { name: true, status: true } }, persona: true },
  });
  return c.json({ data: rows });
});

fleet.post("/mailboxes", async (c) => {
  const parsed = z.object({
    domainId: z.string().min(1),
    localPart: z.string().min(1),
    personaId: z.string().min(1),
    dailyCap: z.number().int().min(1).max(50).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw errors.validation("domainId, localPart, and personaId are required.");
  const orgId = c.get("orgId");
  const local = normalizeLocalPart(parsed.data.localPart);
  if (!isValidLocalPart(local)) throw errors.validation("localPart must be a simple mailbox name.");
  if (isRoleLocalPart(local)) {
    throw errors.validation("Role-style local parts (info, sales, noreply, admin, …) cannot send campaigns.");
  }
  const domain = await prisma.fleetDomain.findFirst({ where: { id: parsed.data.domainId, orgId } });
  if (!domain) throw errors.notFound("Domain not found.");
  const persona = await prisma.persona.findFirst({ where: { id: parsed.data.personaId, orgId } });
  if (!persona) throw errors.notFound("Persona not found.");
  const live = await prisma.fleetMailbox.count({
    where: { domainId: domain.id, status: { notIn: ["RETIRED", "BURNED"] } },
  });
  const slot = mailboxSlotError(live, MAX_MAILBOXES_PER_DOMAIN);
  if (slot) throw errors.conflict("mailbox_cap", slot);

  const nodeId = await ensureCampaignNode(orgId);

  const address = `${local}@${domain.name}`;
  const exists = await prisma.fleetMailbox.findUnique({ where: { address } });
  if (exists) throw errors.conflict("mailbox_exists", `${address} is already in the fleet.`);

  const row = await prisma.fleetMailbox.create({
    data: {
      orgId,
      domainId: domain.id,
      nodeId,
      personaId: persona.id,
      localPart: local,
      address,
      displayName: `${persona.firstName} ${persona.lastName}`.trim(),
      dailyCap: parsed.data.dailyCap ?? 5,
      status: "CREATED",
    },
  });
  const caps = await prisma.fleetMailbox.findMany({
    where: { domainId: domain.id, status: { notIn: ["RETIRED", "BURNED"] } },
    select: { hardCap: true },
  });
  await prisma.fleetDomain.update({
    where: { id: domain.id },
    data: { dailyCap: dailyCapacity(caps.map((m) => m.hardCap)) },
  });
  return c.json({ data: row }, 201);
});

fleet.post("/mailboxes/:id/warm", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetMailbox.findFirst({
    where: { id: c.req.param("id"), orgId },
    include: { domain: true },
  });
  if (!row) throw errors.notFound("Mailbox not found.");
  const err = warmMailboxError(row.status as MailboxStatus, row.domain.status as DomainStatus);
  if (err) throw errors.conflict("not_warmable", err);
  const updated = await prisma.fleetMailbox.update({
    where: { id: row.id },
    data: { status: "WARMING", warmupDay: 0 },
  });
  return c.json({ data: updated });
});

fleet.post("/mailboxes/:id/activate", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetMailbox.findFirst({
    where: { id: c.req.param("id"), orgId },
    include: { domain: true },
  });
  if (!row) throw errors.notFound("Mailbox not found.");
  const err = activateMailboxError(row.status as MailboxStatus, row.domain.status as DomainStatus);
  if (err) throw errors.conflict("not_activatable", err);
  const updated = await prisma.fleetMailbox.update({
    where: { id: row.id },
    data: { status: "ACTIVE" },
  });
  return c.json({ data: updated });
});

fleet.post("/mailboxes/:id/pause", async (c) => {
  const orgId = c.get("orgId");
  const row = await prisma.fleetMailbox.findFirst({ where: { id: c.req.param("id"), orgId } });
  if (!row) throw errors.notFound("Mailbox not found.");
  if (!canTransition(MAILBOX_TRANSITIONS, row.status as MailboxStatus, "PAUSED")) {
    throw errors.conflict("not_pausable", `A ${row.status} mailbox cannot be paused.`);
  }
  const updated = await prisma.fleetMailbox.update({
    where: { id: row.id },
    data: { status: "PAUSED" },
  });
  return c.json({ data: updated });
});
