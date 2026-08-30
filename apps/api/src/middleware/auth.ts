import { createMiddleware } from "hono/factory";
import { errors, parseApiKey, verifyKey, enforceRateLimit } from "@ems/core";
import { prisma } from "@ems/db";
import type { Context } from "hono";

export type ApiVariables = {
  projectId: string;
  orgId: string;
  apiKeyId: string;
  apiKeyPermission: "full_access" | "sending_access";
};

/**
 * API-key authentication (FR-020/021), DB-backed + tenant-scoped.
 * Parses the token, looks up the ApiKey by its public prefix, constant-time
 * verifies the hash, rejects revoked keys, and attaches the project/org context.
 */
export const apiKeyAuth = createMiddleware<{ Variables: ApiVariables }>(
  async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : undefined;
    if (!token) throw errors.unauthorized();

    const parsed = parseApiKey(token);
    if (!parsed) throw errors.unauthorized();

    const key = await prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      include: { project: { select: { orgId: true } } },
    });
    if (!key || key.revokedAt) throw errors.unauthorized();
    if (!verifyKey(token, key.hashedKey)) throw errors.unauthorized();

    // per-key rate limit (FR-021) — 429 when exceeded
    await enforceRateLimit(key.id, key.rateLimitRps);

    // best-effort last-used stamp; never block the request on it
    void prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    c.set("projectId", key.projectId);
    c.set("orgId", key.project.orgId);
    c.set("apiKeyId", key.id);
    c.set("apiKeyPermission", key.permission);
    await next();
  },
);

/**
 * Gate management operations (minting keys, adding/removing domains) to
 * `full_access` keys. A `sending_access` key is the one you paste into an app —
 * if it leaked it must not be able to escalate into full control of the project.
 */
export function requireFullAccess(c: Context<{ Variables: ApiVariables }>): void {
  if (c.get("apiKeyPermission") !== "full_access") {
    throw errors.forbidden(
      "This API key has sending access only. Use a full-access key to manage API keys and domains.",
    );
  }
}
