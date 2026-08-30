# ems

Official SDK for [ems](https://electronicmailservices.com) — send, **verify**, and operate **inboxes** from Node, Next.js, and any runtime with `fetch`. Zero dependencies.

```bash
npm install ems
```

The package lives in this repo. It is **not on the public npm registry yet**;
until it is, copy from source or keep using the Resend client with
`RESEND_BASE_URL=https://api.electronicmailservices.com`.

## Send

```ts
import { EMS } from "ems";

const um = new EMS(process.env.EMS_API_KEY!);

const { id } = await um.emails.send({
  from: "you@yourdomain.com",
  to: "user@acme.com",
  subject: "Welcome 👋",
  html: "<p>Thanks for signing up.</p>",
});
```

`to`, `cc`, `bcc`, `replyTo` accept a string or string array. Optional: `text`,
`headers`, `tags`, `scheduledAt`, `idempotencyKey`.

## Verify a list (before you send)

Protect your sending reputation — catch invalid, dead-domain, disposable,
role-based, blacklisted, and suppressed addresses up front.

```ts
const { results, summary } = await um.verify([
  "real@gmail.com",
  "admin@acme.com",
  "user@mailinator.com",
]);

console.log(summary); // { total, deliverable, risky, undeliverable, unknown }
const clean = results.filter((r) => r.status === "deliverable").map((r) => r.email);
```

## Next.js (Route Handler)

```ts
// app/api/notify/route.ts
import { EMS } from "ems";
const um = new EMS(process.env.EMS_API_KEY!);

export async function POST(req: Request) {
  const { email } = await req.json();
  const [check] = (await um.verify(email)).results;
  if (check.status === "undeliverable") return Response.json({ error: "bad email" }, { status: 400 });
  await um.emails.send({ from: "hi@yourdomain.com", to: email, subject: "Hi", text: "Hello!" });
  return Response.json({ ok: true });
}
```

## Cancel a scheduled send

```ts
const { id } = await um.emails.send({
  from: "you@yourdomain.com",
  to: "user@acme.com",
  subject: "Your weekly digest",
  html: "<p>…</p>",
  scheduledAt: "2026-08-12T09:30:00Z", // ISO 8601, explicit offset, in the future
});

// changed your mind, before it goes out:
await um.emails.cancel(id);   // -> { id, status: "canceled" }
```

Only `queued` and `scheduled` messages can be pulled back. Cancelling an
already-cancelled message succeeds (idempotent); once the message has been handed
to the receiving server the call throws `EMSError` with status `409` and
code `not_cancelable`.

## Inboxes

A two-way mailbox over the API — claim `name@agents.electronicmailservices.com` (or
`inbox.electronicmailservices.com`) with no DNS of your own, or place an inbox on a verified
sending domain. Create / update / delete need a **full-access** key; reading
messages, sending, and replying work with either key kind.

```ts
const { data: domains } = await um.inboxes.domains();
// [{ domain: "agents.electronicmailservices.com", default: true, receiving: true }, …]
// `receiving` is a live MX check. Do not hand out an address that is false.

const box = await um.inboxes.create({ username: "scout" });
// box.address → "scout@agents.electronicmailservices.com"

await um.inboxes.send(box.id, {
  to: "user@acme.com",
  subject: "Hello from scout",
  text: "Hi — this is scout.",
});

const { data: messages } = await um.inboxes.messages.list(box.id, { folder: "inbox" });
if (messages[0]) {
  await um.inboxes.messages.reply(box.id, messages[0].id, { text: "Got it." });
}
```

Omit `username` to get a generated `agent-<hex>` local-part. Pass `domain` to
pick a shared domain by name or a verified custom domain of this project. List
threads with `um.inboxes.threads.list(id)`. The same mailbox is visible in the
dashboard Inbox — one store, two surfaces.

## Branded emails without a template engine

`renderNotification()` builds a complete, email-client-safe HTML document (tables +
inline styles, so it survives Outlook and Gmail) from a few fields — no React Email,
MJML, or build step:

```ts
import { EMS, renderNotification } from "ems";
const um = new EMS(process.env.EMS_API_KEY!);

await um.emails.send({
  from: "Acme <noreply@yourdomain.com>",
  to: user.email,
  subject: "Reset your password",
  html: renderNotification({
    title: "Reset your password",
    body: "Click below to choose a new one. This link expires in 30 minutes.",
    cta: { label: "Reset password", url: resetLink },
    preheader: "Expires in 30 minutes",
    brand: { name: "Acme", color: "#6d5efc", url: "https://acme.com" },
    footer: "You received this because someone requested a reset for your account.",
  }),
});
```

`body` accepts HTML or plain text — plain paragraphs are auto-wrapped in `<p>`.
Every field is escaped. `brand` accepts `name`, `logoUrl`, `color`, and `url`, so
white-label senders can theme it per tenant.

The visual default is a 600px white card on `#f4f5f7`, 12px corners, a 4px accent
rule in `brand.color` (fallback `#111827`), system fonts. Dashboard **Templates →
New** uses the same card via `renderEmail` (block builder). Buttons there inherit
the org `primaryColor` (`#6d5efc` if unset).

### Inquiry received (product starter)

```ts
import { inquiryReceivedEmail } from "ems";

const mail = inquiryReceivedEmail({
  brand: { name: "Storm Repair Pro", color: "#0f3b5f", url: "https://stormrepairpro.com" },
  firstName: "Leah",
  summary: "a 1-bedroom move",
  phone: "(561) 220-0117",
  phoneHref: "+15612200117",
});
await um.emails.send({
  from: "Storm Repair Pro <noreply@stormrepairpro.com>",
  to: "leah@example.com",
  subject: mail.subject,
  text: mail.text,
  html: mail.html,
});
```

The same starter is in the dashboard: **Templates → New → Inquiry received**.

## Receive webhooks

Lifecycle events (`email.sent`, `email.delivered`, `email.bounced`,
`email.complained`) and hosted-mailbox mail (`email.inbound`) are POSTed to your
endpoint with the event name in the `ems-event` header and an HMAC
signature in `ems-signature` (`sha256=<hex>`). Verify it before trusting
the body:

```ts
// app/api/webhooks/ems/route.ts
import { verifyWebhook, type WebhookEvent } from "ems";

export async function POST(req: Request) {
  const raw = await req.text(); // RAW body — do not parse first
  const ok = await verifyWebhook({
    payload: raw,
    signature: req.headers.get("ems-signature"),
    secret: process.env.EMS_WEBHOOK_SECRET!,
  });
  if (!ok) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(raw) as WebhookEvent;
  if (event.type === "email.bounced") {
    // event.data.email_id, event.data.to, …
  }
  if (event.type === "email.inbound") {
    // event.data.mailbox, event.data.from, event.data.subject, event.data.text
  }
  return new Response("ok");
}
```

> **Hash the raw bytes.** Parsing and re-serializing JSON changes them and the
> signature will never match. Events are delivered at least once — key off
> `data.email_id` plus `type` to stay idempotent.

`verifyWebhook` uses WebCrypto, so it runs unchanged on Node 18+, edge runtimes,
and browsers, and compares in constant time.

## Errors

Failed requests throw `EMSError` with `.status`, `.code`, and `.message`.

## Config

```ts
new EMS({ apiKey: "um_live_…", baseUrl: "https://api.electronicmailservices.com" });
```

The API is drop-in compatible with the standard transactional-email
request/response shape, so existing clients work with only a `baseUrl` change —
and this SDK adds `verify()` and the ems feature set.
