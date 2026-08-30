import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  ApiError,
  errors,
  env,
  isSharedInboxDomain,
  isUnlimited,
  mailboxReceivingStatus,
  parseSharedInboxDomains,
  validateInboxUsername,
  withinLimit,
  sharedInboxSendDecision,
} from "@ems/core";
import { prisma, Prisma } from "@ems/db";
import { apiKeyAuth, requireFullAccess, type ApiVariables } from "../middleware/auth.js";
import { sendFromMailbox, replyToMessage } from "../lib/mailbox-actions.js";
import { effectiveOrgPlan } from "../lib/operator-plan.js";
import { orgOwnerEmailVerified } from "../lib/owner-verified.js";

// Public (API-key) inbox API — the agent-email surface (planning/AGENT_EMAIL.md
// A1) and the no-Workspace inbox surface (planning/INBOX_MODES.md). Gives a
// caller a real two-way mailbox: instant `name@<shared domain>` with zero DNS,
// or `name@customer-domain` on a verified sending domain. Same
// machinery as the dashboard Inbox (one Mailbox/Message store, one MTA), so an
// inbox created here is fully visible in the dashboard and vice versa.
//
// Key scoping: inbox lifecycle (create/update/delete) is management → requires
// a full-access key. Reading and sending messages works with either key kind —
// that's the day-loop of an agent holding the key you pasted into it. Per-key
// inbox allowlists are the planned follow-up (AGENT_EMAIL.md).
export const inboxes = new Hono<{ Variables: ApiVariables }>();

inboxes.use("*", apiKeyAuth);

const FOLDERS = ["inbox", "sent", "archive", "spam", "trash"] as const;

const inboxShape = (m: {
  id: string;
  address: string;
  displayName: string | null;
  status: string;
  domainId: string | null;
  createdAt: Date;
}) => ({
  id: m.id,
  address: m.address,
  display_name: m.displayName,
  status: m.status,
  kind: m.domainId ? "custom" : "shared",
  created_at: m.createdAt,
});

const messageRow = (m: {
  id: string;
  threadId?: string | null;
  fromAddr: string;
  subject: string | null;
  snippet: string | null;
  seen: boolean;
  folder?: string;
  receivedAt: Date;
}) => ({
  id: m.id,
  thread_id: m.threadId ?? m.id,
  from: m.fromAddr,
  subject: m.subject,
  snippet: m.snippet,
  seen: m.seen,
  ...(m.folder !== undefined ? { folder: m.folder } : {}),
  received_at: m.receivedAt,
});

async function ownMailbox(c: { get(k: "projectId"): string }, id: string) {
  const mb = await prisma.mailbox.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true, address: true, domainId: true, status: true },
  });
  if (!mb) throw errors.notFound("Inbox not found.");
  return mb;
}

