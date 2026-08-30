import type { Metadata } from "next";
import Link from "next/link";

// Deliverability marketing page. Static + ISR. Only claim what the MTA + API
// actually surface today; badge the rest as coming.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Deliverability",
  description:
    "We operate the mail server, so delivered, bounced, and complained are real events — not a send count. SPF/DKIM/DMARC, pre-send suppression, and RFC 8058 unsubscribe ship today. Seed-list inbox tests are on the roadmap.",
};

export default function Deliverability() {
  return (
    <>
      <section className="hero">
        <div className="wrap center">
          <span className="eyebrow">
            <i className="ti ti-shield-check" /> Deliverability
          </span>
          <h1>Sent isn&apos;t the metric. Delivered is.</h1>
          <p className="muted" style={{ maxWidth: 680, margin: "18px auto 0" }}>
            Most providers report &quot;sent&quot; when they accepted your API call. We
            run Postfix, so a 250 from the receiving host becomes{" "}
            <span className="mono">delivered</span> — and a hard bounce or complaint
            auto-suppresses before the next send. Inbox-vs-spam seed tests are coming; we
            don&apos;t sell them as live.
          </p>
          <div
            style={{
              marginTop: 26,
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Authenticate a domain
            </a>
            <Link className="btn lg" href="/docs">
              <i className="ti ti-book" /> Read the docs
            </Link>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="stats">
            <div className="stat">
              <span className="n">Own MTA</span>
              <span className="l">Postfix we operate — delivery status from the log</span>
            </div>
            <div className="stat">
              <span className="n">Auth</span>
              <span className="l">SPF + DKIM generated; sending gated on verified</span>
            </div>
            <div className="stat">
              <span className="n">Pre-send</span>
              <span className="l">Hard bounce and complaint auto-suppress</span>
            </div>
            <div className="stat">
              <span className="n">RFC 8058</span>
              <span className="l">List-Unsubscribe + one-click headers injected</span>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="section-head center">
          <span className="eyebrow">
            <i className="ti ti-stack-2" /> What ships today
          </span>
          <h2>Four layers between your API call and the receiving server</h2>
          <p className="muted">
            Each one is live in production. The suite that is not live is listed below,
            not mixed in.
          </p>
        </div>

        <div className="grid g2">
          <div className="card">
            <span className="ic">
              <i className="ti ti-certificate" />
            </span>
            <h3>Authentication &amp; alignment</h3>
            <p>
              Auto-generated DKIM keys, derived SPF and DMARC, optional custom MAIL FROM.
              One-click DNS publishing on supported providers, copy-paste records for any
              registrar, and live re-verification. Unverified domains cannot send.
            </p>
          </div>
          <div className="card">
            <span className="ic">
              <i className="ti ti-filter" />
            </span>
            <h3>List hygiene &amp; suppression</h3>
            <p>
              Hard bounces and complaints auto-suppress, and the per-project list is
              enforced pre-send. Optional <span className="mono">/verify</span> checks
              syntax, MX, disposable and role accounts, and Spamhaus DBL before a message
              leaves.
            </p>
          </div>
          <div className="card">
            <span className="ic">
              <i className="ti ti-mail-check" />
            </span>
            <h3>Delivery events from the mail server</h3>
            <p>
              Bounce and complaint arrive via DSN/ARF. Delivered is derived from Postfix{" "}
              <span className="mono">status=sent (250 …)</span> — not from hoping a
              receiver honors <span className="mono">NOTIFY=SUCCESS</span>. Signed
              webhooks fire for sent, delivered, bounced, and complained.
            </p>
          </div>
          <div className="card">
            <span className="ic">
              <i className="ti ti-discount-check" />
            </span>
            <h3>Bulk-sender headers</h3>
            <p>
              <span className="mono">List-Unsubscribe</span> and RFC 8058 one-click
              headers are injected on mail we relay. DMARC records are generated at
              domain setup with a guided path from <span className="mono">p=none</span>{" "}
              toward enforcement.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="section-head center">
          <span className="eyebrow">
            <i className="ti ti-mailbox" /> Google and Yahoo rules
          </span>
          <h2>What we handle automatically — and what we don&apos;t yet</h2>
        </div>

        <div className="doc">
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "14.5px" }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line2)" }}>
                <th style={{ padding: "14px 16px", fontWeight: 600 }}>Requirement</th>
                <th style={{ padding: "14px 16px", fontWeight: 600 }}>Today</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                  SPF + DKIM aligned
                </td>
                <td style={{ padding: "14px 16px" }}>
                  <i className="ti ti-check" style={{ color: "var(--ok)" }} /> Keys and
                  records generated at domain setup; sending is blocked until the domain
                  is verified.
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 600 }}>DMARC published</td>
                <td style={{ padding: "14px 16px" }}>
                  <i className="ti ti-check" style={{ color: "var(--ok)" }} /> DMARC
                  derived automatically with a guided path from{" "}
                  <span className="mono">p=none</span> to enforcement.
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                  One-click unsubscribe
                </td>
                <td style={{ padding: "14px 16px" }}>
                  <i className="ti ti-check" style={{ color: "var(--ok)" }} />{" "}
                  <span className="mono">List-Unsubscribe</span> and one-click headers
                  injected; processed immediately.
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                  Complaint rate under 0.3%
                </td>
                <td style={{ padding: "14px 16px" }}>
                  We record complaints and show the rate on the dashboard. Automatic
                  throttle / kill-switch is not live yet.
                </td>
              </tr>
              <tr>
                <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                  Forward &amp; reverse DNS
                </td>
                <td style={{ padding: "14px 16px" }}>
                  We operate the sending hosts. PTR cutover for the public sending IP is
                  an ops task, not a self-serve product.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">
              <i className="ti ti-sparkles" /> On the roadmap
            </span>
            <h2>The rest of the deliverability suite</h2>
            <p className="muted">
              These are the paid, defensible layer. They are not in the product today.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <span className="ic">
                <i className="ti ti-network" />
              </span>
              <h3>
                Dedicated IP pools <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Per-tenant or per-stream IPs so a campaign cannot poison password resets.
                Today every tenant shares the mail server we operate.
              </p>
            </div>
            <div className="card">
              <span className="ic">
                <i className="ti ti-temperature" />
              </span>
              <h3>
                Automated warmup <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Volume ramps per IP per day that react to bounce and complaint signals.
              </p>
            </div>
            <div className="card">
              <span className="ic">
                <i className="ti ti-inbox" />
              </span>
              <h3>
                Seed-list placement <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Inbox / spam / missing, per mailbox provider. Until then we report
                accepted-by-receiver, not folder placement.
              </p>
            </div>
            <div className="card">
              <span className="ic">
                <i className="ti ti-radar" />
              </span>
              <h3>
                Customer blocklist alerts <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Platform operators already see DNSBL checks in God Mode. Tenant-facing
                listing alerts are not shipped.
              </p>
            </div>
            <div className="card">
              <span className="ic">
                <i className="ti ti-file-report" />
              </span>
              <h3>
                DMARC report ingest <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Parsed aggregate reports — who sends as you, and where alignment fails.
              </p>
            </div>
            <div className="card">
              <span className="ic">
                <i className="ti ti-shield-x" />
              </span>
              <h3>
                Abuse auto-throttle <span className="soon-tag">Coming</span>
              </h3>
              <p>
                Signup screening, send-pattern anomaly detection, and a complaint-rate
                kill-switch. Plan send caps are already enforced.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="cta center">
          <h2>Stop guessing whether the receiver accepted it.</h2>
          <p className="muted" style={{ maxWidth: 600, margin: "14px auto 0" }}>
            Authenticate a domain in minutes, send through a mail server we operate, and
            watch delivered / bounced / complained on the same dashboard. Drop-in
            compatible API — change the base URL and you&apos;re sending.
          </p>
          <div
            style={{
              marginTop: 26,
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Start free
            </a>
            <Link className="btn lg" href="/docs">
              <i className="ti ti-arrows-exchange" /> Migrate from your current provider
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
