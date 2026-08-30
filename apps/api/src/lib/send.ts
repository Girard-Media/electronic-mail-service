import {
  sendEmailSchema,
  toArray,
  errors,
  env,
  isSharedInboxDomain,
  parseSharedInboxDomains,
  sendQueue,
  parseFromDomain,
  SYSTEM_SENDING_DOMAINS,
  isUnlimited,
  renderEmail,
  parseTemplateContent,
  interpolate,
  parseScheduledAt,
  cancelDecision,
  notCancelableMessage,
  CANCELABLE_STATUSES,
  systemDomainSendDecision,
  sharedInboxSendDecision,
  recipientAddress,
  type EmailStatusName,
} from "@ems/core";
import { prisma, Prisma } from "@ems/db";
import { effectiveOrgPlan } from "./operator-plan.js";
import { orgOwnerEmailVerified } from "./owner-verified.js";

type ParsedEmail = ReturnType<typeof sendEmailSchema.parse>;

// Shared enqueue path used by the public API (key-auth) and the dashboard
// (session-auth): persist the Email, enforce suppression + idempotency, queue it.
export async function enqueueEmail(
  projectId: string,
  p: ParsedEmail,
  idempotencyKey: string | null,
  opts?: { internal?: boolean },
): Promise<{ id: string }> {
  const to = toArray(p.to);
  const cc = toArray(p.cc);
  const bcc = toArray(p.bcc);
  const replyTo = toArray(p.reply_to);

  if (idempotencyKey) {
    const existing = await prisma.email.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
      select: { id: true },
    });
    if (existing) return { id: existing.id };
  }

  // Suppressions are stored as the bare lowercased address. Compare the same
  // shape so "Bob <User@X.com>" cannot bypass a "user@x.com" row.
  const recipients = [...to, ...cc, ...bcc].map(recipientAddress);
  if (recipients.length) {
    const hit = await prisma.suppression.findFirst({
      where: { projectId, address: { in: recipients } },
      select: { address: true },
    });
    if (hit) throw errors.suppressed(hit.address);
  }

  // Plan quota: this month's send count vs the org's plan. The plan limit is
  // PER-ORG, so we check the org-wide total (summed across all its projects) —
  // metering per-project but limiting per-org would let extra projects multiply
  // the cap. Resolve the org once; reused below to meter the accepted send.
  // NOTE: check-then-increment is intentionally non-transactional — a small
  // burst overshoot is acceptable for a soft send quota (it's a cap, not a
  // charge); strict atomicity across the org-wide sum isn't worth the cost.
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const proj = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  const monthlyLimit = proj ? (await effectiveOrgPlan(proj.orgId)).limits.monthlySends : 0;
  if (proj && !isUnlimited(monthlyLimit)) {
    const agg = await prisma.usageRecord.aggregate({
      _sum: { sends: true },
      where: { orgId: proj.orgId, period },
    });
    if ((agg._sum.sends ?? 0) >= monthlyLimit) {
      throw errors.planLimit(
        `You've reached your plan's monthly send limit (${monthlyLimit.toLocaleString()}). Upgrade to send more.`,
      );
    }
  }

  // Sender authorization: the From domain must be a verified sending domain of
  // this project (or a ems system domain). Prevents tenants spoofing
  // arbitrary From addresses — enforces our verified-domain requirement.
  const fromDomain = parseFromDomain(p.from);
  if (!fromDomain) {
    throw errors.validation("The 'from' field must contain a valid email address.");
  }
  const fromAddress = recipientAddress(p.from);

  let domainId: string | null = null;
  let connectedAccountId: string | null = null;
  let routedVia: "mta" | "google" | "microsoft" = "mta";

  // 1) Connected mailbox? An OAuth'd Gmail/Outlook account IS the sending
  //    identity, so it bypasses domain DNS verification.
  const account = await prisma.connectedAccount.findFirst({
    where: { projectId, email: fromAddress, status: "active" },
    select: { id: true, provider: true },
  });
  if (account) {
    connectedAccountId = account.id;
    routedVia = account.provider;
  } else if (isSharedInboxDomain(fromDomain, parseSharedInboxDomains(env.SHARED_INBOX_DOMAINS))) {
    // Shared inbox domain: authorization is OWNING THE MAILBOX, not the domain
    // — every project shares these domains, so a blanket allow (like the
    // system-domain branch) would let project A spoof project B's address. The
    // exact From address must be an active mailbox of THIS project.
    // Deliberately not in SYSTEM_SENDING_DOMAINS for that reason.
    // Pooled reputation: unverified owners and a kill switch can still refuse.
    const sharedDecision = sharedInboxSendDecision({
      internal: Boolean(opts?.internal),
      ownerVerified: proj ? await orgOwnerEmailVerified(proj.orgId) : false,
      sendingEnabled: env.SHARED_INBOX_SENDING !== "off",
    });
    if (sharedDecision === "killed") throw errors.sharedInboxSendingDisabled();
    if (sharedDecision === "need_verification") throw errors.emailUnverified();
    const mailbox = await prisma.mailbox.findFirst({
      where: { projectId, address: fromAddress, status: "active" },
      select: { id: true },
    });
    if (!mailbox) {
      throw errors.validation(
        `To send as ${fromAddress}, create that inbox first (POST /inboxes) — it isn't an active inbox of this project.`,
      );
    }
  } else if (!SYSTEM_SENDING_DOMAINS.has(fromDomain)) {
    // 2) Otherwise the From domain must be a verified sending domain.
    const domain = await prisma.domain.findFirst({
      where: { projectId, name: fromDomain, status: "verified" },
      select: { id: true },
    });
    if (!domain) throw errors.unverifiedDomain(fromDomain);
    domainId = domain.id;
  } else {
    // 3) System domain (electronicmailservices.com): platform mail (verify / reset / invite)
    //    passes { internal: true }. Customers must own the exact mailbox — a
    //    verified owner is not enough (that would DKIM-align security@).
    const ownerVerified = proj ? await orgOwnerEmailVerified(proj.orgId) : false;
    const sys = systemDomainSendDecision({
      fromDomain,
      internal: Boolean(opts?.internal),
      ownerVerified,
    });
    if (sys === "need_verification") throw errors.emailUnverified();
    if (sys === "need_mailbox") {
      const mailbox = await prisma.mailbox.findFirst({
        where: { projectId, address: fromAddress, status: "active" },
        select: { id: true },
      });
      if (!mailbox) {
        throw errors.validation(
          `Sending from ${fromDomain} requires an inbox you own at ${fromAddress}. Create one on a shared inbox domain, or send from a verified domain of this project.`,
        );
      }
    }
  }

  // Validate scheduled_at up front — an invalid string would otherwise become an
  // Invalid Date and a NaN queue delay (the job would fire immediately/never).
  let scheduledAt: Date | null = null;
  if (p.scheduled_at) {
    const r = parseScheduledAt(p.scheduled_at);
    if (!r.ok) throw errors.validation(r.message);
    scheduledAt = r.date;
  }

  // Block template? Render it to HTML server-side and resolve the subject. The
  // org's branding is exposed as {{organization.*}}, the caller's `data` as
  // {{data.*}}; interpolated values are HTML-escaped by the renderer.
  let html = p.html ?? null;
  let subject = p.subject ?? "";
  if (p.template_id) {
    const tpl = await prisma.emailTemplate.findFirst({
      where: { id: p.template_id, projectId },
      select: { subject: true, content: true },
    });
    if (!tpl) throw errors.validation("Template not found for this project.");
    const org = await prisma.organization.findUnique({
      where: { id: proj?.orgId ?? "" },
      select: { name: true, logoUrl: true, primaryColor: true },
    });
    const ctx = {
      organization: {
        name: org?.name ?? "",
        logo: org?.logoUrl ?? "",
        primaryColor: org?.primaryColor ?? "",
      },
      data: p.data ?? {},
    };
    html = renderEmail(parseTemplateContent(tpl.content), ctx);
    subject = p.subject ?? interpolate(tpl.subject ?? "", ctx);
    await prisma.emailTemplate
      .update({
        where: { id: p.template_id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => {});
  }

  // Header-injection guard: a subject is an email header. Strip CR/LF/TAB (which
  // could come from interpolated `data`) so it can't inject Bcc/extra headers on
  // the hand-built-MIME (Gmail/Graph) send path.
  subject = subject.replace(/[\r\n\t]+/g, " ").trim();

  let email: { id: string };
  try {
    email = await prisma.email.create({
      data: {
        projectId,
        domainId,
        connectedAccountId,
        routedVia,
        from: p.from,
        to,
        cc,
        bcc,
        replyTo,
        subject,
        html,
        text: p.text ?? null,
        headers: p.headers ?? undefined,
        tags: p.tags ?? undefined,
        // Persist only base64 content — never a `path` the worker could fetch.
        attachments: p.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.content_type,
        })),
        status: scheduledAt ? "scheduled" : "queued",
        idempotencyKey,
        scheduledAt,
      },
      select: { id: true },
    });
  } catch (e) {
    if (
      idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const winner = await prisma.email.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
        select: { id: true },
      });
      if (winner) return { id: winner.id };
    }
    throw e;
  }

  await prisma.emailEvent.create({ data: { emailId: email.id, type: "queued" } });
  // Meter the accepted send (exactly once per email — worker retries don't re-run
  // this path, and idempotency replays returned earlier).
  if (proj) {
    await prisma.usageRecord.upsert({
      where: { orgId_projectId_period: { orgId: proj.orgId, projectId, period } },
      create: { orgId: proj.orgId, projectId, period, sends: 1 },
      update: { sends: { increment: 1 } },
    });
  }
  await sendQueue.add(
    "send",
    { emailId: email.id },
    {
      jobId: email.id,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      delay: scheduledAt
        ? Math.max(0, scheduledAt.getTime() - Date.now())
        : undefined,
    },
  );
  return { id: email.id };
}