// POST /inboxes — create an inbox. Omit `domain` for an instant shared-domain
// inbox (no DNS); pass a verified sending domain of this project to place the
// inbox there. Omit `username` to get a generated one (shared domain only).
inboxes.post("/", async (c) => {
  requireFullAccess(c);
  const p = z
    .object({
      username: z.string().min(1).max(64).optional(),
      domain: z.string().min(3).optional(),
      display_name: z.string().max(80).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) throw errors.validation("Invalid inbox payload.");
  const projectId = c.get("projectId");

  // Plan gate: hosted inboxes are capped org-wide (shared-domain addresses live
  // on OUR domain — an uncapped free tier is an address-squatting vector).
  const { limits } = await effectiveOrgPlan(c.get("orgId"));
  if (!isUnlimited(limits.mailboxes)) {
    const count = await prisma.mailbox.count({
      where: { project: { orgId: c.get("orgId") } },
    });
    if (!withinLimit(count, limits.mailboxes)) {
      throw errors.planLimit(
        `Your plan includes ${limits.mailboxes} inbox${limits.mailboxes === 1 ? "" : "es"}. Upgrade to add more.`,
      );
    }
  }

  // Three placements: (a) no `domain` → the default shared domain; (b) a
  // shared domain by name; (c) a verified sending domain of this project.
  const shared = parseSharedInboxDomains(env.SHARED_INBOX_DOMAINS);
  const wantDomain = p.data.domain?.toLowerCase().trim();
  const sharedTarget = wantDomain
    ? isSharedInboxDomain(wantDomain, shared) ? wantDomain : null
    : shared[0] ?? null;
  const custom = Boolean(wantDomain && !sharedTarget);
  if (!custom && !sharedTarget) {
    throw errors.validation("No shared inbox domain is configured — pass a verified `domain`.");
  }

  if (!custom) {
    const decision = sharedInboxSendDecision({
      internal: false,
      ownerVerified: await orgOwnerEmailVerified(c.get("orgId")),
      sendingEnabled: env.SHARED_INBOX_SENDING !== "off",
    });
    if (decision === "killed") throw errors.sharedInboxSendingDisabled();
    if (decision === "need_verification") throw errors.emailUnverified();
  }

  let domainId: string | null = null;
  if (custom) {
    const domain = await prisma.domain.findFirst({
      where: { projectId, name: wantDomain, status: "verified" },
      select: { id: true },
    });
    if (!domain) {
      throw errors.validation(
        `Add and verify the domain ${wantDomain} before creating an inbox there.`,
      );
    }
    domainId = domain.id;
    if (!p.data.username) {
      throw errors.validation("A username is required for a custom-domain inbox.");
    }
  }

  // Shared-domain usernames are strict (they live on our domain — a hostile
  // local-part is a phishing surface). Custom-domain usernames get the same
  // rule minus the reserved list: the customer owns that namespace.
  const validated = p.data.username ? validateInboxUsername(p.data.username) : null;
  if (validated && !validated.ok) {
    if (!custom || !/reserved/.test(validated.message)) {
      throw errors.validation(validated.message);
    }
  }
  const chosen = validated?.ok ? validated.username : p.data.username?.toLowerCase();

  // Up to 3 attempts when the username is generated (collision → new suffix);
  // a caller-chosen username conflicts as an honest 409 instead.
  for (let attempt = 0; ; attempt++) {
    const username = chosen ?? `agent-${randomBytes(4).toString("hex")}`;
    const address = `${username}@${custom ? wantDomain : sharedTarget}`;
    try {
      const mb = await prisma.mailbox.create({
        data: { projectId, domainId, address, displayName: p.data.display_name },
        select: {
          id: true, address: true, displayName: true, status: true,
          domainId: true, createdAt: true,
        },
      });
      return c.json(inboxShape(mb), 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (!chosen && attempt < 2) continue;
        throw new ApiError(409, "inbox_taken", `The address ${address} is already taken.`);
      }
      throw e;
    }
  }
});

// GET /inboxes — list this project's inboxes with message/unread counts.
inboxes.get("/", async (c) => {
  const list = await prisma.mailbox.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, address: true, displayName: true, status: true,
      domainId: true, createdAt: true,
      _count: { select: { messages: true } },
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
      ...inboxShape(m),
      messages: m._count.messages,
      unread: unreadBy[m.id] ?? 0,
    })),
  });
});

// GET /inboxes/domains — the shared domains an inbox can be claimed on right
// now, each with live receive-readiness. Declared BEFORE /:id so Hono doesn't
// match "domains" as an inbox id. Honesty surface: a shared domain whose MX
// isn't ours yet can SEND but not RECEIVE, and the caller should know before
// handing the address out.
inboxes.get("/domains", async (c) => {
  const shared = parseSharedInboxDomains(env.SHARED_INBOX_DOMAINS);
  const data = await Promise.all(
    shared.map(async (name, i) => {
      let receiving = false;
      try {
        receiving = (await mailboxReceivingStatus(name)).ready;
      } catch {
        receiving = false; // fail closed — never claim receiving we can't prove
      }
      return { domain: name, default: i === 0, receiving };
    }),
  );
  return c.json({ data });
});

// GET /inboxes/:id
inboxes.get("/:id", async (c) => {
  const mb = await prisma.mailbox.findFirst({
    where: { id: c.req.param("id"), projectId: c.get("projectId") },
    select: {
      id: true, address: true, displayName: true, status: true,
      domainId: true, createdAt: true, keepCopy: true, catchAll: true,
      usedBytes: true, quotaBytes: true,
      _count: { select: { messages: true } },
    },
  });
  if (!mb) throw errors.notFound("Inbox not found.");
  return c.json({
    ...inboxShape(mb),
    keep_copy: mb.keepCopy,
    catch_all: mb.catchAll,
    used_bytes: Number(mb.usedBytes),
    quota_bytes: Number(mb.quotaBytes),
    messages: mb._count.messages,
  });
});

