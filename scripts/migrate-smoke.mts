// Smoke test: Resend compat shim + the migration engine. Run with tsx.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "../packages/sdk/src/compat.js";
import {
  runMigration,
  writeMigrationKit,
  emptyInventory,
  ResendSource,
  SendGridSource,
  PostmarkSource,
  MailgunSource,
  type Inventory,
} from "../packages/migrate/src/index.js";

/** Build a path-routed mock fetch from a base URL + route map. */
function routedFetch(base: string, routes: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const path = String(url).replace(base, "");
    const body = routes[path];
    return body !== undefined
      ? new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

// ---------- 1) Compat shim: Resend-shaped { data, error } over ems ----------
{
  const calls: { url: string; body: unknown }[] = [];
  const mockFetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ id: "em_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const resend = new Resend("um_test", { fetch: mockFetch, baseUrl: "https://api.electronicmailservices.com" });
  const res = await resend.emails.send({
    from: "you@bootspring.com",
    to: "user@acme.com",
    subject: "Hi",
    html: "<p>Hello</p>",
    reply_to: "reply@bootspring.com", // Resend snake_case
  });
  ok("compat: send returns { data: { id } }", res.data?.id === "em_123" && res.error === null);
  ok("compat: posts to /emails", calls[0]?.url === "https://api.electronicmailservices.com/emails");
  ok("compat: maps reply_to → reply_to on the wire",
    (calls[0]?.body as Record<string, unknown>)?.reply_to === "reply@bootspring.com");

  // error path → { data: null, error }
  const errFetch = (async () =>
    new Response(JSON.stringify({ name: "validation_error", message: "bad from" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  const r2 = new Resend("um_test", { fetch: errFetch });
  const e2 = await r2.emails.send({ from: "x", to: "y", subject: "s", html: "h" });
  ok("compat: error path returns { data: null, error }", e2.data === null && e2.error?.message === "bad from");

  // react prop is unsupported → throws inside, surfaced as error envelope
  const r3 = new Resend("um_test", { fetch: mockFetch });
  const e3 = await r3.emails.send({ from: "a", to: "b", subject: "s", react: {} as unknown });
  ok("compat: react prop rejected with hint", e3.error !== null && /react/.test(e3.error?.message ?? ""));
}

// ---------- 2) Migration engine: mock Resend API → on-disk kit ----------
{
  const routes: Record<string, unknown> = {
    "/domains": { data: [
      { name: "bootspring.com", status: "verified", region: "us-east-1", created_at: "2025-01-01" },
      { name: "pyrosync.com", status: "pending" },
    ] },
    "/api-keys": { data: [{ id: "key_1", name: "production" }] },
    "/audiences": { data: [{ id: "aud_1", name: "Newsletter" }] },
    "/audiences/aud_1/contacts": { data: [
      { email: "a@x.com", first_name: "Ann", last_name: "Lee", unsubscribed: false },
      { email: "b@y.com", unsubscribed: true },
    ] },
    "/broadcasts": { data: [{ id: "br_1", name: "Launch Day" }] },
    "/broadcasts/br_1": { id: "br_1", name: "Launch Day", subject: "We launched", from: "hi@bootspring.com", html: "<h1>Hello, world</h1>" },
  };
  const mockFetch = (async (url: string | URL) => {
    const path = String(url).replace("https://api.resend.com", "");
    const body = routes[path];
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const out = join(process.cwd(), ".tmp-migrate-smoke");
  await rm(out, { recursive: true, force: true });
  const { inventory: inv, write } = await runMigration(
    new ResendSource({ apiKey: "re_test", fetch: mockFetch, now: "2026-06-23T00:00:00.000Z" }),
    out,
  );

  ok("migrate: 2 domains pulled", inv.domains.length === 2, inv.domains.map((d) => d.name).join(","));
  ok("migrate: 1 audience, 2 contacts", inv.audiences.length === 1 && inv.audiences[0]?.contacts.length === 2);
  ok("migrate: 1 template with html", inv.templates.length === 1 && !!inv.templates[0]?.html);
  ok("migrate: webhooks note present", inv.notes.some((n) => /Webhooks/.test(n)));

  const report = await readFile(write.reportPath, "utf8");
  ok("migrate: report names a domain", report.includes("bootspring.com"));
  ok("migrate: report has the code-swap diff", report.includes('import { Resend } from "ems/compat"'));

  const html = await readFile(join(out, "templates", "launch-day.html"), "utf8");
  ok("migrate: template html exported", html.includes("Hello, world"));

  const csv = await readFile(join(out, "audiences", "newsletter.csv"), "utf8");
  ok("migrate: CSV header + contacts", csv.startsWith("email,first_name,last_name,unsubscribed") && csv.includes("a@x.com") && csv.includes("true"));

  await rm(out, { recursive: true, force: true });
}

// ---------- 3) SendGrid source: mock v3 API → inventory ----------
{
  const fetchImpl = routedFetch("https://api.sendgrid.com", {
    "/v3/whitelabel/domains": [
      { domain: "acme.com", subdomain: "em", valid: true },
      { domain: "foo.com", subdomain: "", valid: false },
    ],
    "/v3/templates?generations=legacy,dynamic&page_size=200": {
      result: [
        { id: "d-1", name: "Welcome", versions: [
          { subject: "Hi", html_content: "<h1>Welcome</h1>", plain_content: "Welcome", active: true },
        ] },
      ],
    },
    "/v3/marketing/lists": { result: [{ id: "l1", name: "Subscribers", contact_count: 1200 }] },
    "/v3/api_keys": { result: [{ api_key_id: "k1", name: "prod" }] },
  });
  const inv = await new SendGridSource({ apiKey: "SG.test", fetch: fetchImpl, now: "2026-06-23T00:00:00Z" }).inventory();
  ok("sendgrid: domains mapped (subdomain join + status)",
    inv.domains.length === 2 &&
    inv.domains.some((d) => d.name === "em.acme.com" && d.status === "verified") &&
    inv.domains.some((d) => d.name === "foo.com" && d.status === "pending"));
  ok("sendgrid: template body from active version", inv.templates[0]?.html === "<h1>Welcome</h1>");
  ok("sendgrid: list as audience (contacts async, noted)",
    inv.audiences.length === 1 && inv.audiences[0]?.contacts.length === 0 &&
    inv.notes.some((n) => /1200 contacts/.test(n)));
  ok("sendgrid: api key name", inv.apiKeys[0]?.name === "prod");
}

// ---------- 4) Postmark source: dual-token mock → inventory ----------
{
  const fetchImpl = routedFetch("https://api.postmarkapp.com", {
    "/domains?count=500&offset=0": { Domains: [
      { ID: 1, Name: "acme.com", SPFVerified: true, DKIMVerified: true },
      { ID: 2, Name: "bar.com", SPFVerified: true, DKIMVerified: false },
    ] },
    "/templates?count=500&offset=0": { Templates: [{ TemplateId: 10, Name: "Receipt", Alias: "receipt" }] },
    "/templates/10": { TemplateId: 10, Name: "Receipt", Subject: "Your receipt", HtmlBody: "<h1>Receipt</h1>", TextBody: "Receipt" },
  });
  const inv = await new PostmarkSource({ serverToken: "srv", accountToken: "acct", fetch: fetchImpl, now: "2026-06-23T00:00:00Z" }).inventory();
  ok("postmark: domains mapped (SPF+DKIM → status)",
    inv.domains.length === 2 &&
    inv.domains.some((d) => d.name === "acme.com" && d.status === "verified") &&
    inv.domains.some((d) => d.name === "bar.com" && d.status === "pending"));
  ok("postmark: template fetched per-id with body", inv.templates[0]?.html === "<h1>Receipt</h1>" && inv.templates[0]?.subject === "Your receipt");
  ok("postmark: transactional-only note", inv.notes.some((n) => /transactional-only/.test(n)));

  // single-token: only serverToken → domains skipped with a note
  const invS = await new PostmarkSource({ serverToken: "srv", fetch: fetchImpl }).inventory();
  ok("postmark: missing account token noted", invS.domains.length === 0 && invS.notes.some((n) => /Account API token/.test(n)));
}

// ---------- 5) Mailgun source: Basic auth, per-domain templates, list members ----------
{
  const fetchImpl = routedFetch("https://api.mailgun.net", {
    "/v4/domains?limit=1000": { items: [
      { name: "mg.acme.com", state: "active", created_at: "Mon, 01 Jan 2025" },
      { name: "sandbox.foo.com", state: "unverified" },
    ], total_count: 2 },
    "/v3/mg.acme.com/templates?limit=1000": { items: [{ name: "welcome", description: "hi" }] },
    "/v3/mg.acme.com/templates/welcome?active=yes": { template: { name: "welcome", version: { template: "<h1>MG Hi</h1>", active: true } } },
    "/v3/sandbox.foo.com/templates?limit=1000": { items: [] },
    "/v3/lists/pages?limit=1000": { items: [{ address: "news@acme.com", name: "News", members_count: 2 }] },
    "/v3/lists/news@acme.com/members/pages?limit=1000": { items: [
      { address: "a@x.com", name: "Ann", subscribed: true },
      { address: "b@y.com", subscribed: false },
    ] },
  });
  const inv = await new MailgunSource({ apiKey: "key-test", fetch: fetchImpl, now: "2026-06-23T00:00:00Z" }).inventory();
  ok("mailgun: domains mapped (state → status)",
    inv.domains.length === 2 &&
    inv.domains.some((d) => d.name === "mg.acme.com" && d.status === "verified") &&
    inv.domains.some((d) => d.name === "sandbox.foo.com" && d.status === "pending"));
  ok("mailgun: per-domain template active body", inv.templates.length === 1 && inv.templates[0]?.html === "<h1>MG Hi</h1>" && inv.templates[0]?.id === "mg.acme.com/welcome");
  ok("mailgun: list members → contacts (unsub flag)",
    inv.audiences.length === 1 && inv.audiences[0]?.contacts.length === 2 &&
    inv.audiences[0]?.contacts.some((c) => c.email === "b@y.com" && c.unsubscribed === true));
  ok("mailgun: api-keys-not-listable note", inv.notes.some((n) => /API keys aren't listable/.test(n)));

  // region → host wiring (EU)
  let hitUrl = "";
  const recFetch = (async (url: string | URL) => { hitUrl = String(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  await new MailgunSource({ apiKey: "k", region: "eu", fetch: recFetch }).inventory();
  ok("mailgun: EU region uses api.eu.mailgun.net", hitUrl.startsWith("https://api.eu.mailgun.net"));
}

// ---------- 6) Outreach-shaped inventory → outreach kit (E01-028) ----------
{
  const out = join(process.cwd(), ".tmp-migrate-outreach");
  const inv: Inventory = {
    ...emptyInventory("instantly", "2026-06-23T00:00:00.000Z"),
    domains: [{ name: "send.acme.com", status: "verified" }],
    campaigns: [{
      id: "c1",
      name: "Q3 Founders",
      status: "active",
      steps: [
        { position: 1, subject: "Quick idea", delay: "0d" },
        { position: 2, subject: "Bump", delay: "2d", hasVariant: true },
      ],
      mailboxes: ["ava@send.acme.com"],
    }],
    leadLists: [{
      id: "l1",
      name: "SaaS CFOs",
      contacts: [{ email: "cfo@bigco.com", firstName: "Jo", unsubscribed: false }],
    }],
    mailboxes: [{ email: "ava@send.acme.com", domain: "send.acme.com", status: "active", dailyCap: 30 }],
    suppressions: [{ email: "gone@old.co", reason: "bounce" }],
  };
  const write = await writeMigrationKit(inv, out);
  const report = await readFile(write.reportPath, "utf8");
  ok("outreach: campaign steps rendered in report",
    report.includes("Q3 Founders") && report.includes("Step 2 (after 2d): Bump") && report.includes("[has variants]"));
  ok("outreach: suppression-first warning + checklist",
    report.includes("suppressions.csv") && report.includes("Import `suppressions.csv` FIRST"));
  ok("outreach: mailbox re-provision note", report.includes("ava@send.acme.com") && report.includes("warm it on its own curve"));
  const leads = await readFile(join(out, "lead-lists", "saas-cfos.csv"), "utf8");
  ok("outreach: lead list CSV exported", leads.startsWith("email,first_name,last_name,unsubscribed") && leads.includes("cfo@bigco.com"));
  const supp = await readFile(join(out, "suppressions.csv"), "utf8");
  ok("outreach: suppressions CSV exported", supp.startsWith("email,reason") && supp.includes("gone@old.co,bounce"));

  await rm(out, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
