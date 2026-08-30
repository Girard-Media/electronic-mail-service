import { Hono } from "hono";
import { z } from "zod";
import { errors, generateApiKey } from "@ems/core";
import { prisma } from "@ems/db";
import { apiKeyAuth, requireFullAccess, type ApiVariables } from "../middleware/auth.js";

// Public API-key management, Resend-compatible: POST/GET /api-keys and
// DELETE /api-keys/:id. This is what lets a customer (or an agent, or an agency
// provisioning sub-accounts) set themselves up entirely over the API instead of
// clicking through a dashboard.
//
// Guardrail: every route here demands a FULL-ACCESS key. The key you paste into
// an app should be `sending_access`, so a leak can't mint more credentials.
export const apiKeys = new Hono<{ Variables: ApiVariables }>();

apiKeys.use("*", apiKeyAuth);

const createSchema = z.object({
  name: z.string().min(1).max(120).default("API key"),
  // Resend spells these `full_access` / `sending_access`; keep the same words.
  permission: z.enum(["full_access", "sending_access"]).default("sending_access"),
});

// POST /api-keys — mint a key. The token is returned ONCE and never stored.
apiKeys.post("/", async (c) => {
  requireFullAccess(c);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw errors.validation(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { name, permission } = parsed.data;
  const k = generateApiKey("live");
  const created = await prisma.apiKey.create({
    data: {
      projectId: c.get("projectId"),
      name,
      permission,
      prefix: k.prefix,
      hashedKey: k.hashedKey,
    },
    select: { id: true, name: true, permission: true, createdAt: true },
  });
  return c.json({ ...created, token: k.token }, 201);
});

// GET /api-keys — list this project's keys. Never exposes a secret.
apiKeys.get("/", async (c) => {
  requireFullAccess(c);
  const data = await prisma.apiKey.findMany({
    where: { projectId: c.get("projectId") },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      permission: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return c.json({ data });
});

// DELETE /api-keys/:id — revoke. Idempotent: revoking twice is still a success.
apiKeys.delete("/:id", async (c) => {
  requireFullAccess(c);
  const id = c.req.param("id");
  const key = await prisma.apiKey.findFirst({
    where: { id, projectId: c.get("projectId") },
    select: { id: true, revokedAt: true },
  });
  if (!key) throw errors.notFound(`API key ${id} not found.`);
  // Refuse to revoke the key making the request — that would lock the caller out
  // mid-script with no way back in over the API.
  if (key.id === c.get("apiKeyId")) {
    throw errors.conflict(
      "cannot_revoke_self",
      "This key is the one authenticating the request. Revoke it with a different full-access key.",
    );
  }
  if (!key.revokedAt) {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }
  return c.json({ id, revoked: true });
});
