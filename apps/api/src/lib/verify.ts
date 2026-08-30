import {
  normalizeEmail,
  emailDomain,
  isValidSyntax,
  isDisposableDomain,
  isRoleAddress,
  domainAcceptsMail,
  domainOnDBL,
  classifyEmail,
  type VerifyStatus,
} from "@ems/core";
import { prisma } from "@ems/db";

export interface VerifyResultItem {
  email: string;
  status: VerifyStatus;
  reasons: string[];
}
export interface VerifySummary {
  total: number;
  deliverable: number;
  risky: number;
  undeliverable: number;
  unknown: number;
}

// Verify a list of addresses for a project: per-domain MX + Spamhaus-DBL checks
// (cached, bounded concurrency) + cross-check against the project suppression
// list. Shared by the dashboard (/app/verify) and the public API (/verify).
export async function verifyEmailList(
  projectId: string,
  rawEmails: string[],
): Promise<{ results: VerifyResultItem[]; summary: VerifySummary }> {
  const emails = [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))];
  const domains = [...new Set(emails.map(emailDomain).filter((d): d is string => !!d))];

  const mx: Record<string, boolean | null> = {};
  const dbl: Record<string, boolean | null> = {};
  for (let i = 0; i < domains.length; i += 40) {
    const chunk = domains.slice(i, i + 40);
    await Promise.all(
      chunk.map(async (d) => {
        const [m, b] = await Promise.all([domainAcceptsMail(d), domainOnDBL(d)]);
        mx[d] = m;
        dbl[d] = b;
      }),
    );
  }

  const suppRows = await prisma.suppression.findMany({
    where: { projectId, address: { in: emails } },
    select: { address: true },
  });
  const suppressed = new Set(suppRows.map((s) => s.address));

  const results: VerifyResultItem[] = emails.map((email) => {
    const domain = emailDomain(email);
    const { status, reasons } = classifyEmail({
      syntax: isValidSyntax(email),
      mx: domain ? mx[domain] ?? null : false,
      disposable: domain ? isDisposableDomain(domain) : false,
      role: isRoleAddress(email),
      dbl: domain ? dbl[domain] ?? null : null,
      suppressed: suppressed.has(email),
    });
    return { email, status, reasons };
  });

  const summary: VerifySummary = {
    total: results.length,
    deliverable: 0,
    risky: 0,
    undeliverable: 0,
    unknown: 0,
  };
  for (const r of results) summary[r.status]++;
  return { results, summary };
}
