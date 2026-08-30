#!/usr/bin/env node
// ems-migrate — CLI for pulling another ESP's account into a ems
// migration kit. Read-only on the source.
//
//   ems-migrate resend --from re_xxx [--out ./ems-migration]
//   RESEND_API_KEY=re_xxx ems-migrate resend
//
import { runMigration } from "./index.js";
import { ResendSource } from "./sources/resend.js";
import { SendGridSource } from "./sources/sendgrid.js";
import { PostmarkSource } from "./sources/postmark.js";
import { MailgunSource } from "./sources/mailgun.js";
import type { MigrationSource } from "./types.js";

interface Args {
  source?: string;
  from?: string;
  accountToken?: string;
  region?: string;
  out: string;
  help: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = { out: "./ems-migration", help: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "-h" || t === "--help") a.help = true;
    else if (t === "--from") a.from = rest[++i];
    else if (t === "--account-token") a.accountToken = rest[++i];
    else if (t === "--region") a.region = rest[++i];
    else if (t === "--eu") a.region = "eu";
    else if (t === "--out") a.out = rest[++i] ?? a.out;
    else if (t && !t.startsWith("-") && !a.source) a.source = t;
  }
  return a;
}

const USAGE = `ems-migrate — move to ems from another ESP (read-only on the source)

Usage:
  ems-migrate resend   --from <RESEND_API_KEY>   [--out <dir>]
  ems-migrate sendgrid --from <SENDGRID_API_KEY> [--out <dir>]
  ems-migrate postmark --from <SERVER_TOKEN> --account-token <ACCOUNT_TOKEN> [--out <dir>]
  ems-migrate mailgun  --from <MAILGUN_API_KEY> [--eu] [--out <dir>]

Options:
  --from <key>            Source API key (Postmark: its Server token). Env fallback:
                          RESEND_API_KEY / SENDGRID_API_KEY / POSTMARK_SERVER_TOKEN / MAILGUN_API_KEY.
  --account-token <key>   Postmark Account token (for domains). Env: POSTMARK_ACCOUNT_TOKEN.
  --region <us|eu>        Mailgun region (default us). Or pass --eu. Env: MAILGUN_REGION.
  --out <dir>             Output directory (default ./ems-migration)
  -h, --help              Show this help

Writes: report.md (plan + checklist + code-swap), templates/*.html, audiences/*.csv
`;

/** Build the right source for the chosen provider, or return an error string. */
function buildSource(a: Args): MigrationSource | string {
  switch (a.source) {
    case "resend": {
      const apiKey = a.from ?? process.env.RESEND_API_KEY;
      if (!apiKey) return "Missing Resend key — pass --from <key> or set RESEND_API_KEY.";
      return new ResendSource({ apiKey });
    }
    case "sendgrid": {
      const apiKey = a.from ?? process.env.SENDGRID_API_KEY;
      if (!apiKey) return "Missing SendGrid key — pass --from <key> or set SENDGRID_API_KEY.";
      return new SendGridSource({ apiKey });
    }
    case "postmark": {
      const serverToken = a.from ?? process.env.POSTMARK_SERVER_TOKEN;
      const accountToken = a.accountToken ?? process.env.POSTMARK_ACCOUNT_TOKEN;
      if (!serverToken && !accountToken) {
        return "Missing Postmark token — pass --from <server-token> and/or --account-token <account-token>.";
      }
      return new PostmarkSource({ serverToken, accountToken });
    }
    case "mailgun": {
      const apiKey = a.from ?? process.env.MAILGUN_API_KEY;
      if (!apiKey) return "Missing Mailgun key — pass --from <key> or set MAILGUN_API_KEY.";
      const region = (a.region ?? process.env.MAILGUN_REGION) === "eu" ? "eu" : "us";
      return new MailgunSource({ apiKey, region });
    }
    default:
      return `Unknown source "${a.source}". Supported: resend, sendgrid, postmark, mailgun.`;
  }
}

async function main(): Promise<number> {
  const args = parse(process.argv);
  if (args.help || !args.source) {
    process.stdout.write(USAGE);
    return args.help ? 0 : 1;
  }

  const source = buildSource(args);
  if (typeof source === "string") {
    process.stderr.write(source + "\n");
    return 1;
  }

  process.stdout.write(`Reading your ${source.name} account (read-only)…\n`);
  const { inventory: inv, write } = await runMigration(source, args.out);

  const contacts = inv.audiences.reduce((n, a) => n + a.contacts.length, 0);
  process.stdout.write(
    `\nFound: ${inv.domains.length} domain(s), ${inv.audiences.length} audience(s) ` +
      `(${contacts} contacts), ${inv.templates.length} template(s), ${inv.apiKeys.length} API key(s).\n`,
  );
  process.stdout.write(`Wrote ${write.files.length} file(s) to ${args.out}\n`);
  process.stdout.write(`\nNext: open ${write.reportPath} for the step-by-step plan.\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`\nMigration failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
