# Custom domains (white-label) — runbook

Lets a tenant serve their white-label surface on their OWN hostname, e.g.
`mail.acme.com`, instead of `acme.electronicmailservices.com`. The **app side is built** (Phase 4);
the **edge side (Cloudflare for SaaS) is paid + ops-gated** and is enabled per the steps
below.

## How it routes (already implemented in apps/web)

```
mail.acme.com/<path>
  → Cloudflare for SaaS (custom hostname, per-host cert) → our fallback origin
  → apps/web proxy.ts: classifyHost() = { kind: "custom", host: "mail.acme.com" }
  → rewrite to /domain/mail.acme.com/<path>
  → app/domain/[host] resolves Organization.customDomain == "mail.acme.com"
     (getOrgByCustomDomain, re-validated) → branded surface, or 404 if unknown
```

`proxy.ts` never touches the DB, so any non-root host is optimistically rewritten to
`/domain/<host>`; the route is the authority (404 for an unregistered host).

## One-time platform setup (Cloudflare for SaaS — PAID)

1. Enable **Cloudflare for SaaS / SSL for SaaS** on the `electronicmailservices.com` zone (paid
   add-on; Custom Hostnames are billed per active hostname).
2. Create a **fallback origin** that points at the app box, e.g.
   `cname.electronicmailservices.com` → `31.220.104.207` (the Coolify app host serving apps/web).
   Set it as the zone's Custom Hostname fallback origin.
3. Mint a scoped API token: **Zone › SSL and Certificates › Edit** +
   **Zone › Custom Hostnames › Edit** for the zone. Store as `CLOUDFLARE_API_TOKEN`
   (+ `CLOUDFLARE_ZONE_ID`) in the apps/web Coolify env — these are the SAME vars the
   `/api/revalidate` Cloudflare purge already reads.

## Per-tenant onboarding flow (to wire into the dashboard, Phase 5)

1. Tenant enters `mail.acme.com` in their dashboard.
2. **Verify ownership BEFORE storing** `Organization.customDomain`: have the tenant add a
   DNS `TXT _ems-challenge.mail.acme.com = <random token>` (or an HTTP token), and
   confirm it. This stops org A from claiming `mail.bigbank.com`. The column is `@unique`
   so the host can't be double-claimed, but first-claim-wins is unsafe without this
   ownership proof.
3. Create the Cloudflare Custom Hostname (issues a per-hostname cert):
   ```
   POST https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/custom_hostnames
   Authorization: Bearer <CLOUDFLARE_API_TOKEN>
   { "hostname": "mail.acme.com", "ssl": { "method": "http", "type": "dv" } }
   ```
4. Tenant points DNS: `CNAME mail.acme.com → cname.electronicmailservices.com` (the fallback origin).
5. Poll the custom-hostname status until `ssl.status = active`; then set
   `Organization.customDomain = "mail.acme.com"`. The surface is now live.
6. On removal: delete the Custom Hostname (DELETE the CF resource) AND clear
   `customDomain` so the host stops resolving to the tenant.

## Security notes

- **Ownership verification is mandatory** (step 2) — the cert proves control for TLS, but
  routing/branding must not activate until we've proven the tenant controls the name.
- The `/domain/[host]` route re-validates the host (`isValidHostname`) and re-resolves
  the org by `customDomain`; the public surface shows branding only. Tenant-private data
  (Phase 5) must be scoped by the resolved `org.id`, never by the host.
- **Host-only session cookies** (no `Domain=`) remain mandatory — a custom domain is a
  separate origin, which actually *helps* isolation, but the wildcard `*.electronicmailservices.com`
  subdomains still require host-only cookies (see Phase 3).

## Status

App routing + resolution: **done** (apps/web `proxy.ts`, `app/domain/[host]`,
`getOrgByCustomDomain`). Cloudflare for SaaS provisioning + the dashboard onboarding UI:
**pending** (paid; enable when the first white-label tenant needs a vanity domain).
