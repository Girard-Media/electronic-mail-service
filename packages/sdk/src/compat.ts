/**
 * Resend drop-in compatibility layer.
 *
 * ems speaks Resend's wire format, so migrating your code is a ONE-LINE
 * change — swap the import, keep everything else:
 *
 *   - import { Resend } from "resend";
 *   + import { Resend } from "ems/compat";
 *
 *   const resend = new Resend(process.env.EMS_API_KEY);
 *   const { data, error } = await resend.emails.send({
 *     from: "you@yourdomain.com",
 *     to: "user@acme.com",
 *     subject: "Hi",
 *     html: "<p>Hello</p>",
 *   });
 *
 * Method names, parameters (snake_case AND camelCase accepted), and the
 * `{ data, error }` return envelope all match resend-node, so existing call
 * sites keep working — now sending through ems' own infrastructure.
 *
 * Not yet supported (these throw a clear error rather than failing silently):
 *   • `react:` rendering — pre-render with @react-email/render to `html`.
 *   • audiences / contacts / broadcasts — ems is transactional-first;
 *     use `ems-migrate` to export those from Resend.
 */
import { EMS, EMSError } from "./index.js";
import type { SendEmailParams } from "./index.js";

export interface ResendOptions {
  /** Defaults to https://api.electronicmailservices.com */
  baseUrl?: string;
  /** Override fetch (tests / custom agents). */
  fetch?: typeof fetch;
}

/** Resend's response envelope: exactly one of `data` / `error` is non-null. */
export type ResendResult<T> = {
  data: T | null;
  error: { message: string; name: string } | null;
};

/** Resend's CreateEmailOptions — snake_case canonical, camelCase also accepted. */
export interface ResendEmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  scheduled_at?: string;
  scheduledAt?: string;
  /** Unsupported in the ems compat layer — pre-render to `html` instead. */
  react?: unknown;
}

function normalize(o: ResendEmailOptions, idempotencyKey?: string): SendEmailParams {
  if (o.react !== undefined) {
    throw new Error(
      "ems/compat: the `react` prop isn't supported — render it first " +
        "(e.g. `import { render } from '@react-email/render'`) and pass `html`.",
    );
  }
  return {
    from: o.from,
    to: o.to,
    subject: o.subject,
    html: o.html,
    text: o.text,
    cc: o.cc,
    bcc: o.bcc,
    replyTo: o.reply_to ?? o.replyTo,
    headers: o.headers,
    tags: o.tags,
    scheduledAt: o.scheduled_at ?? o.scheduledAt,
    idempotencyKey,
  };
}

function toError(e: unknown): { message: string; name: string } {
  if (e instanceof EMSError) return { message: e.message, name: e.code };
  return { message: e instanceof Error ? e.message : String(e), name: "application_error" };
}

async function envelope<T>(fn: () => Promise<T>): Promise<ResendResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return { data: null, error: toError(e) };
  }
}

/**
 * Resend-compatible client backed by ems. Construct exactly like resend-node:
 * `new Resend(apiKey)`. Falls back to `EMS_API_KEY` / `RESEND_API_KEY` env.
 */
export class Resend {
  /** The underlying ems client, if you want to drop down to native methods. */
  readonly ems: EMS;

  constructor(apiKey?: string, options: ResendOptions = {}) {
    // Read env without depending on @types/node — the SDK stays zero-dependency
    // and runs in browsers/edge too, where `process` may be absent.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
    const key = apiKey ?? env?.EMS_API_KEY ?? env?.RESEND_API_KEY;
    if (!key) {
      throw new Error("ems/compat: an API key is required (or set EMS_API_KEY).");
    }
    this.ems = new EMS({ apiKey: key, ...options });
  }

  emails = {
    /** resend.emails.send(...) → { data: { id }, error } */
    send: (opts: ResendEmailOptions, extra?: { idempotencyKey?: string }) =>
      envelope(() => this.ems.emails.send(normalize(opts, extra?.idempotencyKey))),
    /** Alias resend-node also exposes. */
    create: (opts: ResendEmailOptions, extra?: { idempotencyKey?: string }) =>
      this.emails.send(opts, extra),
    /** resend.emails.get(id) → { data, error } */
    get: (id: string) => envelope(() => this.ems.emails.get(id)),
    /** resend.emails.cancel(id) → { data: { id, status }, error } */
    cancel: (id: string) => envelope(() => this.ems.emails.cancel(id)),
  };

  batch = {
    /** resend.batch.send([...]) → { data: { data: [{ id } | { error }] }, error } */
    send: (list: ResendEmailOptions[]) =>
      envelope(async () => this.ems.emails.batch(list.map((o) => normalize(o)))),
    create: (list: ResendEmailOptions[]) => this.batch.send(list),
  };

  // Marketing surfaces aren't in ems yet — fail loud with a migration hint
  // instead of pretending. `ems-migrate` exports these from Resend.
  private notYet(feature: string): never {
    throw new Error(
      `ems/compat: ${feature} isn't available yet (ems is transactional-first). ` +
        `Run \`npx ems-migrate resend\` to export your ${feature} from Resend.`,
    );
  }
  audiences = { list: () => this.notYet("audiences"), get: () => this.notYet("audiences") };
  contacts = { list: () => this.notYet("contacts"), create: () => this.notYet("contacts") };
  broadcasts = { list: () => this.notYet("broadcasts"), get: () => this.notYet("broadcasts") };
}

export default Resend;
