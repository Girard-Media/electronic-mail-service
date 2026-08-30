import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

// Numbers on this page must match packages/core/src/plans.ts. Stripe charging is
// not live: send caps are hard stops, list prices are not billed yet.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Early access: no credit card. Free is 3,000 emails/mo, Pro $18 for 50,000, Scale $80 for 500,000, white-label from $400. Send caps are enforced today; we are not charging the list prices yet.",
};

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        padding: "14px 16px",
        color: "var(--tx2)",
        fontWeight: 600,
        borderBottom: "1px solid var(--line2)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  strong,
  ok,
}: {
  children: ReactNode;
  strong?: boolean;
  ok?: boolean;
}) {
  return (
    <td
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--line)",
        fontWeight: strong ? 600 : 400,
        color: ok ? "var(--ok)" : "var(--tx2)",
      }}
    >
      {children}
    </td>
  );
}

export default function Pricing() {
  return (
    <>
      <section className="hero" style={{ padding: "72px 0 40px" }}>
        <div className="wrap">
          <span className="pill">
            <i className="ti ti-receipt" style={{ fontSize: 15 }} /> Early access · no
            card · caps already enforced
          </span>
          <h1>
            Published rates. Billing isn&apos;t live yet.
          </h1>
          <p className="sub">
            New accounts start on Free. The send caps below are what the API enforces
            today. List prices and overage rates are what we will charge when Stripe is
            on; nothing is billed now.
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="price-grid">
            <div className="tier">
              <div className="name">Free</div>
              <div className="price">$0</div>
              <p className="muted" style={{ margin: 0, fontSize: "13.5px" }}>
                Default for every new account.
              </p>
              <ul>
                <li>
                  <i className="ti ti-check" />
                  3,000 emails / mo (hard cap)
                </li>
                <li>
                  <i className="ti ti-check" />
                  1 domain · 1 webhook
                </li>
                <li>
                  <i className="ti ti-check" />
                  Drop-in compatible API
                </li>
                <li>
                  <i className="ti ti-check" />
                  Logs &amp; signed webhooks
                </li>
                <li>
                  <i className="ti ti-check" />
                  SPF/DKIM/DMARC setup
                </li>
              </ul>
              <a className="btn" href="/dashboard" style={{ marginTop: "auto" }}>
                Start free
              </a>
            </div>
            <div className="tier feat">
              <div className="name">Pro</div>
              <div className="price">
                $18<span> / mo</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: "13.5px" }}>
                List price. Not charged yet.
              </p>
              <ul>
                <li>
                  <i className="ti ti-check" />
                  50,000 emails / mo (hard cap)
                </li>
                <li>
                  <i className="ti ti-check" />
                  $0.70 / 1k overage when billing is on
                </li>
                <li>
                  <i className="ti ti-check" />
                  10 domains · 3 seats
                </li>
                <li>
                  <i className="ti ti-check" />
                  DKIM/DMARC automation
                </li>
                <li>
                  <i className="ti ti-check" />
                  Signed webhooks
                </li>
              </ul>
              <a className="btn pri" href="/dashboard" style={{ marginTop: "auto" }}>
                Start free
              </a>
            </div>
            <div className="tier">
              <div className="name">Scale</div>
              <div className="price">
                $80<span> / mo</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: "13.5px" }}>
                Custom domain and branding.
              </p>
              <ul>
                <li>
                  <i className="ti ti-check" />
                  500,000 emails / mo (hard cap)
                </li>
                <li>
                  <i className="ti ti-check" />
                  $0.55 / 1k overage when billing is on
                </li>
                <li>
                  <i className="ti ti-check" />
                  50 domains · 10 seats
                </li>
                <li>
                  <i className="ti ti-check" />
                  Custom domain + branding
                </li>
                <li>
                  Dedicated IP <span className="soon-tag">Coming</span>
                </li>
              </ul>
              <a className="btn" href="/dashboard" style={{ marginTop: "auto" }}>
                Start free
              </a>
            </div>
            <div className="tier">
              <div className="name">White-label</div>
              <div className="price">
                $400<span>+ / mo</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: "13.5px" }}>
                Agencies reselling under their brand.
              </p>
              <ul>
                <li>
                  <i className="ti ti-check" />
                  5,000,000 emails / mo (hard cap)
                </li>
                <li>
                  <i className="ti ti-check" />
                  $0.30 / 1k wholesale when billing is on
                </li>
                <li>
                  <i className="ti ti-check" />
                  Sub-accounts + usage rollups
                </li>
                <li>
                  <i className="ti ti-check" />
                  Branded domains &amp; dashboards
                </li>
                <li>
                  Dedicated IP <span className="soon-tag">Coming</span>
                </li>
              </ul>
              <a className="btn" href="/dashboard" style={{ marginTop: "auto" }}>
                Talk to us
              </a>
            </div>
          </div>

          <div className="note center" style={{ maxWidth: "760px", margin: "26px auto 0" }}>
            <i className="ti ti-info-circle" style={{ color: "var(--brand2)" }} /> Hitting
            a cap returns a plan-limit error. There is no self-serve upgrade yet; an
            operator can raise the plan. Dedicated IPs and SSO are not products today.
          </div>
        </div>
      </section>

      <div className="band">
        <div className="wrap" style={{ padding: "70px 24px" }}>
          <div className="section-head" style={{ marginBottom: "34px" }}>
            <span className="eyebrow">Head to head</span>
            <h2>Published caps vs the market</h2>
            <p>
              Competitor figures from vendor pricing pages, Jun 2026. Directional, not a
              quote. Our overage column is the published rate for when billing is on;
              sends stop at the cap until then.
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14.5px",
                minWidth: "680px",
              }}
            >
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <Th>Provider</Th>
                  <Th>Free tier</Th>
                  <Th>Entry plan</Th>
                  <Th>Overage / 1k</Th>
                  <Th>Dedicated IP / mo</Th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "var(--brandsoft)" }}>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontWeight: 700,
                      borderBottom: "1px solid var(--line)",
                      borderLeft: "2px solid var(--brand)",
                      color: "var(--brand2)",
                    }}
                  >
                    EMS
                  </td>
                  <Td ok strong>
                    3,000 / mo
                  </Td>
                  <Td ok strong>
                    $18 → 50k
                  </Td>
                  <Td ok strong>
                    $0.70
                  </Td>
                  <Td>
                    Coming
                  </Td>
                </tr>
                <tr>
                  <Td strong>Resend</Td>
                  <Td>3,000 / mo</Td>
                  <Td>$20 → 50k</Td>
                  <Td>$0.90</Td>
                  <Td>$30</Td>
                </tr>
                <tr>
                  <Td strong>Postmark</Td>
                  <Td>100 / mo</Td>
                  <Td>$15 → 10k</Td>
                  <Td>$1.80</Td>
                  <Td>from $50</Td>
                </tr>
                <tr>
                  <Td strong>SendGrid</Td>
                  <Td>None (retired)</Td>
                  <Td>$19.95 → 50k</Td>
                  <Td>Tiered, opaque</Td>
                  <Td>$30</Td>
                </tr>
                <tr>
                  <Td strong>Mailgun</Td>
                  <Td>~3,000 / mo (100/day)</Td>
                  <Td>$15 → 10k</Td>
                  <Td>$1.80</Td>
                  <Td>$59</Td>
                </tr>
              </tbody>
            </table>
          </div>

          <p
            className="muted"
            style={{ fontSize: "13px", marginTop: "18px", textAlign: "center" }}
          >
            SendGrid overage is not transparently published. We do not sell a dedicated
            IP today, so that column is not a price comparison we can win.
          </p>
        </div>
      </div>

      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What is included now</span>
            <h2>Ships with every account. Not an add-on.</h2>
            <p>
              Authentication, suppression, and delivery events from the mail server we
              operate. Seed-list inbox tests and dedicated IPs are on the{" "}
              <Link href="/deliverability">deliverability roadmap</Link>.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <div className="ic">
                <i className="ti ti-shield-check" />
              </div>
              <h3>Auth and bulk-sender headers</h3>
              <p>
                SPF/DKIM/DMARC at domain setup, verified-domain send gate,{" "}
                <span className="mono">List-Unsubscribe</span> and RFC 8058 one-click
                headers on mail we relay. Complaint-rate kill-switch is not live.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-ban" />
              </div>
              <h3>A real cap, not a billing trap</h3>
              <p>
                Free and paid plans stop sending at the monthly cap. That is the same
                check the API runs on every enqueue. No silent overage invoice.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-receipt" />
              </div>
              <h3>Overage math, parked</h3>
              <p>
                $0.70 / 1k on Pro, $0.55 on Scale, $0.30 wholesale on white-label. Those
                rates exist in code for invoices. Charging is not wired, so the cap is
                the whole story today.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Questions</span>
            <h2>Pricing FAQ</h2>
          </div>
          <div className="doc">
            <div className="card">
              <h3 style={{ color: "var(--brand2)", fontSize: "17px", margin: "0 0 8px" }}>
                Is the free tier really free?
              </h3>
              <p style={{ margin: 0 }}>
                Yes. 3,000 emails/mo, 1 domain, the compatible API, logs, and signed
                webhooks. No card, no expiry. Hit the cap and sends pause until the next
                month or an operator raises the plan.
              </p>
            </div>
            <div className="card">
              <h3 style={{ color: "var(--brand2)", fontSize: "17px", margin: "0 0 8px" }}>
                Can I pay for Pro or Scale myself?
              </h3>
              <p style={{ margin: 0 }}>
                Not yet. Stripe is not on, so there is no checkout. Published $18 / $80 /
                $400 rates are the list we will charge. Until then every new account is
                Free unless an operator changes the plan.
              </p>
            </div>
            <div className="card">
              <h3 style={{ color: "var(--brand2)", fontSize: "17px", margin: "0 0 8px" }}>
                Do you sell a dedicated IP?
              </h3>
              <p style={{ margin: 0 }}>
                No. Every tenant sends through the mail server we operate. Dedicated IPs
                and warmup are on the deliverability roadmap, not a $20 add-on and not
                bundled into Scale.
              </p>
            </div>
            <div className="card">
              <h3 style={{ color: "var(--brand2)", fontSize: "17px", margin: "0 0 8px" }}>
                I&apos;m on another email API. How hard is switching?
              </h3>
              <p style={{ margin: 0 }}>
                Point the existing client at{" "}
                <span className="mono">https://api.electronicmailservices.com</span> (Resend SDKs
                honor <span className="mono">RESEND_BASE_URL</span>). No rewrite. Start
                on Free to prove delivery, then we raise the plan when billing is live.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div
            className="card"
            style={{
              textAlign: "center",
              padding: "56px 24px",
              background:
                "radial-gradient(700px 300px at 50% 0%,rgba(109,94,252,.16),transparent 70%)",
            }}
          >
            <h2 style={{ fontSize: "clamp(26px,4vw,38px)" }}>
              Start on Free. Pay when we actually bill.
            </h2>
            <p
              className="muted"
              style={{ fontSize: 18, margin: "14px auto 0", maxWidth: "52ch" }}
            >
              Create a key, point your client at EMS, send. The first 3,000 emails
              each month are free. No credit card.
            </p>
            <div className="cta">
              <a className="btn pri lg" href="/dashboard">
                <i className="ti ti-rocket" /> Start free
              </a>
              <Link className="btn lg" href="/docs">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
