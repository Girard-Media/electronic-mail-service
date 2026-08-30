import type { Metadata } from "next";
import Link from "next/link";

// User guide. Static + ISR (regenerated at most hourly). No DB / no @ems/core
// import here, so `next build` prerenders it without any env or DB connection. Ported
// 1:1 from apps/api/public/docs-user.html onto the shared (marketing) chrome.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "User Guide",
  description:
    "Use EMS from the dashboard: add and verify a sending domain, host inboxes at you@yourdomain.com, forward copies to Gmail, verify lists, manage suppressions, and send.",
};

export default function DocsUserPage() {
  return (
    <>
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-user-heart" /> User guide
          </span>
          <h1>Everything you can do from the dashboard</h1>
          <p className="muted">
            No code required. Add your domain, receive at{" "}
            <span className="mono">you@yourdomain.com</span>, clean your lists, and send —
            all from{" "}
            <a href="/dashboard" style={{ color: "var(--brand2)" }}>
              the dashboard
            </a>
            . Building an app instead? See the{" "}
            <Link href="/docs/dev" style={{ color: "var(--brand2)" }}>
              developer docs →
            </Link>
          </p>
          <div style={{ marginTop: 26 }}>
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-login" /> Open the dashboard
            </a>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="doc">
          <span className="eyebrow">
            <i className="ti ti-list-numbers" /> Getting started
          </span>
          <h2>From sign-up to first send</h2>

          <h3>
            <span className="tag">1</span> Create your account
          </h3>
          <p>
            Go to the <a href="/dashboard">dashboard</a> and create an account. You get an
            organization and a default project automatically — everything (domains, keys,
            logs, suppressions) lives inside your project.
          </p>

          <h3>
            <span className="tag">2</span> Add a sending domain
          </h3>
          <p>
            Under <b>Sending domains</b>, click <b>Add domain</b> and enter the domain you
            want to send from (e.g. <span className="mono">mail.yourcompany.com</span>).
            EMS generates the three DNS records that authenticate your mail —{" "}
            <b>DKIM</b>, <b>SPF</b>, and <b>DMARC</b> — so inbox providers trust it.
          </p>
          <p className="note">
            <i className="ti ti-shield-check" /> These records are how Gmail/Outlook know
            the mail is really from you. Without them, your mail goes to spam — so this
            step matters most.
          </p>

          <h3>
            <span className="tag">3</span> Publish the DNS — one click with a connected DNS
            provider
          </h3>
          <p>
            Open the domain to see the live <b>propagation monitor</b>. If your domain is
            on a connected managed-DNS account, hit <b>Publish DNS automatically</b> and
            all three records are added for you. Otherwise, copy each record into your DNS
            provider.
          </p>
          <p>
            The monitor then checks every few seconds and flips each record from{" "}
            <span className="mono">pending</span> → <span className="mono">verified</span>{" "}
            as it propagates. When DKIM is verified, the domain is ready to send.
          </p>

          <h3>
            <span className="tag">4</span> Send a test email
          </h3>
          <p>
            Use the <b>Send a test email</b> card to fire one off and watch it appear in{" "}
            <b>Recent emails</b> with its status (
            <span className="mono">queued → sent → delivered</span>). That confirms your
            setup end-to-end.
          </p>

          <span className="eyebrow" style={{ marginTop: 36, display: "block" }} id="inbox">
            <i className="ti ti-inbox" /> Hosted inbox
          </span>
          <h2>Check mail without Google Workspace</h2>
          <p>
            After a domain is verified, open it and use the <b>Inboxes</b> tab — or the
            left-nav <b>Inbox</b> — to create addresses like{" "}
            <span className="mono">hello@yourdomain.com</span>. Read, reply, compose, search,
            archive, and trash live in the dashboard. This is for people who need a real
            mailbox on their domain, not a full Workspace seat.
          </p>
          <p>
            Agents and scripts can also claim an instant address on{" "}
            <span className="mono">agents.electronicmailservices.com</span> or{" "}
            <span className="mono">inbox.electronicmailservices.com</span> with no DNS of their own —
            that is the public <span className="mono">/inboxes</span> API, documented in
            the{" "}
            <Link href="/docs/dev#inboxes" style={{ color: "var(--brand2)" }}>
              developer docs
            </Link>
            . Same mailbox store as this dashboard.
          </p>

          <h3>
            <span className="tag">4b</span> Point MX at EMS — without stealing live
            mail
          </h3>
          <p>
            Mail arrives only when the domain&apos;s <b>MX</b> record points at{" "}
            <span className="mono">mail.electronicmailservices.com</span>. The dashboard shows whether
            receiving is ready, and can publish the MX in one click if your DNS provider is
            connected.
          </p>
          <p className="note">
            <i className="ti ti-alert-triangle" /> If Google Workspace or Microsoft 365
            already handles that domain, <b>do not change the apex MX</b> — you would break
            existing mail. Create inboxes on a subdomain instead (for example{" "}
            <span className="mono">inbox.yourdomain.com</span>) and point only that
            subdomain&apos;s MX here.
          </p>

          <h3>
            <span className="tag">4c</span> Forward a copy to Gmail
          </h3>
          <p>
            Inbox → select the address → <b>Settings</b>. Add a destination (your Gmail,
            for example). We email that address a confirm link first — nothing is forwarded
            until they click it, so this cannot be used as an open relay.
          </p>
          <ul style={{ color: "var(--tx2)", fontSize: 15, lineHeight: 1.9 }}>
            <li>
              The copy is sent <b>from this mailbox</b> (so it is DKIM-aligned and actually
              lands). The original From is in Reply-To.
            </li>
            <li>
              <b>Keep a copy in this inbox</b> is on by default. Turn it off only if you
              want the copy in Gmail and nothing stored here.
            </li>
            <li>
              <b>Catch-all</b> sends unknown local-parts on that domain (
              <span className="mono">anything@yourdomain.com</span>) into this mailbox.
              One catch-all per domain.
            </li>
          </ul>
          <p>
            Apple Mail / Outlook IMAP is not shipped yet. Webmail + forwarding is the
            Workspace replacement for most teams. Subscribe a webhook to{" "}
            <span className="mono">email.inbound</span> if an app should see received mail
            — see the{" "}
            <Link href="/docs/dev#inbound" style={{ color: "var(--brand2)" }}>
              developer docs
            </Link>
            .
          </p>

          <span className="eyebrow" style={{ marginTop: 36, display: "block" }}>
            <i className="ti ti-shield-heart" /> Protecting your reputation
          </span>
          <h2>Send clean, stay in the inbox</h2>

          <h3>
            <span className="tag">5</span> Verify a list before you send
          </h3>
          <p>
            Before importing or mailing a list, paste it (or upload a CSV) into{" "}
            <b>Verify a list</b>. EMS checks every address and labels it:
          </p>
          <ul style={{ color: "var(--tx2)", fontSize: 15, lineHeight: 1.9 }}>
            <li>
              <b style={{ color: "var(--ok)" }}>Deliverable</b> — looks good to send.
            </li>
            <li>
              <b style={{ color: "var(--brand2)" }}>Risky</b> — disposable domain, role
              address (admin@, info@), on a blacklist, or already suppressed.
            </li>
            <li>
              <b style={{ color: "#f87171" }}>Undeliverable</b> — invalid format or a
              domain that can&apos;t receive mail.
            </li>
          </ul>
          <p>
            Then <b>Download the clean list</b> or <b>Suppress the bad ones</b> in one
            click — so dead addresses never bounce and drag down your reputation.
          </p>

          <h3>
            <span className="tag">6</span> Suppressions
          </h3>
          <p>
            The <b>Suppressions</b> list is the set of addresses EMS will never send
            to. Hard bounces and complaints are added automatically; you can also add or
            remove addresses yourself. This keeps you from repeatedly mailing people who
            bounced or unsubscribed.
          </p>

          <h3>
            <span className="tag">7</span> Watch your reputation
          </h3>
          <p>
            Authenticated domains + clean lists + steady volume = inbox placement.
            EMS tracks your <b>delivery, bounce, and complaint rates</b> and your
            sending health over time, with targets based on what Gmail expects (bounces
            under 2%, complaints under 0.1%). Keep an eye on these as you ramp up volume.
            Platform status (API, database, queue) is on{" "}
            <Link href="/status" style={{ color: "var(--brand2)" }}>
              /status
            </Link>
            .
          </p>
          <p className="note">
            <i className="ti ti-flame" /> New domain or IP? Warm it up — start with low
            volume to engaged recipients and increase gradually. Sudden large sends from a
            cold sender are the fastest way into spam.
          </p>

          <span className="eyebrow" style={{ marginTop: 36, display: "block" }}>
            <i className="ti ti-plug" /> Connecting your app
          </span>
          <h2>When you&apos;re ready to automate</h2>

          <h3>
            <span className="tag">8</span> Create an API key
          </h3>
          <p>
            Under <b>API keys</b>, click <b>New key</b> — it&apos;s shown once, so copy it
            somewhere safe. Hand it to your developer (or your app&apos;s settings) and they can
            send programmatically. Set up <b>Webhooks</b> too, to get notified when mail is
            delivered, bounces, or is marked spam.
          </p>
          <p>
            Everything technical — sending from code, the{" "}
            <span className="mono">EMS</span> npm package, verification API,
            webhooks, and the MCP server for AI agents — is in the{" "}
            <Link href="/docs/dev" style={{ color: "var(--brand2)" }}>
              developer docs
            </Link>
            .
          </p>
        </div>
      </section>

      <section>
        <div className="wrap center">
          <h2>Ready to send</h2>
          <p className="muted">
            Add your domain, verify your list, and put your first email through — all from
            the dashboard.
          </p>
          <div className="cta">
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Open the dashboard
            </a>
            <Link className="btn lg" href="/docs/dev">
              <i className="ti ti-code" /> Developer docs
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
