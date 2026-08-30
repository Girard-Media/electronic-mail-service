import { Hono } from "hono";
import { z } from "zod";
import { errors } from "@ems/core";
import { apiKeyAuth, type ApiVariables } from "../middleware/auth.js";
import { verifyEmailList } from "../lib/verify.js";

// Public, API-key-authed email-list verification (so the SDK/MCP can validate
// lists programmatically). Mounted at /verify.
export const verify = new Hono<{ Variables: ApiVariables }>();

verify.use("*", apiKeyAuth);

verify.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  // Accept {emails:[...]}, {email:"..."}, or a bare array.
  const p = z
    .union([
      z.object({ emails: z.array(z.string()).min(1).max(2000) }),
      z.object({ email: z.string() }),
      z.array(z.string()).min(1).max(2000),
    ])
    .safeParse(body);
  if (!p.success) throw errors.validation("Provide an email or a list of up to 2000 emails.");
  const emails = Array.isArray(p.data)
    ? p.data
    : "emails" in p.data
      ? p.data.emails
      : [p.data.email];
  return c.json(await verifyEmailList(c.get("projectId"), emails));
});
