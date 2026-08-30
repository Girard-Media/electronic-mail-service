import { Hono } from "hono";
import { sendEmailSchema, errors } from "@ems/core";
import { prisma } from "@ems/db";
import { apiKeyAuth, type ApiVariables } from "../middleware/auth.js";
import { enqueueEmail, cancelEmail } from "../lib/send.js";

export const emails = new Hono<{ Variables: ApiVariables }>();

emails.use("*", apiKeyAuth);

// POST /emails — drop-in send (FR-030..032)
emails.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sendEmailSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.validation(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const result = await enqueueEmail(
    c.get("projectId"),
    parsed.data,
    c.req.header("Idempotency-Key") ?? null,
  );
  return c.json(result);
});

// POST /emails/batch (FR-031)
emails.post("/batch", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body)) {
    throw errors.validation("Batch body must be an array of email payloads.");
  }
  if (body.length === 0 || body.length > 100) {
    throw errors.validation("Batch must contain between 1 and 100 messages.");
  }
  const projectId = c.get("projectId");
  const data: Array<{ id: string } | { error: string }> = [];
  for (const item of body) {
    const parsed = sendEmailSchema.safeParse(item);
    if (!parsed.success) {
      data.push({ error: parsed.error.issues[0]?.message ?? "invalid payload" });
      continue;
    }
    try {
      data.push(await enqueueEmail(projectId, parsed.data, null));
    } catch (e) {
      data.push({ error: e instanceof Error ? e.message : "failed" });
    }
  }
  return c.json({ data });
});

// POST /emails/:id/cancel — pull back a scheduled/queued message before it sends.
// Declared before GET /:id purely for readability; Hono matches on method + path.
emails.post("/:id/cancel", async (c) => {
  const result = await cancelEmail(c.get("projectId"), c.req.param("id"));
  return c.json(result);
});

// GET /emails/:id — message + event timeline (FR-051), project-scoped
emails.get("/:id", async (c) => {
  const id = c.req.param("id");
  const projectId = c.get("projectId");
  const email = await prisma.email.findFirst({
    where: { id, projectId },
    include: { events: { orderBy: { occurredAt: "asc" } } },
  });
  if (!email) throw errors.notFound(`Email ${id} not found.`);
  return c.json({
    id: email.id,
    from: email.from,
    to: email.to,
    subject: email.subject,
    status: email.status,
    created_at: email.createdAt,
    events: email.events.map((e) => ({ type: e.type, at: e.occurredAt })),
  });
});

// GET /emails — recent log, project-scoped (FR-050)
emails.get("/", async (c) => {
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
