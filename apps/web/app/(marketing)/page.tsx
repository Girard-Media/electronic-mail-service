import type { Metadata } from "next";
import Link from "next/link";

// Landing page. Static + ISR (regenerated at most hourly). No DB / no @ems/core
// import here, so `next build` prerenders it without any env or DB connection.
//
// E18-001: the inherited usermails landing (transactional, Resend-compatible,
// pricing tiers) was stripped. This is a deliberately plain placeholder that only
// states what AGENTS.md / SEED.md already commit to; the real marketing site and
// any pricing are owner decisions still to come.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: {
    absolute: "EMS — cold B2B outreach on infrastructure we own",
  },
  description:
    "Cold B2B outreach on servers, IPs, a mail transfer agent, and a mail log we operate end to end, so inbox placement is measured and controlled rather than rented.",
};

const GATES: { icon: string; title: string; body: string }[] = [
  {
    icon: "ti-gavel",
    title: "Policy before anything sends",
    body: "Jurisdiction, consent, suppression, and content checks run on every message. A blocked message never reaches the mail server.",
  },
  {
    icon: "ti-user-check",
    title: "Verified recipients",
    body: "Recipient validity is checked, cached, and re-checked when stale, so bounces stay low.",
  },
  {
    icon: "ti-route",
    title: "Routing across your mailbox pool",
    body: "Each campaign uses its own pool of domains and mailboxes. Sends rotate across them under per-mailbox, per-domain, and per-IP limits.",
  },
  {
    icon: "ti-gauge",
    title: "Pacing that protects reputation",
    body: "Token buckets per mailbox, domain, IP, and recipient mail provider defer a send rather than burn a sender.",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>
            Cold outreach on infrastructure <span className="g">we own</span>.
          </h1>
          <p className="sub">
            Our servers, our IPs, our mail server, our mail log. Reputation is the
            scarce resource, so EMS budgets it per mailbox, domain, and IP instead of
            renting someone else&apos;s.
          </p>
          <div className="cta">
            <a className="btn pri lg" href="/dashboard">
              <i className="ti ti-layout-dashboard" aria-hidden="true" /> Open the dashboard
            </a>
            <Link className="btn lg" href="/status">
              <i className="ti ti-activity-heartbeat" aria-hidden="true" /> Service status
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">One send path, no bypasses</span>
            <h2>Every message passes the same gates</h2>
          </div>
          <div className="grid g2">
            {GATES.map((g) => (
              <div className="card" key={g.title}>
                <div className="ic">
                  <i className={`ti ${g.icon}`} aria-hidden="true" />
                </div>
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
