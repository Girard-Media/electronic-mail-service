import { Hono } from "hono";
import { z } from "zod";
import { errors, generateApiKey, secretEquals } from "@ems/core";
import { prisma } from "@ems/db";

// Bootstrap a tenant without a dashboard (Phase 1a). Guarded by BOOTSTRAP_SECRET.
// Creates an org + default project + first API key (token shown once).
export const admin = new Hono();

const bootstrapSchema = z.object({
  orgName: z.string().min(1),
  projectName: z.string().min(1).default("default"),
});

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

admin.post("/bootstrap", async (c) => {
  const expected = process.env.BOOTSTRAP_SECRET;
  const provided = c.req.header("x-admin-secret");
  if (!expected || !secretEquals(provided, expected)) throw errors.unauthorized();

  const body = await c.req.json().catch(() => null);
  const parsed = bootstrapSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.validation(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { orgName, projectName } = parsed.data;
  const base =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org";

  const org = await prisma.organization.create({
    data: { name: orgName, slug: `${base}-${suffix()}` },
  });
  const project = await prisma.project.create({
    data: { orgId: org.id, name: projectName, slug: "default" },
  });
  const key = generateApiKey("live");
  await prisma.apiKey.create({
    data: {
      projectId: project.id,
      name: "bootstrap key",
      prefix: key.prefix,
      hashedKey: key.hashedKey,
    },
  });

  return c.json({
    org: { id: org.id, name: org.name, slug: org.slug },
    project: { id: project.id, name: project.name },
    api_key: key.token,
  });
});
