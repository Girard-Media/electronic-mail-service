# Data-incident 72-hour clock

Prepared for counsel review — not legal advice. Not a claim of GDPR/CCPA certification.

When personal data may have been accessed without authorization:

1. **Hour 0 — contain.** Rotate `AUTH_SECRET` / `DKIM_ENC_KEY` / `MTA_FEEDBACK_SECRET` / API keys as indicated. Disable the shared-inbox kill switch (`SHARED_INBOX_SENDING=off`) if the pooled domain is involved. Impersonation requires TOTP.
2. **Hour 0–4 — facts.** What rows, which projects, which processor (Postgres, Redis, Cloudflare, MTA logs). Do not notify until counsel says so.
3. **Hour 4–24 — counsel.** Owner + counsel decide if Art. 33 / CCPA thresholds are met. Draft language lives with counsel, not in this repo.
4. **Hour 24–72 — notify if required.** Supervisory authority (GDPR 72h from awareness) and affected users. Owner files; agents only prepare.
5. **After — postmortem.** Blameless, written, stored with the audit log.

Contacts: `hello@electronicmailservices.com`. Status page: `/status`.
