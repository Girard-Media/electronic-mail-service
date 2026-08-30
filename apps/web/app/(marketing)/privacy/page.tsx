import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What EMS stores, why, and how to export or delete an account. Session cookies only; we do not run advertising pixels.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc eyebrow="Legal" title="Privacy" updated="23 August 2026">
      <p>
        This page describes how the EMS product handles personal data. It is
        a description of the running system, not a certification and not a
        guarantee. Counsel should review it before it is treated as a customer
        contract.
      </p>

      <h2>Who we are</h2>
      <p>
        EMS is the application-email service at{" "}
        <a href="https://electronicmailservices.com">electronicmailservices.com</a> and{" "}
        <span className="mono">api.electronicmailservices.com</span>. Contact:{" "}
        <a href="mailto:hello@electronicmailservices.com">hello@electronicmailservices.com</a>.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Account.</strong> Email, password hash, name, email-verification
          timestamp. We never store the API key in recoverable form — only a
          hash and a public prefix.
        </li>
        <li>
          <strong>Mail you send.</strong> Recipients, subject, html/text, tags,
          headers, attachment metadata, and delivery events (queued, sent,
          delivered, bounced, complained, failed, canceled). Bodies live in
          Postgres on servers we operate. There is no automatic time-based
          deletion yet.
        </li>
        <li>
          <strong>Hosted inboxes.</strong> Inbound messages for mailboxes you
          create, plus optional verified forwarding destinations.
        </li>
        <li>
          <strong>Secrets at rest.</strong> DKIM private keys and connected-account
          OAuth tokens are encrypted with AES-256-GCM when a{" "}
          <span className="mono">DKIM_ENC_KEY</span> is configured.
        </li>
      </ul>

      <h2>Why</h2>
      <p>
        To provide the sending API, dashboard, hosted inboxes, bounce/complaint
        handling, and account security you asked for. We do not sell address
        lists. We do not run advertising or analytics pixels on this site.
      </p>

      <h2>Cookies</h2>
      <p>
        Dashboard sessions use host-only cookies (<span className="mono">um_session</span>,
        and when relevant <span className="mono">um_god</span> /{" "}
        <span className="mono">um_activeorg</span>). They are httpOnly, Secure,
        and SameSite=Lax. They are strictly necessary to keep you signed in. There
        is no marketing cookie and no consent banner, because there is nothing
        non-essential to consent to.
      </p>

      <h2>Processors</h2>
      <p>
        Mail is sent from mail servers we operate. DNS and TLS at the edge go
        through Cloudflare when a domain uses that path. Agency billing, if
        enabled on an instance, uses Stripe Connect. Gmail/Outlook connected
        sending is code-complete and is not offered until those OAuth apps are
        registered. Uptime monitors may be provided by Better Stack when
        configured. A current list belongs in a customer DPA; this page will
        not invent signed-contract dates.
      </p>

      <h2>Your rights</h2>
      <p>
        Signed-in users can download an account inventory and, when eligible,
        delete the account from Dashboard → Account → Privacy (
        <span className="mono">GET /app/privacy/export</span>,{" "}
        <span className="mono">POST /app/privacy/delete</span>). Export today is
        an inventory (profile, orgs, project counts) — it does not dump every
        message body. Delete is refused for platform admins, orgs with other
        members, and orgs with sub-accounts; sole-owned orgs are cascaded.
        Email <a href="mailto:hello@electronicmailservices.com">hello@electronicmailservices.com</a> for
        anything the self-serve path cannot do.
      </p>

      <h2>Security</h2>
      <p>
        See <Link href="/security">Security</Link>. We do not claim to be SOC 2
        certified, GDPR certified, or unhackable.
      </p>
    </LegalDoc>
  );
}
