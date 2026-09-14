# ems-migrate

Move to ems from another email provider **or outreach platform** —
**read-only** on the source, so nothing in your old account is touched. It
pulls your domains, templates, contacts, API-key inventory — and, from
outreach sources, campaigns with their sequenced steps, lead lists, sending
mailboxes, and suppressions — and writes a ready-to-follow migration kit.

Supported sources today: **Resend**, **SendGrid**, **Postmark**, **Mailgun**
(transactional ESPs). Outreach sources (**Instantly, Smartlead, Lemlist, …**)
plug in through the same `MigrationSource` interface — implement it in
`src/sources/` and the kit writer already knows how to emit campaigns,
`lead-lists/*.csv`, and `suppressions.csv`.

## Use it

```bash
# read-only pull of your account (writes ./ems-migration by default)
npx ems-migrate resend   --from re_xxxxxxxx
npx ems-migrate sendgrid --from SG.xxxxxxxx
# Postmark uses two tokens: a Server token (templates) and an Account token (domains)
npx ems-migrate postmark --from <server-token> --account-token <account-token>
# Mailgun is Basic-auth + region-bound; add --eu for the EU host
npx ems-migrate mailgun  --from key-xxxxxxxx [--eu]

# keys can come from the env instead of --from
RESEND_API_KEY=re_xxxxxxxx npx ems-migrate resend --out ./my-migration
```

Prefer not to touch a terminal? The ems dashboard has an **Import from
Resend** button (Domains → Import) that runs the same read-only scan, adds your
domains in one click, and lets you download templates + contacts — no CLI.

Output (`./ems-migration/` by default):

```
report.md            # the plan: inventory, checklist, and the code-swap diff
templates/*.html     # each broadcast/template body, ready to reuse
audiences/*.csv      # each contact list (email,first_name,last_name,unsubscribed)
```

## The seamless part: switch your code in one line

ems speaks Resend's wire format, so your application code barely changes:

```diff
- import { Resend } from "resend";
+ import { Resend } from "ems/compat";

  const resend = new Resend(process.env.EMS_API_KEY);
  await resend.emails.send({ from, to, subject, html });
```

Method names, parameters (snake_case **and** camelCase accepted), and the
`{ data, error }` return envelope all match resend-node. Prefer the native
client? `import { EMS } from "ems"`.

## What migrates, and what doesn't (yet)

| Resource | What happens |
| --- | --- |
| **Domains** | Inventoried with status. You re-verify each in ems (it signs with its own DKIM, so old DNS can't be copied). |
| **Templates / broadcasts** | HTML/text bodies exported to `templates/`. |
| **Audiences / contacts** | Exported to `audiences/*.csv`. |
| **Campaigns (outreach)** | Steps, delays, subjects, and attached mailboxes rendered into `report.md` — recreate each as an EMS sequence. |
| **Lead lists (outreach)** | Exported to `lead-lists/*.csv` — import via EMS lead import. |
| **Mailboxes (outreach)** | Inventoried with status/caps. Credentials never export — re-provision on EMS domains and warm each on its own curve (never share pools across clients, D4). |
| **Suppressions (outreach)** | Exported to `suppressions.csv` — **import FIRST** (I1: no unsuppressed send is a Sev-1 matter). |
| **API keys** | Names listed (secrets are never exportable anywhere). Create fresh keys in ems. |
| **Webhooks** | Not exposed by Resend's API — recreate endpoints in the ems dashboard. |

## Programmatic API

```ts
import { runMigration, ResendSource } from "ems-migrate";

const { inventory, write } = await runMigration(
  new ResendSource({ apiKey: process.env.RESEND_API_KEY! }),
  "./ems-migration",
);
console.log(`${inventory.domains.length} domains, kit at ${write.reportPath}`);
```

Everything is `fetch` + the Node stdlib — no third-party dependencies.