/**
 * Cancel a not-yet-sent message. Shared by the public API (key-auth) and the
 * dashboard (session-auth). Cancelability rules live in `lifecycle.ts`.
 *
 * Ordering matters: we flip the status FIRST with a conditional update, so the
 * database is the single source of truth for the outcome. Removing the BullMQ
 * job is best-effort cleanup — if the worker already picked the job up, it
 * re-reads the row and bails on `status === "canceled"`, so a lost race costs a
 * no-op job, never a message that goes out after we told the caller it wouldn't.
 */
export async function cancelEmail(
  projectId: string,
  emailId: string,
): Promise<{ id: string; status: "canceled" }> {
  const email = await prisma.email.findFirst({
    where: { id: emailId, projectId },
    select: { status: true },
  });
  if (!email) throw errors.notFound(`Email ${emailId} not found.`);

  const decision = cancelDecision(email.status as EmailStatusName);
  if (decision.action === "already_canceled") return { id: emailId, status: "canceled" };
  if (decision.action === "too_late") {
    throw errors.conflict("not_cancelable", notCancelableMessage(emailId, decision.status));
  }

  // Conditional update — the authoritative guard. Re-checking the status inside
  // the WHERE closes the gap between the read above and this write: if the
  // worker flipped the row to `sent` in between, count is 0 and we report the
  // real state instead of lying to the caller.
  const { count } = await prisma.email.updateMany({
    where: { id: emailId, projectId, status: { in: [...CANCELABLE_STATUSES] } },
    data: { status: "canceled" },
  });

  if (count === 0) {
    const current = await prisma.email.findFirst({
      where: { id: emailId, projectId },
      select: { status: true },
    });
    const now = (current?.status ?? "sent") as EmailStatusName;
    if (now === "canceled") return { id: emailId, status: "canceled" };
    throw errors.conflict("not_cancelable", notCancelableMessage(emailId, now));
  }

  // Best-effort: drop the delayed job so it never runs at all.
  try {
    const job = await sendQueue.getJob(emailId);
    if (job) await job.remove();
  } catch {
    // The status guard above already makes this safe; a stuck job is a no-op.
  }

  return { id: emailId, status: "canceled" };
}
