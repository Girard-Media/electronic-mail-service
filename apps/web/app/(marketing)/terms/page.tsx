import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Early-access terms for EMS. Send caps are enforced; list prices are not billed yet. No SLA is published.",
};

export default function TermsPage() {
  return (
    <LegalDoc eyebrow="Legal" title="Terms of use" updated="23 August 2026">
      <p>
        EMS is in early access. These terms describe how the running
        service behaves. They are not a substitute for a negotiated enterprise
        agreement. Prepared for counsel review — not legal advice.
      </p>

      <h2>The service</h2>
      <p>
        We provide a Resend-compatible application-email API, a dashboard, and
        optional hosted inboxes on infrastructure we operate. Features listed as
        Coming on <Link href="/pricing">Pricing</Link> and{" "}
        <Link href="/features">Features</Link> are not included.
      </p>

      <h2>Accounts</h2>
      <p>
        You must use an email you control. Sending from a EMS-hosted
        address (the system domain or a shared inbox domain) requires a verified
        account email. You are responsible for API keys issued to your project.
        Keys are shown once and stored hashed.
      </p>

      <h2>Acceptable use</h2>
      <p>
        No unsolicited bulk, no harvested lists, no phishing, no malware, no
        attempt to probe or disrupt other tenants or our mail servers. We
        suppress addresses after hard bounces and complaints and enforce that
        list before the next send. We may suspend an org that threatens the
        shared sending reputation.
      </p>

      <h2>Plans and payment</h2>
      <p>
        Send caps on Free / Pro / Scale / White-label are enforced in the API
        today. List prices on the pricing page are what we intend to charge when
        billing is turned on; nothing is billed now. There is no self-serve
        upgrade. Hitting a cap returns a plan-limit error. Dedicated IPs, SSO,
        and warmup are not products today.
      </p>

      <h2>Deliverability</h2>
      <p>
        Authenticated mail from a verified domain is the path we operate. We
        record <em>delivered</em> from our mail server&apos;s own success, not from a
        vendor &quot;sent&quot; count. We do not guarantee inbox placement at any
        provider.
      </p>

      <h2>Data and privacy</h2>
      <p>
        <Link href="/privacy">Privacy</Link> describes what we store. You
        instruct us to process recipient data in order to send. You must have a
        lawful basis to send to those recipients.
      </p>

      <h2>Availability</h2>
      <p>
        Live component status is at <Link href="/status">/status</Link>. No
        uptime SLA is published during early access.
      </p>

      <h2>Termination</h2>
      <p>
        You may delete an eligible account from the dashboard. We may refuse or
        terminate accounts that violate acceptable use or that we cannot
        support in early access.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@electronicmailservices.com">hello@electronicmailservices.com</a>
      </p>
    </LegalDoc>
  );
}
