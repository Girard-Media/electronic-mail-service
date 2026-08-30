import { Hono } from "hono";
import { prisma } from "@ems/db";
import { apiKeyAuth, type ApiVariables } from "../middleware/auth.js";

// GET /stats — project-scoped overview counts for the dashboard.
export const stats = new Hono<{ Variables: ApiVariables }>();

stats.use("*", apiKeyAuth);

stats.get("/", async (c) => {
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
