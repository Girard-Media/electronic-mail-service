import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

// Features page. Static + ISR. Claims here must match what is actually live.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Features",
  description:
    "A drop-in Resend-compatible email API, one-click sender authentication, scoped API keys, a durable send pipeline, signed webhooks, message logs, list verification, and white-label multi-tenancy — on a mail server we operate.",
};

export default function Features() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <span className="eyebrow">
            <i className="ti ti-stack-2" /> Platform features
          </span>
          <h2>Everything you need to send application email — and trust the status</h2>
          <p className="muted">
            A Resend-compatible API your existing code already speaks, plus authentication,
            suppression, and delivery events from a mail server we operate. White-label
            tenancy from the schema up — not a reseller layer on someone else&apos;s pool.
          </p>
          <p>
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Start free
            </a>
            <Link className="btn lg" href="/docs">
              <i className="ti ti-book" /> Read the docs
            </Link>
          </p>
          <p>
            <span className="pill">
              <i className="ti ti-plug-connected" /> Drop-in compatible API
            </span>{" "}
            <span className="pill">
              <i className="ti ti-mail-check" /> Delivered from the MTA
            </span>{" "}
            <span className="pill">
              <i className="ti ti-building-store" /> White-label multi-tenancy
            </span>
          </p>
        </div>
      </section>

      <section className="wrap">
        <div className="section-head">
          <span className="eyebrow">
            <i className="ti ti-api" /> Sending API
          </span>
          <h3>A drop-in compatible API</h3>
          <p className="muted">
            Point your existing transactional client at our base URL and your code keeps
            working — same payloads, same response shapes. Migrate in one line, then grow
            into the superset.
          </p>
        </div>
        <div className="grid g3">
          <div className="card">
            <div className="ic">
              <i className="ti ti-send" />
            </div>
            <h3>POST /emails</h3>
            <p>
              Send with the exact Resend payload: <span className="mono">from</span>,{" "}
              <span className="mono">to</span>, <span className="mono">cc</span>,{" "}
              <span className="mono">bcc</span>, <span className="mono">reply_to</span>,{" "}
              <span className="mono">subject</span>, <span className="mono">html</span>,{" "}
              <span className="mono">text</span>, attachments, headers, and tags.
              Validation returns actionable errors, not 500s.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-stack-2" />
            </div>
            <h3>Batch sending</h3>
            <p>
              <span className="mono">POST /emails/batch</span> accepts up to a hundred
              messages in a single request — distinct recipients, subjects, and tags per
              entry — so high-volume jobs stay one round trip instead of a hundred.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-clock-hour-4" />
            </div>
            <h3>Scheduling</h3>
            <p>
              Pass <span className="mono">scheduled_at</span> — an ISO 8601 timestamp with
              an explicit UTC offset — to queue a send for later. Cancel it with{" "}
              <span className="mono">POST /emails/:id/cancel</span> while it is still
              queued. Past or ambiguous times are rejected up front.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-fingerprint" />
            </div>
            <h3>Idempotency keys</h3>
            <p>
              Send the same <span className="mono">Idempotency-Key</span> header twice and
              the second request returns the first result instead of a duplicate email.
              Safe retries through any flaky network.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-bolt" />
            </div>
            <h3>Durable accept</h3>
            <p>
              We enqueue the message and return an id immediately. Your request thread
              never waits on the receiving server. Status then moves queued → sent →
              delivered, bounced, or complained.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-brackets" />
            </div>
            <h3>Drop-in path</h3>
            <p>
              Keep the <span className="mono">resend</span> SDK and set{" "}
              <span className="mono">RESEND_BASE_URL=https://api.electronicmailservices.com</span>. A
              typed EMS SDK ships in this repo; it is not on npm yet.
            </p>
          </div>
        </div>
        <CodeBlock
          style={{ marginTop: 26 }}
          code={`// Keep your existing client. Change the base URL.
import { Resend } from "resend";

const resend = new Resend(process.env.EMS_API_KEY);
// resend v6+: RESEND_BASE_URL=https://api.electronicmailservices.com

await resend.emails.send({
  from:    "noreply@acme.com",
  to:      "user@example.com",
  subject: "Reset your password",
  html:    "<strong>Click to reset</strong>",
});`}
        />
        <p className="note">
          <i className="ti ti-info-circle" /> Resend compatibility is a contract, not a
          one-time port. Features ship as a superset — your existing payloads never break.
        </p>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">
              <i className="ti ti-certificate" /> Domains &amp; identity
            </span>
            <h3>Sender authentication that takes one click</h3>
            <p className="muted">
              Add a domain and we generate the keys and records that decide whether you
              reach the inbox — then verify them live.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <div className="ic">
                <i className="ti ti-world-check" />
              </div>
              <h3>SPF, DKIM &amp; DMARC</h3>
              <p>
                We generate DKIM keys and derive the SPF, DMARC, and optional MAIL FROM
                records every authenticated sender needs — no guesswork.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-cloud-cog" />
              </div>
              <h3>One-click DNS</h3>
              <p>
                Publish records straight to supported DNS providers, or copy-paste them
                into any registrar. Live re-verification shows pending, verified, or failed
                per record.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-shield-lock" />
              </div>
              <h3>Alignment as a gate</h3>
              <p>
                You cannot send from a domain this project has not verified. DMARC policy
                guidance walks you from <span className="mono">none</span> toward
                enforcement.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="section-head">
          <span className="eyebrow">
            <i className="ti ti-key" /> Keys &amp; pipeline
          </span>
          <h3>Scoped keys and a send pipeline that doesn&apos;t lose mail</h3>
          <p className="muted">
            Credentials scoped to a single project, and a delivery path engineered so an
            accepted send is a kept promise.
          </p>
        </div>
        <div className="grid g2">
          <div className="card">
            <div className="ic">
              <i className="ti ti-key" />
            </div>
            <h3>Scoped, hashed API keys</h3>
            <p>
              Create and revoke keys per project. Dashboard keys default to sending-access
              (a leak cannot mint more keys). Full-access is explicit. Keys are shown
              once and stored only as hashes. Per-key rate limits are enforced.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-route-2" />
            </div>
            <h3>Durable send pipeline</h3>
            <p>
              Every send enters a durable queue before it leaves, with retries for
              transient failures. Accepted means queued; delivered means the receiving
              server returned 250.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-ban" />
            </div>
            <h3>Pre-send suppression</h3>
            <p>
              Per-project suppression lists are enforced before a message is ever queued,
              so you can&apos;t re-mail an address that already hard-bounced or complained.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-list-check" />
            </div>
            <h3>List verification</h3>
            <p>
              <span className="mono">POST /verify</span> flags invalid syntax, dead
              domains, disposable and role addresses, and Spamhaus DBL hits before you
              send.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <i className="ti ti-webhook" /> Events &amp; observability
            </span>
            <h3>Signed webhooks and a timeline per message</h3>
            <p className="muted">
              Delivery, bounce, and complaint are captured from the mail server — pushed
              to you signed, and shown on the message.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <div className="ic">
                <i className="ti ti-webhook" />
              </div>
              <h3>Signed webhooks</h3>
              <p>
                Register endpoints per project. Payloads are HMAC-signed (
                <span className="mono">ems-signature: sha256=…</span>) for{" "}
                <span className="mono">email.sent</span>,{" "}
                <span className="mono">delivered</span>,{" "}
                <span className="mono">bounced</span>,{" "}
                <span className="mono">complained</span>, and inbound mail.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-refresh-alert" />
              </div>
              <h3>Retries</h3>
              <p>
                At-least-once delivery with exponential backoff on failure. Manual
                one-click replay is not in the dashboard yet.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-timeline-event" />
              </div>
              <h3>Per-message timeline</h3>
              <p>
                Open any message to see queued → sent → delivered / bounced / complained.
                Optional open and click events when tracking is enabled on that domain.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-chart-line" />
              </div>
              <h3>Accepted vs delivered</h3>
              <p>
                Dashboard tiles count accepted, delivered, bounced, and complained
                separately. Delivery rate is hidden until real feedback exists — we never
                imply inbox placement we cannot prove.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-click" />
              </div>
              <h3>Open &amp; click tracking</h3>
              <p>
                Opt-in per domain. A tracking pixel and rewritten links write{" "}
                <span className="mono">opened</span> / <span className="mono">clicked</span>{" "}
                onto the message timeline. Those events are not webhooked yet.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-mail-off" />
              </div>
              <h3>One-click unsubscribe</h3>
              <p>
                <span className="mono">List-Unsubscribe</span> and RFC 8058 one-click
                headers are injected on sends we relay. Honored immediately.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="section-head center">
          <span className="eyebrow">
            <i className="ti ti-building-store" /> White-label multi-tenancy
          </span>
          <h3>Resell email under your own brand</h3>
          <p className="muted">
            Multi-tenant from the schema up — organizations contain projects, projects
            scope every key, domain, log, and send. Isolation is enforced at the data
            layer, not the interface.
          </p>
        </div>
        <div className="grid g3">
          <div className="card">
            <div className="ic">
              <i className="ti ti-sitemap" />
            </div>
            <h3>Orgs → projects → keys</h3>
            <p>
              Role-based access — owner, admin, developer, viewer — per org. Every
              resource belongs to exactly one project; dashboard writes are gated by
              permission.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-palette" />
            </div>
            <h3>Custom domains &amp; branding</h3>
            <p>
              Logo, colors, and a powered-by toggle on plans that include branding.
              Custom dashboard hostnames are in the schema; assignment UI is not live
              yet.
            </p>
          </div>
          <div className="card">
            <div className="ic">
              <i className="ti ti-report-money" />
            </div>
            <h3>Sub-accounts &amp; usage</h3>
            <p>
              White-label orgs create child accounts, switch into them, and see per-tenant
              send rollups. Stripe invoicing of those rollups is not live yet.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">
              <i className="ti ti-sparkles" /> On the roadmap
            </span>
            <h3>Shipped vs coming — labeled, not implied</h3>
            <p className="muted">
              Transactional sending works today. These are real next steps, not hidden in
              the product copy.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <div className="ic">
                <i className="ti ti-network" />
              </div>
              <h3>
                Dedicated IP pools <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Per-tenant or per-stream IPs with a warmup ramp. Today every tenant sends
                through the mail server we operate.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-inbox" />
              </div>
              <h3>
                Inbox-placement tests <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Seed-list folder placement (inbox / spam / missing) per mailbox provider.
                Today we report whether the receiving server accepted the message.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-alert-triangle" />
              </div>
              <h3>
                Explain the failure <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Plain-language bounce and auth-gap diagnosis on the log row, the API, and
                MCP. Bounce reason is already stored on the event.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-users" />
              </div>
              <h3>
                Contacts &amp; segments <span className="soon-tag">Coming</span>
              </h3>
              <p>
                A first-class contact store built from the same activity your transactional
                sends already produce.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-mail-bolt" />
              </div>
              <h3>
                Broadcasts <span className="soon-tag">Coming</span>
              </h3>
              <p>
                One-off and recurring campaigns on the same authenticated infrastructure.
                Not an SMTP relay product, and not shipping with transactional.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-route" />
              </div>
              <h3>
                Automations <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Journeys triggered by the same event stream — welcome series, win-backs —
                without a second vendor.
              </p>
            </div>
          </div>
          <p className="note" style={{ marginTop: 24 }}>
            <i className="ti ti-calendar" /> Phased on purpose: a developer can fully
            migrate off Resend today, then turn on marketing when it ships — without
            re-platforming.
          </p>
        </div>
      </section>

      <section className="cta">
        <div className="wrap">
          <div className="card center">
            <div className="ic">
              <i className="ti ti-rocket" />
            </div>
            <h3>Send your first email in five minutes</h3>
            <p>
              Create a project, verify a domain, drop in a key, and change one base URL.
              Free to start, no card required.
            </p>
            <p style={{ marginTop: 18 }}>
              <a className="btn pri lg" href="/dashboard">
                <i className="ti ti-player-play" /> Start free
              </a>
              <Link className="btn lg" href="/docs">
                <i className="ti ti-book-2" /> Read the docs
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
