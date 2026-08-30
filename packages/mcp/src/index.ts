#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EMS } from "ems";

// MCP server for ems — exposes send + verify as tools so AI agents
// (Claude Desktop, Claude Code, etc.) can use ems directly.
//
//   EMS_API_KEY=um_live_... npx @ems/mcp

const apiKey = process.env.EMS_API_KEY;
if (!apiKey) {
  console.error("ems-mcp: set EMS_API_KEY (your ems API key).");
  process.exit(1);
}
const um = new EMS({ apiKey, baseUrl: process.env.EMS_BASE_URL });

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const server = new McpServer({ name: "ems", version: "0.1.0" });

server.tool(
  "send_email",
  "Send a transactional email through ems. `from` must be a verified sending domain (or @electronicmailservices.com).",
  {
    from: z.string().describe("Sender, e.g. 'Acme <hi@acme.com>'"),
    to: z.union([z.string(), z.array(z.string())]),
    subject: z.string(),
    html: z.string().optional(),
    text: z.string().optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    bcc: z.union([z.string(), z.array(z.string())]).optional(),
    replyTo: z.union([z.string(), z.array(z.string())]).optional(),
  },
  async (args) => {
    const r = await um.emails.send(args);
    return ok(`Email queued ✓ id=${r.id}`);
  },
);

server.tool(
  "verify_emails",
  "Verify email addresses BEFORE sending — flags invalid, dead-domain, disposable, role-based, blacklisted, and suppressed addresses. Returns a per-address verdict and a summary.",
  { emails: z.array(z.string()).min(1).max(2000).describe("Addresses to verify") },
  async ({ emails }) => {
    const r = await um.verify(emails);
    const lines = r.results.map(
      (x) => `${x.email}: ${x.status}${x.reasons.length ? ` (${x.reasons.join("; ")})` : ""}`,
    );
    return ok(`${JSON.stringify(r.summary)}\n${lines.join("\n")}`);
  },
);

server.tool(
  "get_email",
  "Look up the status and event history of a sent email by id.",
  { id: z.string() },
  async ({ id }) => {
    const e = await um.emails.get(id);
    return ok(JSON.stringify(e, null, 2));
  },
);

// --- Provisioning: let an agent set email up end to end, not just send. ---
server.tool(
  "add_domain",
  "Add a sending domain and get back the DNS records to publish (DKIM, SPF, DMARC). Requires a full-access API key. After publishing the records, call verify_domain.",
  { name: z.string().describe("Domain to send from, e.g. acme.com") },
  async ({ name }) => {
    const d = await um.domains.create(name);
    const recs = d.records
      .map((r) => `${r.purpose.toUpperCase()} ${r.type} ${r.host} -> ${r.value}`)
      .join("\n");
    return ok(`${d.name} (${d.status}) id=${d.id}\nPublish these records:\n${recs}`);
  },
);

server.tool(
  "list_domains",
  "List the sending domains on this project and whether each is verified.",
  {},
  async () => {
    const { data } = await um.domains.list();
    return ok(data.map((d) => `${d.status.padEnd(9)} ${d.name}  id=${d.id}`).join("\n") || "none");
  },
);

server.tool(
  "verify_domain",
  "Re-check a domain's DNS and mark it verified if DKIM resolves. Run after publishing the records from add_domain.",
  { id: z.string().describe("Domain id from add_domain / list_domains") },
  async ({ id }) => {
    const r = await um.domains.verify(id);
    const lines = r.records.map((c) => `${c.status.padEnd(9)} ${c.key} ${c.host}`).join("\n");
    return ok(`${r.name}: ${r.verified ? "VERIFIED" : "NOT verified"}\n${lines}`);
  },
);

server.tool(
  "create_api_key",
  "Mint a new API key for this project. Returns the token ONCE — store it immediately. Defaults to sending_access; only use full_access for a key that must manage domains or other keys. Requires a full-access key to call.",
  {
    name: z.string().describe("Label, e.g. 'production web app'"),
    permission: z
      .enum(["full_access", "sending_access"])
      .optional()
      .describe("Defaults to sending_access"),
  },
  async ({ name, permission }) => {
    const k = await um.apiKeys.create({ name, permission });
    return ok(`Created "${k.name}" (${k.permission}) id=${k.id}\nTOKEN (shown once): ${k.token}`);
  },
);

server.tool(
  "list_api_keys",
  "List this project's API keys — names, permissions, and last-used times. Never returns secrets.",
  {},
  async () => {
    const { data } = await um.apiKeys.list();
    return ok(
      data
        .map(
          (k) =>
            `${(k.revokedAt ? "revoked" : "active").padEnd(8)} ${k.permission.padEnd(15)} ${k.name}  id=${k.id}  last_used=${k.lastUsedAt ?? "never"}`,
        )
        .join("\n") || "none",
    );
  },
);

server.tool(
  "cancel_email",
  "Cancel a scheduled or queued email before it sends. Idempotent — cancelling an already-cancelled message succeeds. Fails with 409 not_cancelable once the message has been handed to the receiving server.",
  { id: z.string().describe("The email id returned by send_email") },
  async ({ id }) => {
    const r = await um.emails.cancel(id);
    return ok(`${r.id}: ${r.status}`);
  },
);

server.tool(
  "send_batch",
  "Send up to 100 transactional emails in one call. Each message is the same shape as send_email. Returns a per-message id or error.",
  {
    messages: z
      .array(
        z.object({
          from: z.string(),
          to: z.union([z.string(), z.array(z.string())]),
          subject: z.string(),
          html: z.string().optional(),
          text: z.string().optional(),
          cc: z.union([z.string(), z.array(z.string())]).optional(),
          bcc: z.union([z.string(), z.array(z.string())]).optional(),
          replyTo: z.union([z.string(), z.array(z.string())]).optional(),
        }),
      )
      .min(1)
      .max(100),
  },
  async ({ messages }) => {
    const r = await um.emails.batch(messages);
    const lines = r.data.map((x, i) =>
      "id" in x ? `${i + 1}. queued ✓ ${x.id}` : `${i + 1}. error: ${x.error}`,
    );
    return ok(lines.join("\n"));
  },
);

server.tool(
  "list_emails",
  "List the most recent sent emails (up to 50) with their delivery status — for monitoring what's been sent.",
  {},
  async () => {
    const { data } = await um.emails.list();
    if (!data.length) return ok("No emails sent yet.");
    return ok(
      data
        .map(
          (e) =>
            `${e.id}  [${e.status}]  to:${Array.isArray(e.to) ? e.to.join(",") : e.to}  "${e.subject}"`,
        )
        .join("\n"),
    );
  },
);

server.tool(
  "get_stats",
  "Account overview — totals sent/failed, last 24h, delivery rate, domain and active-key counts.",
  {},
  async () => ok(JSON.stringify(await um.stats(), null, 2)),
);

server.tool(
  "check_domain_health",
  "Analyze a domain's live mail DNS — MX, SPF (with recursive 10-lookup counting), DMARC policy, DKIM selectors, the detected sending platforms, a 0-100 health score, and prioritized risks. Read-only; ideal for diagnosing deliverability or confirming setup before sending.",
  { domain: z.string().describe("Domain to analyze, e.g. acme.com") },
  async ({ domain }) => ok(JSON.stringify(await um.domains.health(domain), null, 2)),
);

await server.connect(new StdioServerTransport());
console.error("ems-mcp running (stdio).");
