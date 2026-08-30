// ems-migrate — pull a customer's account from another ESP into a
// ems migration kit (plan + exported templates + contacts). Read-only on
// the source; writes only to the chosen output directory.
import { writeMigrationKit, type WriteResult } from "./report.js";
import { ResendSource, type ResendSourceOptions } from "./sources/resend.js";
import { SendGridSource, type SendGridSourceOptions } from "./sources/sendgrid.js";
import { PostmarkSource, type PostmarkSourceOptions } from "./sources/postmark.js";
import { MailgunSource, type MailgunSourceOptions } from "./sources/mailgun.js";
import type { Inventory, MigrationSource } from "./types.js";

export * from "./types.js";
export { ResendSource } from "./sources/resend.js";
export type { ResendSourceOptions } from "./sources/resend.js";
export { SendGridSource } from "./sources/sendgrid.js";
export type { SendGridSourceOptions } from "./sources/sendgrid.js";
export { PostmarkSource } from "./sources/postmark.js";
export type { PostmarkSourceOptions } from "./sources/postmark.js";
export { MailgunSource } from "./sources/mailgun.js";
export type { MailgunSourceOptions } from "./sources/mailgun.js";
export { writeMigrationKit } from "./report.js";
export type { WriteResult } from "./report.js";

/** ESP ids the engine can read from today. */
export const SUPPORTED_SOURCES = ["resend", "sendgrid", "postmark", "mailgun"] as const;
export type SourceName = (typeof SUPPORTED_SOURCES)[number];

export interface MigrationResult {
  inventory: Inventory;
  write: WriteResult;
}

/** Pull a source ESP's inventory and write the migration kit to `outDir`. */
export async function runMigration(
  source: MigrationSource,
  outDir: string,
): Promise<MigrationResult> {
  const inventory = await source.inventory();
  const write = await writeMigrationKit(inventory, outDir);
  return { inventory, write };
}

/** Convenience constructors. */
export function resend(opts: ResendSourceOptions): ResendSource {
  return new ResendSource(opts);
}
export function sendgrid(opts: SendGridSourceOptions): SendGridSource {
  return new SendGridSource(opts);
}
export function postmark(opts: PostmarkSourceOptions): PostmarkSource {
  return new PostmarkSource(opts);
}
export function mailgun(opts: MailgunSourceOptions): MailgunSource {
  return new MailgunSource(opts);
}
