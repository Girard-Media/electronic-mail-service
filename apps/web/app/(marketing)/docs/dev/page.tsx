import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

// Developer docs. Static + ISR (regenerated at most hourly). No DB / no @ems/core
// import here, so `next build` prerenders it without any env or DB connection. Ported
// 1:1 from apps/api/public/docs-dev.html onto the shared (marketing) chrome. Every
// multi-line snippet goes through <CodeBlock> so newlines + indentation survive.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Developer Docs",
  description:
    "Developer reference: quickstart with curl, the EMS SDK, programmatic inboxes, signed webhooks including email.inbound, health probes, errors, and the full API reference.",
};

export default function DocsDev() {
  return (
    <>
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-terminal-2" /> Developer docs
          </span>
          <h1>Ship your first email in five minutes</h1>
          <p className="muted">
            A drop-in compatible API on infrastructure you control. If you&apos;ve used a
            modern transactional email SDK, you already know EMS — change one base
            URL and you&apos;re sending.{" "}
            <Link href="/docs/user" style={{ color: "var(--brand2)" }}>
              Not a developer? See the user guide →
            </Link>
          </p>
          <div style={{ marginTop: 26 }}>
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-key" /> Get an API key
            </a>{" "}
            <a className="btn lg" href="#quickstart">
              <i className="ti ti-arrow-down" /> Quickstart
            </a>
          </div>
        </div>
      </section>

      <section className="wrap" id="quickstart">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-list-numbers" /> Quickstart
          </span>
          <h2>From zero to delivered</h2>
          <p className="muted">
            Every send goes through one endpoint —{" "}
            <span className="mono">https://api.electronicmailservices.com/emails</span> — on a mail
            server we operate. No third-party relay in the path.
          </p>

          <h3>
            <span className="tag">1</span> Get an API key
          </h3>
          <p>
            Create a project in the <Link href="/dashboard">Dashboard</Link> and generate
            a key. Keys are project-scoped and shown <b>once</b> — store it as an
            environment variable, never in client-side code. Live keys are prefixed{" "}
            <span className="mono">um_live_</span>; sandbox keys{" "}
            <span className="mono">um_test_</span>.
          </p>
          <CodeBlock
            code={`# keep your key in the environment, not in source
export EMS_API_KEY="um_live_xxxxxxxxxxxxxxxxxxxxxxxx"`}
          />
          <p className="note">
            <i className="ti ti-shield-check" /> Verify your sending domain first
            (DKIM/SPF/DMARC) so mail lands in the inbox. Adding a domain in the Dashboard
            generates the records and re-checks them for you.
          </p>

          <h3>
            <span className="tag">2</span> Send your first email
          </h3>
          <p>
            A single authenticated <span className="mono">POST</span> with a Resend-shaped
            payload. The response returns the message <span className="mono">id</span>{" "}
            you&apos;ll use to track delivery.
          </p>
          <CodeBlock
            code={`curl -X POST https://api.electronicmailservices.com/emails \\
  -H "Authorization: Bearer um_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "Acme <onboarding@yourdomain.com>",
    "to": ["dev@example.com"],
    "subject": "Welcome to Acme",
    "html": "<p>Hello from <strong>ems</strong>.</p>"
  }'`}
          />
          <CodeBlock
            code={`// 200 OK
{ "id": "4ef9a3b1-8c2d-4a77-9f0e-1b2c3d4e5f60" }`}
          />

          <h3>
            <span className="tag">3</span> Already on Resend? Change one import
          </h3>
          <p>
            The compatibility layer keeps resend-node&apos;s method names, parameters, and{" "}
            <span className="mono">{"{ data, error }"}</span> envelope, so your call sites
            don&apos;t move — they just send through EMS instead.
          </p>
          <CodeBlock
            code={`- import { Resend } from "resend";
+ import { Resend } from "ems/compat";

const resend = new Resend(process.env.EMS_API_KEY);

const { data, error } = await resend.emails.send({
  from: "Acme <onboarding@yourdomain.com>",
  to: "dev@example.com",
  subject: "Welcome to Acme",
  html: "<p>Hello from EMS.</p>",
});`}
          />

          <h3>
            <span className="tag">3b</span> Or use the official EMS SDK
          </h3>
          <p>
            Zero-dependency, typed, and adds <span className="mono">verify()</span>,{" "}
            <span className="mono">inboxes.*</span>,{" "}
            <span className="mono">verifyWebhook()</span>, and{" "}
            <span className="mono">renderNotification()</span>. Works in Node 18+, Next.js,
            and edge runtimes. The package is in this repo; it is{" "}
            <strong>not on npm yet</strong> — until it is, use the Resend drop-in
            in 3a or copy the SDK from source.
          </p>
          <CodeBlock
            code={`// after publish: npm install ems
import { EMS } from "ems";
const um = new EMS(process.env.EMS_API_KEY);

await um.emails.send({
  from: "Acme <hi@yourdomain.com>", to: "dev@example.com",
  subject: "Welcome", html: "<p>Hello</p>",
});`}
          />

          <h3>
            <span className="tag">3c</span> Verify a list before you send
          </h3>
          <p>
            Catch invalid, dead-domain, disposable, role-based, blacklisted, and
            suppressed addresses up front — protect your sending reputation. Via the SDK or
            the API.
          </p>
          <CodeBlock
            code={`const { results, summary } = await um.verify([
  "real@gmail.com", "admin@acme.com", "user@mailinator.com",
]);
// summary -> { deliverable, risky, undeliverable, unknown }`}
          />
          <CodeBlock
            code={`curl -X POST https://api.electronicmailservices.com/verify \\
  -H "Authorization: Bearer um_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"emails":["a@x.com","b@y.com"]}'`}
          />

          <h3>
            <span className="tag">3d</span> Use it from AI agents (MCP)
          </h3>
          <p>
            The EMS MCP server gives Claude and other agents{" "}
            <span className="mono">send_email</span>,{" "}
            <span className="mono">verify_emails</span>, and{" "}
            <span className="mono">get_email</span> tools.
          </p>
          <CodeBlock
            code={`// claude_desktop_config.json / .mcp.json
{ "mcpServers": { "ems": {
  "command": "npx", "args": ["-y", "@ems/mcp"],
  "env": { "EMS_API_KEY": "um_live_xxx" }
} } }`}
          />

          <h3>
            <span className="tag">4</span>{" "}
            Check status &amp; the event timeline
          </h3>
          <p>
            Fetch a single message by id to see its current status and full lifecycle, or
            list recent sends for a project-wide log.
          </p>
          <CodeBlock
            code={`curl https://api.electronicmailservices.com/emails/4ef9a3b1-8c2d-4a77-9f0e-1b2c3d4e5f60 \\
  -H "Authorization: Bearer um_live_xxxxxxxx"`}
          />
          <CodeBlock
            code={`{
  "id": "4ef9a3b1-8c2d-4a77-9f0e-1b2c3d4e5f60",
  "status": "delivered",
  "to": ["dev@example.com"],
  "subject": "Welcome to Acme",
  "events": [
    { "type": "queued",    "at": "2026-06-20T18:00:00Z" },
    { "type": "sent",      "at": "2026-06-20T18:00:00Z" },
    { "type": "delivered", "at": "2026-06-20T18:00:02Z" }
  ]
}`}
          />
          <p>List the recent log — filter by status, domain, tag, recipient, or date:</p>
          <CodeBlock
            code={`curl "https://api.electronicmailservices.com/emails?status=bounced&limit=25" \\
  -H "Authorization: Bearer um_live_xxxxxxxx"`}
          />

          <h3>
            <span className="tag">5</span> Idempotency
          </h3>
          <p>
            Retrying a request after a timeout? Send an{" "}
            <span className="mono">Idempotency-Key</span> header. Keys are unique per
            project: a repeated key returns the original result instead of sending twice.
            There is no expiry window — pick a stable key per logical action (order id,
            user-event id), not a random value per attempt.
          </p>
          <CodeBlock
            code={`curl -X POST https://api.electronicmailservices.com/emails \\
  -H "Authorization: Bearer um_live_xxxxxxxx" \\
  -H "Idempotency-Key: order-1042-receipt" \\
  -H "Content-Type: application/json" \\
  -d '{ "from": "...", "to": "...", "subject": "...", "html": "..." }'`}
          />
          <p className="note">
            <i className="ti ti-info-circle" /> Use a key that&apos;s stable per logical
            action (an order id, a user-event id) — not a random value per attempt.
          </p>

          <h3>
            <span className="tag">6</span> Webhooks
          </h3>
          <p>
            Register an endpoint in the Dashboard and subscribe to event types (
            <span className="mono">email.sent</span>,{" "}
            <span className="mono">email.delivered</span>,{" "}
            <span className="mono">email.bounced</span>,{" "}
            <span className="mono">email.complained</span>,{" "}
            <span className="mono">email.inbound</span>). EMS POSTs the payload
            with the event name in the <span className="mono">ems-event</span> header
            and an HMAC signature in <span className="mono">ems-signature</span>{" "}
            (format <span className="mono">sha256=&lt;hex&gt;</span>), retrying with backoff
            on failure. Verify the signature against your endpoint&apos;s signing secret
            before trusting the body.
          </p>
          <p>
            The SDK ships <span className="mono">verifyWebhook()</span> — WebCrypto-based,
            constant-time, and it runs on Node 18+, edge runtimes, and browsers:
          </p>
          <CodeBlock
            code={`import { verifyWebhook, type WebhookEvent } from "ems";

export async function POST(req: Request) {
  const raw = await req.text(); // RAW body — do not parse first
  const ok = await verifyWebhook({
    payload: raw,
    signature: req.headers.get("ems-signature"),
    secret: process.env.EMS_WEBHOOK_SECRET,
  });
  if (!ok) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(raw) as WebhookEvent;
  // event.type, event.data.email_id, event.data.to …
  return new Response("ok");
}`}
          />
          <p>Or verify it yourself, in any language:</p>
          <CodeBlock
            code={`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, signature, secret) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody).digest("hex");
  if (!signature || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// in your handler — verify against the RAW request body
const sig = req.headers["ems-signature"];
if (!verify(rawBody, sig, process.env.WEBHOOK_SECRET)) {
  return res.status(400).end();
}`}
          />
          <p className="note">
            <i className="ti ti-replace" /> Hash the <b>raw bytes</b> of the request body —
            parsing and re-serializing JSON changes the bytes and breaks the signature.
            Every event is delivered at least once; key off{" "}
            <span className="mono">data.email_id</span> + <span className="mono">type</span>{" "}
            (or <span className="mono">data.message_id</span> for inbound) to stay
            idempotent.
          </p>
        </div>
      </section>

      <section className="wrap" id="api">
        <div className="section-head center">
          <span className="eyebrow">
            <i className="ti ti-api" /> API reference
          </span>
          <h2>Core endpoints</h2>
          <p className="muted">
            Base URL <span className="mono">https://api.electronicmailservices.com</span> · authenticate
            with <span className="mono">Authorization: Bearer um_live_…</span> on every
            request.
          </p>
        </div>
        <div className="doc">
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "14.5px" }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th
                  style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}
                >
                  Method &amp; path
                </th>
                <th
                  style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}
                >
                  Description
                </th>
                <th
                  style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}
                >
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">POST /emails</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Send a single email (Resend-shaped payload).
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <span className="tag">Idempotency-Key</span>{" "}
                  <span className="tag">scheduled_at</span>
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">POST /emails/batch</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Send multiple emails in one request.
                </td>
                <td style={{ padding: "12px 14px" }}>Per-item results returned.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /emails/:id</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Retrieve a message with its status and event timeline.
                </td>
                <td style={{ padding: "12px 14px" }}>
                  queued → sent → delivered / bounced …
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">POST /emails/:id/cancel</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Pull back a scheduled or queued message before it sends.
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Idempotent. <span className="mono">409 not_cancelable</span> once sent.
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /emails</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  List recent sends (the project log).
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Filter by status, domain, tag, recipient, date.
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">POST /verify</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Validate a list before you send.
                </td>
                <td style={{ padding: "12px 14px" }}>
                  deliverable / risky / undeliverable
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /domains/health</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Live MX/SPF/DKIM/DMARC report for a domain.
                </td>
                <td style={{ padding: "12px 14px" }}>Query <span className="mono">?domain=</span></td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">POST /inboxes</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Create a mailbox. Omit <span className="mono">domain</span> for an instant
                  shared-domain address.
                </td>
                <td style={{ padding: "12px 14px" }}>Full-access key. See <a href="#inboxes" style={{ color: "var(--brand2)" }}>Inboxes</a>.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /inboxes</span>
                  <br />
                  <span className="mono">GET /inboxes/domains</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  List this project&apos;s inboxes, or the shared domains with live
                  receive-readiness.
                </td>
                <td style={{ padding: "12px 14px" }}>Do not hand out an address whose domain is not <span className="mono">receiving</span>.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET|PATCH|DELETE /inboxes/:id</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Get, rename, or delete an inbox. Messages cascade on delete.
                </td>
                <td style={{ padding: "12px 14px" }}>PATCH/DELETE are full-access.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /inboxes/:id/messages</span>
                  <br />
                  <span className="mono">POST /inboxes/:id/send</span>
                  <br />
                  <span className="mono">POST …/messages/:mid/reply</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Read, send from, and reply in an inbox. Threads at{" "}
                  <span className="mono">/inboxes/:id/threads</span>.
                </td>
                <td style={{ padding: "12px 14px" }}>Either key kind. Reading does not auto-mark seen.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /livez</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Process liveness. Always 200 if the API can answer.
                </td>
                <td style={{ padding: "12px 14px" }}>No auth. Alias of <span className="mono">/health</span>.</td>
              </tr>
              <tr>
                <td style={{ padding: "12px 14px" }}>
                  <span className="mono">GET /readyz</span>
                </td>
                <td style={{ padding: "12px 14px" }}>
                  Readiness: Postgres + Redis. 503 if we cannot serve.
                </td>
                <td style={{ padding: "12px 14px" }}>No auth. Queue backup is <span className="mono">degraded</span>, still 200.</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 14, fontSize: 14 }}>
            Dashboard webmail stays at session-auth{" "}
            <span className="mono">/app/mailboxes</span>. Same Mailbox/Message store as{" "}
            <span className="mono">/inboxes</span>. Inbound webhooks:{" "}
            <span className="mono">email.inbound</span>.
          </p>
        </div>
      </section>

      <section className="wrap" id="inboxes">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-mailbox" /> Inboxes
          </span>
          <h2>A two-way mailbox over the API</h2>
          <p>
            <span className="mono">POST /inboxes</span> provisions an address. Omit{" "}
            <span className="mono">domain</span> for an instant inbox on{" "}
            <span className="mono">agents.electronicmailservices.com</span> (or pass{" "}
            <span className="mono">inbox.electronicmailservices.com</span>). No DNS of your own. Pass a
            verified sending domain of this project to place the inbox there — that
            domain&apos;s MX must already point at{" "}
            <span className="mono">mail.electronicmailservices.com</span>, on a subdomain if the apex
            still goes to Google Workspace.
          </p>
          <p>
            Create / update / delete need a <b>full-access</b> key. Reading, sending, and
            replying work with either key kind. Plan caps apply org-wide (free 3 / pro 25 /
            scale 250).
          </p>
          <CodeBlock
            code={`# live receive-readiness per shared domain
curl https://api.electronicmailservices.com/inboxes/domains \\
  -H "Authorization: Bearer um_live_xxxxxxxx"

# claim an address (omit username → agent-<hex>)
curl -X POST https://api.electronicmailservices.com/inboxes \\
  -H "Authorization: Bearer um_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"scout","display_name":"Scout"}'

# send FROM the inbox
curl -X POST https://api.electronicmailservices.com/inboxes/INBOX_ID/send \\
  -H "Authorization: Bearer um_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"user@acme.com","subject":"Hello","text":"Hi from scout"}'`}
          />
          <CodeBlock
            code={`import { EMS } from "ems";
const um = new EMS(process.env.EMS_API_KEY!);

const { data: domains } = await um.inboxes.domains();
const ready = domains.find((d) => d.receiving);
if (!ready) throw new Error("shared domain is not receiving yet");

const box = await um.inboxes.create({ username: "scout" });
await um.inboxes.send(box.id, { to: "user@acme.com", subject: "Hi", text: "Hello" });
const { data: messages } = await um.inboxes.messages.list(box.id);`}
          />
          <p className="note">
            <i className="ti ti-info-circle" /> Always read{" "}
            <span className="mono">receiving</span> from{" "}
            <span className="mono">GET /inboxes/domains</span> before handing an address
            out. A shared domain whose MX is not yet ours can send but cannot receive.
            MCP inbox tools and an npm publish are not live yet — copy the SDK from
            this repo or call the HTTP API.
          </p>
        </div>
      </section>

      <section className="wrap" id="inbound">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-inbox" /> Hosted inbox
          </span>
          <h2>Receive mail on your domain</h2>
          <p>
            Create addresses in the dashboard (Inbox). Mail is stored when the domain&apos;s
            MX points at <span className="mono">mail.electronicmailservices.com</span>. Do not change an
            apex MX that already goes to Google Workspace — use a subdomain. Setup:
            the{" "}
            <Link href="/docs/user#inbox" style={{ color: "var(--brand2)" }}>
              user guide
            </Link>
            .
          </p>
          <p>
            When a message is stored, subscribed endpoints receive{" "}
            <span className="mono">email.inbound</span> (same HMAC as the other events).
            Unknown recipients are dropped with no bounce. Over-quota returns{" "}
            <span className="mono">507 mailbox_full</span> so the sending MTA defers.
          </p>
          <CodeBlock
            code={`{
  "type": "email.inbound",
  "created_at": "2026-08-21T15:00:00.000Z",
  "data": {
    "mailbox": "hello@yourdomain.com",
    "to": ["hello@yourdomain.com"],
    "from": "Ann <ann@client.com>",
    "subject": "Re: Invoice",
    "text": "Thanks — paid.",
    "html": "<p>Thanks — paid.</p>",
    "snippet": "Thanks — paid.",
    "message_id": "<abc@client.com>",
    "in_reply_to": "<orig@yourdomain.com>"
  }
}`}
          />
          <p>
            Send-lifecycle events look like this instead:
          </p>
          <CodeBlock
            code={`{
  "type": "email.delivered",
  "created_at": "2026-08-21T15:00:02.000Z",
  "data": {
    "email_id": "4ef9a3b1-8c2d-4a77-9f0e-1b2c3d4e5f60",
    "to": ["user@example.com"],
    "from": "Acme <hello@yourdomain.com>",
    "subject": "Welcome to Acme"
  }
}`}
          />
          <p className="note">
            <i className="ti ti-info-circle" /> Forwarding copies are sent from the mailbox
            address (DKIM-aligned). Destinations must click a confirm link first. This is
            not From-preserving alias forwarding — that breaks DMARC without ARC.
          </p>
        </div>
      </section>

      <section className="wrap" id="health">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-activity" /> Health
          </span>
          <h2>Liveness vs readiness</h2>
          <p>
            <span className="mono">GET /livez</span> (also{" "}
            <span className="mono">/health</span>) means the process is up. It stays 200
            even if Postgres is down — putting dependencies on liveness turns a blip into
            a container kill loop.
          </p>
          <p>
            <span className="mono">GET /readyz</span> means we can serve: Postgres{" "}
            <span className="mono">SELECT 1</span> and Redis <span className="mono">PING</span>.
            Either failing → <b>503</b> and <span className="mono">{`"status":"down"`}</span>.
            A backed-up send queue is <span className="mono">{`"degraded"`}</span> with HTTP
            200 so monitors can warn without paging &quot;down&quot;.
          </p>
          <CodeBlock
            code={`curl -s https://api.electronicmailservices.com/readyz
# { "status": "ok", "service": "ems-api",
#   "checks": { "postgres": { "ok": true, "ms": 4 },
#               "redis": { "ok": true, "ms": 1 },
#               "send_queue": { "ok": true, "waiting": 0, "failed": 0 } } }`}
          />
          <p>
            Component view:{" "}
            <Link href="/status" style={{ color: "var(--brand2)" }}>
              electronicmailservices.com/status
            </Link>
            . Better Stack paste list (HTTP, TCP :25, worker heartbeats):{" "}
            <span className="mono">infra/observability.md</span> in the repo.
          </p>
        </div>
      </section>

      <section className="wrap" id="errors">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-exclamation-circle" /> Errors
          </span>
          <h2>Stable error shape</h2>
          <p>
            Failures return JSON <span className="mono">{`{ statusCode, name, message }`}</span>.
            The SDK throws <span className="mono">EMSError</span> with{" "}
            <span className="mono">.status</span>, <span className="mono">.code</span>,{" "}
            <span className="mono">.message</span>.
          </p>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "14.5px" }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}>HTTP</th>
                <th style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}>name</th>
                <th style={{ padding: "12px 14px", color: "var(--tx2)", fontWeight: 600 }}>When</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>401</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">unauthorized</span></td>
                <td style={{ padding: "12px 14px" }}>Missing or invalid API key.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>402</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">plan_limit_exceeded</span></td>
                <td style={{ padding: "12px 14px" }}>Monthly send cap for the org&apos;s plan.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>403</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">domain_not_verified</span></td>
                <td style={{ padding: "12px 14px" }}>From domain is not a verified sending domain of this project.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>403</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">email_unverified</span></td>
                <td style={{ padding: "12px 14px" }}>Sending from electronicmailservices.com before the org owner verifies their email.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>403</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">forbidden</span></td>
                <td style={{ padding: "12px 14px" }}>Role cannot perform that dashboard write.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>404</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">not_found</span></td>
                <td style={{ padding: "12px 14px" }}>Unknown resource.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>409</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">not_cancelable</span></td>
                <td style={{ padding: "12px 14px" }}>Cancel after the message left queued/scheduled.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>422</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">validation_error</span></td>
                <td style={{ padding: "12px 14px" }}>Bad payload — including <span className="mono">scheduled_at</span> without an explicit offset, or a past time.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>422</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">suppressed_recipient</span></td>
                <td style={{ padding: "12px 14px" }}>Address is on the project suppression list.</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "12px 14px" }}>429</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">rate_limit_exceeded</span></td>
                <td style={{ padding: "12px 14px" }}>Too many requests on this key/IP.</td>
              </tr>
              <tr>
                <td style={{ padding: "12px 14px" }}>507</td>
                <td style={{ padding: "12px 14px" }}><span className="mono">mailbox_full</span></td>
                <td style={{ padding: "12px 14px" }}>Hosted mailbox over quota — inbound defers, does not silently drop.</td>
              </tr>
            </tbody>
          </table>
          <p className="note">
            <i className="ti ti-clock" /> <span className="mono">scheduled_at</span> must be
            ISO-8601 with an explicit <span className="mono">Z</span> or ±HH:MM offset, and
            strictly in the future. Natural language is rejected.
          </p>
        </div>
      </section>

      <section className="wrap" id="troubleshoot">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-tool" /> Troubleshooting
          </span>
          <h2>When something does not land</h2>
          <ul style={{ color: "var(--tx2)", fontSize: 15, lineHeight: 1.9 }}>
            <li>
              <b>403 domain_not_verified</b> — add the From domain under Sending domains
              and wait until DKIM is verified before sending.
            </li>
            <li>
              <b>Inbox empty</b> — the address exists but MX does not point at{" "}
              <span className="mono">mail.electronicmailservices.com</span>. Check the receiving chip
              on the domain. If Google already owns the apex, use{" "}
              <span className="mono">inbox.yourdomain.com</span>.
            </li>
            <li>
              <b>Forward never arrives</b> — the destination must click the confirm email.
              Copies are sent from the mailbox address, not the original From.
            </li>
            <li>
              <b>Webhook signature fails</b> — hash the raw body bytes. Parsing JSON and
              re-serializing changes them.
            </li>
            <li>
              <b>/readyz is 503</b> — Postgres or Redis is unreachable.{" "}
              <span className="mono">/livez</span> can still be 200.
            </li>
            <li>
              <b>Accepted but never delivered</b> — bounce MX / feedback loop. Check God
              Mode sending-health alert and{" "}
              <Link href="/status" style={{ color: "var(--brand2)" }}>/status</Link>.
            </li>
          </ul>
        </div>
      </section>

      <section className="wrap" id="migrate">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-transfer-in" /> Migrating from Resend
          </span>
          <h2>Switch in one line</h2>
          <p>
            EMS accepts Resend&apos;s payloads and responses, so your code barely
            moves. Swap the import — every <span className="mono">emails.send()</span> call,
            payload shape, and <span className="mono">{"{ data, error }"}</span> response
            stays exactly as it is, now sending on infrastructure you control.
          </p>
          <CodeBlock
            code={`// before
import { Resend } from "resend";
// after — same methods, same payloads, same { data, error }
import { Resend } from "ems/compat";

const resend = new Resend(process.env.EMS_API_KEY);
await resend.emails.send({ from, to, subject, html });`}
          />
          <p>
            Bring your domains, broadcast templates, and contacts across with one read-only
            command:
          </p>
          <CodeBlock code={`npx ems-migrate resend --from re_xxxxxxxx`} />
          <p className="note">
            <i className="ti ti-route" /> Run both in parallel during cutover: keep Resend
            live while you verify your domain and watch sends land in the EMS log,
            then flip 100%. No payload migration, no data backfill.
          </p>
        </div>
      </section>

      <section className="cta">
        <div className="wrap center">
          <h2>Get your key and send</h2>
          <p className="muted">
            Spin up a project, verify a domain, and put a live transactional email through
            in minutes.
          </p>
          <div style={{ marginTop: 24 }}>
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Open the Dashboard
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
