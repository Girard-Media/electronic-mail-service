import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Security",
  description:
    "How EMS isolates tenants, stores keys, and signs webhooks. SOC 2-aligned practices with documented controls — not a certification.",
};

export default function SecurityPage() {
  return (
    <LegalDoc eyebrow="Trust" title="Security" updated="23 August 2026">
      <p>
        Security is an architectural requirement, not a later add-on. The
        practices below are what the product actually does. We maintain{" "}
        <strong>SOC 2-aligned practices with documented controls and audit
        readiness</strong>. We are not SOC 2 certified. We do not claim
        guaranteed security, full compliance, or that the system is unhackable.
      </p>

      <h2>Isolation</h2>
      <p>
        Every resource belongs to a project under an organization. API keys and
        dashboard sessions resolve that project; queries are scoped to it.
        Sending-access keys can send and read their project; they cannot mint
        keys or manage domains.
      </p>

      <h2>Authentication</h2>
      <ul>
        <li>Dashboard sessions: HS256 JWT in an httpOnly Secure SameSite=Lax cookie, revoked by bumping <span className="mono">tokenVersion</span>.</li>
        <li>API keys: shown once, stored hashed, per-key rate limits.</li>
        <li>God Mode impersonation is re-authorized on every request.</li>
        <li>Customer SSO and customer 2FA are not shipped. Operator MFA is on the follow-up list.</li>
      </ul>

      <h2>Encryption</h2>
      <p>
        TLS in transit at the edge. DKIM private keys and connected-account
        OAuth tokens are encrypted at rest with AES-256-GCM when the instance
        key is set. Password hashes are scrypt. Email bodies in Postgres are
        not field-encrypted.
      </p>

      <h2>Sending controls</h2>
      <ul>
        <li>From domain must be a verified sending domain of that project, a connected mailbox, or a platform-hosted address the project owns.</li>
        <li>Suppression is checked before enqueue, case-normalized.</li>
        <li>Platform-hosted From requires a verified org-owner email.</li>
        <li>Webhook URLs are HTTPS-only and refused if DNS resolves to private, loopback, or metadata ranges. Redirects are not followed.</li>
        <li>Attachment <span className="mono">path</span> is rejected (no server-side fetch).</li>
      </ul>

      <h2>Abuse</h2>
      <p>
        Signup, login, and password-reset are rate-limited per IP and per email.
        Plan send caps are hard stops. Shared inbox domains have a platform kill
        switch. We do not currently publish a bug-bounty program.
      </p>

      <h2>Operations</h2>
      <p>
        Process liveness is <span className="mono">GET /livez</span>. Readiness
        (Postgres + Redis) is <span className="mono">GET /readyz</span>, also
        summarized on <Link href="/status">Status</Link>. Application mail is
        sent from a mail server we operate, not a third-party reseller.
      </p>

      <h2>Report a vulnerability</h2>
      <p>
        Email <a href="mailto:hello@electronicmailservices.com">hello@electronicmailservices.com</a> with
        enough detail to reproduce. Do not test against customer data or send
        live mail to third parties as a proof.
      </p>
    </LegalDoc>
  );
}