// PATCH /inboxes/:id — display_name / keep_copy; catch_all only exists for
// custom-domain inboxes (the shared domain has no per-tenant namespace to catch).
inboxes.patch("/:id", async (c) => {
  requireFullAccess(c);
  const p = z
    .object({
      display_name: z.string().max(80).optional(),
      keep_copy: z.boolean().optional(),
      catch_all: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid inbox update.");
  const mb = await ownMailbox(c, c.req.param("id"));
  if (p.data.catch_all !== undefined && !mb.domainId) {
    throw errors.validation("catch_all is only available on custom-domain inboxes.");
  }
  const base = {
    ...(p.data.display_name !== undefined ? { displayName: p.data.display_name } : {}),
    ...(p.data.keep_copy !== undefined ? { keepCopy: p.data.keep_copy } : {}),
  };
  if (p.data.catch_all === true && mb.domainId) {
    // At most one catch-all per domain (partial unique index) — demote any other.
    await prisma.$transaction([
      prisma.mailbox.updateMany({
        where: { domainId: mb.domainId, catchAll: true, NOT: { id: mb.id } },
        data: { catchAll: false },
      }),
      prisma.mailbox.update({ where: { id: mb.id }, data: { ...base, catchAll: true } }),
    ]);
  } else {
    await prisma.mailbox.update({
      where: { id: mb.id },
      data: { ...base, ...(p.data.catch_all !== undefined ? { catchAll: p.data.catch_all } : {}) },
    });
  }
  return c.json({ id: mb.id, updated: true });
});

// DELETE /inboxes/:id — messages cascade; the address is freed for re-registration.
inboxes.delete("/:id", async (c) => {
  requireFullAccess(c);
  const mb = await ownMailbox(c, c.req.param("id"));
  await prisma.mailbox.delete({ where: { id: mb.id } });
  return c.json({ id: mb.id, deleted: true });
});

// GET /inboxes/:id/messages?folder=&q=&limit=&before= — newest first.
inboxes.get("/:id/messages", async (c) => {
  const mb = await ownMailbox(c, c.req.param("id"));
  const folderQ = c.req.query("folder") ?? "inbox";
  if (folderQ !== "all" && !FOLDERS.includes(folderQ as (typeof FOLDERS)[number])) {
    throw errors.validation(`folder must be one of ${FOLDERS.join(", ")}, or "all".`);
  }
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const beforeRaw = c.req.query("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime())) {
    throw errors.validation("before must be an ISO-8601 timestamp.");
  }
  const msgs = await prisma.message.findMany({
    where: {
      mailboxId: mb.id,
      ...(folderQ === "all" ? {} : { folder: folderQ }),
      ...(before ? { receivedAt: { lt: before } } : {}),
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
    take: limit,
    select: {
      id: true, threadId: true, fromAddr: true, subject: true, snippet: true,
      seen: true, folder: true, receivedAt: true,
    },
  });
  return c.json({
    data: msgs.map(messageRow),
    // Cursor for the next page — pass back as ?before=.
    next_before: msgs.length === limit ? msgs[msgs.length - 1]!.receivedAt : null,
  });
});

// GET /inboxes/:id/messages/:mid — full body. Unlike the dashboard, reading
// over the API does NOT auto-mark seen (agents track their own state; use PATCH).
inboxes.get("/:id/messages/:mid", async (c) => {
  const mb = await ownMailbox(c, c.req.param("id"));
  const m = await prisma.message.findFirst({
    where: { id: c.req.param("mid"), mailboxId: mb.id },
    select: {
      id: true, threadId: true, messageId: true, inReplyTo: true,
      fromAddr: true, toAddrs: true, subject: true, snippet: true,
      text: true, html: true, seen: true, flagged: true, folder: true,
      receivedAt: true,
    },
  });
  if (!m) throw errors.notFound("Message not found.");
  return c.json({
    ...messageRow(m),
    to: m.toAddrs,
    message_id: m.messageId,
    in_reply_to: m.inReplyTo,
    text: m.text,
    html: m.html,
    flagged: m.flagged,
  });
});

// PATCH /inboxes/:id/messages/:mid — seen / flagged / folder.
inboxes.patch("/:id/messages/:mid", async (c) => {
  const mb = await ownMailbox(c, c.req.param("id"));
  const p = z
    .object({
      seen: z.boolean().optional(),
      flagged: z.boolean().optional(),
      folder: z.enum(FOLDERS).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw errors.validation("Invalid message update.");
  const { count } = await prisma.message.updateMany({
    where: { id: c.req.param("mid"), mailboxId: mb.id },
    data: {
      ...(p.data.seen !== undefined ? { seen: p.data.seen } : {}),
      ...(p.data.flagged !== undefined ? { flagged: p.data.flagged } : {}),
      ...(p.data.folder !== undefined ? { folder: p.data.folder } : {}),
    },
  });
  if (!count) throw errors.notFound("Message not found.");
  return c.json({ id: c.req.param("mid"), updated: true });
});

// POST /inboxes/:id/send — compose FROM this inbox. Returns the Email id so the
// caller can track delivery on GET /emails/:id, plus the sent-folder copy.
inboxes.post("/:id/send", async (c) => {
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
  const mb = await ownMailbox(c, c.req.param("id"));
  const r = await sendFromMailbox(c.get("projectId"), mb.id, p.data);
  return c.json({ id: r.emailId, message_id: r.messageId });
});

// POST /inboxes/:id/messages/:mid/reply — reply to a received message from this
// inbox, carrying In-Reply-To/References so it threads at the other end too.
inboxes.post("/:id/messages/:mid/reply", async (c) => {
  const p = z
    .object({ text: z.string().optional(), html: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success || (!p.data.text && !p.data.html)) {
    throw errors.validation("A reply body (text or html) is required.");
  }
  const mb = await ownMailbox(c, c.req.param("id"));
  const mid = c.req.param("mid");
  const belongs = await prisma.message.findFirst({
    where: { id: mid, mailboxId: mb.id },
    select: { id: true },
  });
  if (!belongs) throw errors.notFound("Message not found.");
  const r = await replyToMessage(c.get("projectId"), mid, p.data);
  return c.json({ id: r.emailId, message_id: r.messageId, thread_id: r.threadId });
});

// GET /inboxes/:id/threads — conversations, newest activity first. A message
// with no threadId is a single-message thread keyed by its own id.
inboxes.get("/:id/threads", async (c) => {
  const mb = await ownMailbox(c, c.req.param("id"));
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const groups = await prisma.$queryRaw<
    Array<{ thread_id: string; message_count: number; last_at: Date; unread: boolean }>
  >`
    SELECT COALESCE(m."threadId", m."id") AS thread_id,
           COUNT(*)::int                  AS message_count,
           MAX(m."receivedAt")            AS last_at,
           BOOL_OR(NOT m."seen" AND m."folder" = 'inbox') AS unread
    FROM "Message" m
    WHERE m."mailboxId" = ${mb.id}
    GROUP BY 1
    ORDER BY last_at DESC
    LIMIT ${limit}
  `;
  if (!groups.length) return c.json({ data: [] });
  // Latest message per thread for subject/from/snippet, resolved in one query.
  const ids = groups.map((g) => g.thread_id);
  const latest = await prisma.message.findMany({
    where: {
      mailboxId: mb.id,
      OR: [{ threadId: { in: ids } }, { id: { in: ids } }],
    },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true, threadId: true, fromAddr: true, subject: true,
      snippet: true, seen: true, receivedAt: true,
    },
  });
  const head = new Map<string, (typeof latest)[number]>();
  for (const m of latest) {
    const key = m.threadId ?? m.id;
    if (!head.has(key)) head.set(key, m); // list is newest-first
  }
  return c.json({
    data: groups.map((g) => {
      const h = head.get(g.thread_id);
      return {
        id: g.thread_id,
        message_count: g.message_count,
        unread: g.unread,
        last_at: g.last_at,
        subject: h?.subject ?? null,
        from: h?.fromAddr ?? null,
        snippet: h?.snippet ?? null,
      };
    }),
  });
});

// GET /inboxes/:id/threads/:tid — the conversation, oldest first.
inboxes.get("/:id/threads/:tid", async (c) => {
  const mb = await ownMailbox(c, c.req.param("id"));
  const tid = c.req.param("tid");
  const msgs = await prisma.message.findMany({
    where: { mailboxId: mb.id, OR: [{ threadId: tid }, { id: tid }] },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true, threadId: true, fromAddr: true, toAddrs: true, subject: true,
      snippet: true, text: true, html: true, seen: true, folder: true,
      receivedAt: true,
    },
  });
  if (!msgs.length) throw errors.notFound("Thread not found.");
  return c.json({
    id: tid,
    data: msgs.map((m) => ({ ...messageRow(m), to: m.toAddrs, text: m.text, html: m.html })),
  });
});
