import type { Metadata } from "next";
import Link from "next/link";

// Landing page. Static + ISR (regenerated at most hourly). No DB / no @ems/core
// import here, so `next build` prerenders it without any env or DB connection.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: {
    absolute: "EMS — application email on infrastructure you control",
  },
  description:
    "Developer-first, white-label application email. A drop-in Resend-compatible API on a mail server we operate — delivered, bounced, and complained are real events, not a send count.",
};

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <span className="pill">
            <i className="ti ti-plug-connected" style={{ fontSize: 15 }} /> Drop-in
            compatible API · drop-in migration
          </span>
          <h1>
            Application email, on infrastructure <span className="g">you control</span>.
          </h1>
          <p className="sub">
            The email your app <em>has</em> to send — password resets, receipts, alerts —
            through a Resend-compatible API on a mail server we operate. White-label
            multi-tenancy from the schema up. No third-party black box.
          </p>
          <div className="cta">
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-rocket" /> Start free
            </a>
            <Link className="btn lg" href="/docs">
              <i className="ti ti-code" /> Read the docs
            </Link>
          </div>
          <pre className="code">
            <span className="c"># Point your existing email client at our base URL — your code keeps working.</span>
            {"\n"}
            <span className="k">curl</span> https://api.electronicmailservices.com/emails \{"\n"}
            {"  "}-H <span className="s">&quot;Authorization: Bearer um_live_••••&quot;</span> \{"\n"}
            {"  "}-d <span className="p">from</span>=
            <span className="s">&quot;you@yourapp.com&quot;</span> \{"\n"}
            {"  "}-d <span className="p">to</span>=
            <span className="s">&quot;user@example.com&quot;</span> \{"\n"}
            {"  "}-d <span className="p">subject</span>=
            <span className="s">&quot;Welcome aboard&quot;</span> \{"\n"}
            {"  "}-d <span className="p">html</span>=
            <span className="s">&quot;&lt;strong&gt;You&apos;re in.&lt;/strong&gt;&quot;</span>
          </pre>
        </div>
      </section>

      <div className="band">
        <div className="wrap" style={{ padding: "42px 24px" }}>
          <div className="stats">
            <div className="stat">
              <div className="n">1 line</div>
              <div className="l">to migrate from Resend</div>
            </div>
            <div className="stat">
              <div className="n">Own MTA</div>
              <div className="l">Postfix we operate, not a reseller</div>
            </div>
            <div className="stat">
              <div className="n">Delivered</div>
              <div className="l">from the mail server — not just &quot;sent&quot;</div>
            </div>
            <div className="stat">
              <div className="n">100%</div>
              <div className="l">white-label, multi-tenant</div>
            </div>
          </div>
        </div>
      </div>

      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Everything application email needs</span>
            <h2>Built for developers, owned end to end</h2>
            <p>
              A drop-in sending API, real delivery events from the mail server, and
              tenancy that agencies can resell.
            </p>
          </div>
          <div className="grid g3">
            <div className="card">
              <div className="ic">
                <i className="ti ti-plug-connected" />
              </div>
              <h3>Drop-in compatible API</h3>
              <p>
                Accepts the same payloads as the Resend SDK. Migrate by changing a base
                URL — no rewrite, no lock-in.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-shield-check" />
              </div>
              <h3>Authenticated sending</h3>
              <p>
                Guided SPF/DKIM/DMARC, one-click DNS on supported providers, and a
                verified-domain gate so you can&apos;t send as a domain you don&apos;t own.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-building-store" />
              </div>
              <h3>White-label multi-tenant</h3>
              <p>
                Orgs → projects → keys from the schema up. Agencies and platforms resell
                email under their own brand and domain.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-webhook" />
              </div>
              <h3>Signed webhooks</h3>
              <p>
                HMAC-signed <span className="mono">email.sent</span>,{" "}
                <span className="mono">delivered</span>,{" "}
                <span className="mono">bounced</span>, and{" "}
                <span className="mono">complained</span> events, retried with backoff.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-list-search" />
              </div>
              <h3>Logs &amp; observability</h3>
              <p>
                Recent message logs with a per-message event timeline — queued, sent,
                delivered, bounced, complained. Optional open/click tracking per domain.
              </p>
            </div>
            <div className="card">
              <div className="ic">
                <i className="ti ti-server-bolt" />
              </div>
              <h3>Our own mail server</h3>
              <p>
                Sends go through Postfix we operate. Delivery status comes from that
                server, not from a shared third-party pool we can&apos;t see into.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="band">
        <div className="wrap" style={{ padding: "70px 24px" }}>
          <div className="grid g2" style={{ alignItems: "center", gap: 48 }}>
            <div>
              <span className="eyebrow">Deliverability</span>
              <h2 style={{ fontSize: "clamp(26px,3.6vw,36px)", marginTop: 12 }}>
                &quot;Sent&quot; is not the metric. Delivered is.
              </h2>
              <p className="muted" style={{ fontSize: 17, marginTop: 14 }}>
                We run the mail server, so a 250 from the receiving host becomes a
                delivered event — and a hard bounce or complaint auto-suppresses before
                the next send. Seed-list inbox-vs-spam tests and dedicated-IP warmup are
                on the roadmap; we don&apos;t pretend they ship today.
              </p>
              <div style={{ marginTop: 22 }}>
                <Link className="btn" href="/deliverability">
                  How deliverability works <i className="ti ti-arrow-right" />
                </Link>
              </div>
            </div>
            <div className="card" style={{ padding: 8 }}>
              <pre className="code" style={{ margin: 0 }}>
                {"  "}<span className="c">domain</span>   acme.com            <span className="s">verified ✓</span>{"\n"}
                {"  "}<span className="c">SPF</span>      aligned             <span className="s">✓</span>{"\n"}
                {"  "}<span className="c">DKIM</span>     published           <span className="s">✓</span>{"\n"}
                {"  "}<span className="c">DMARC</span>    p=quarantine        <span className="s">✓</span>{"\n"}
                {"  "}<span className="c">status</span>   delivered           <span className="s">250 ✓</span>
              </pre>
            </div>
          </div>
        </div>
      </div>

      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Pricing</span>
            <h2>Published rates. Billing isn&apos;t live yet.</h2>
            <p>
              Early access: no credit card. New accounts start on Free. Send caps below
              are already enforced; we are not charging the list prices yet.
            </p>
          </div>
          <div className="price-grid">
            <div className="tier">
              <div className="name">Free</div>
              <div className="price">$0</div>
              <ul>
                <li><i className="ti ti-check" />3,000 emails / mo (hard cap)</li>
                <li><i className="ti ti-check" />1 domain · full API</li>
                <li><i className="ti ti-check" />Logs &amp; webhooks</li>
              </ul>
            </div>
            <div className="tier feat">
              <div className="name">Pro</div>
              <div className="price">$18<span> / mo</span></div>
              <ul>
                <li><i className="ti ti-check" />50,000 emails / mo (hard cap)</li>
                <li><i className="ti ti-check" />10 domains · DKIM/DMARC</li>
                <li><i className="ti ti-check" />Signed webhooks</li>
              </ul>
            </div>
            <div className="tier">
              <div className="name">Scale</div>
              <div className="price">$80<span> / mo</span></div>
              <ul>
                <li><i className="ti ti-check" />500,000 emails / mo (hard cap)</li>
                <li><i className="ti ti-check" />Custom domain + branding</li>
                <li><i className="ti ti-check" />50 domains</li>
              </ul>
            </div>
            <div className="tier">
              <div className="name">White-label</div>
              <div className="price">$400<span>+ / mo</span></div>
              <ul>
                <li><i className="ti ti-check" />Resell under your brand</li>
                <li><i className="ti ti-check" />Sub-accounts + usage rollups</li>
                <li><i className="ti ti-check" />5M emails / mo (hard cap)</li>
              </ul>
            </div>
          </div>
          <div className="center" style={{ marginTop: 28 }}>
            <Link className="btn" href="/pricing">
              Full pricing &amp; comparison <i className="ti ti-arrow-right" />
            </Link>
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
              Ship your first email in five minutes.
            </h2>
            <p className="muted" style={{ fontSize: 18, margin: "14px auto 0", maxWidth: "52ch" }}>
              Create a key, point your existing client at EMS, send. Watch it land
              in your logs as delivered — or bounced, with a reason.
            </p>
            <div className="cta">
              <a className="btn pri lg" href="/dashboard">
                <i className="ti ti-rocket" /> Start free
              </a>
              <Link className="btn lg" href="/docs">
                Quickstart
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
