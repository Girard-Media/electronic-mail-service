/**
 * Domain/mailbox promotion gates on top of the transition table (E05-003, E05-004, E05-024).
 */

import type { DomainStatus, MailboxStatus } from "./index.js";

export interface DomainAuthFlags {
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  mxOk: boolean;
}

export function domainAuthComplete(f: DomainAuthFlags): boolean {
  return f.spfOk && f.dkimOk && f.dmarcOk && f.mxOk;
}

/**
 * One DNS check may advance REGISTERED → DNS_PENDING, then DNS_PENDING → AGING
 * once every auth flag is true. Never jumps REGISTERED → WARMING (E05-003).
 */
export function nextStatusAfterDns(current: DomainStatus, flags: DomainAuthFlags): DomainStatus {
  if (!domainAuthComplete(flags)) {
    return current === "REGISTERED" ? "DNS_PENDING" : current;
  }
  if (current === "REGISTERED") return "DNS_PENDING";
  if (current === "DNS_PENDING") return "AGING";
  return current;
}

export function warmDomainError(
  current: DomainStatus,
  flags: DomainAuthFlags,
  ageReadyAt: Date | null,
  now: Date,
): string | null {
  if (current !== "AGING") {
    return `A ${current} domain cannot enter warmup.`;
  }
  if (!domainAuthComplete(flags)) {
    return "SPF, DKIM, DMARC, and MX must all verify before warmup.";
  }
  if (ageReadyAt && ageReadyAt.getTime() > now.getTime()) {
    return `Domain is still aging until ${ageReadyAt.toISOString()}.`;
  }
  return null;
}

export function activateDomainError(current: DomainStatus, flags: DomainAuthFlags): string | null {
  if (current !== "WARMING") {
    return `A ${current} domain cannot be activated.`;
  }
  if (!domainAuthComplete(flags)) {
    return "Auth flags dropped — re-verify DNS before activating.";
  }
  return null;
}

export function warmMailboxError(mailbox: MailboxStatus, domain: DomainStatus): string | null {
  if (mailbox !== "CREATED") {
    return `A ${mailbox} mailbox cannot enter warmup.`;
  }
  if (domain !== "AGING" && domain !== "WARMING" && domain !== "ACTIVE") {
    return "The domain must be aging, warming, or active before a mailbox can warm.";
  }
  return null;
}

export function activateMailboxError(mailbox: MailboxStatus, domain: DomainStatus): string | null {
  if (mailbox !== "WARMING") {
    return `A ${mailbox} mailbox cannot be activated.`;
  }
  if (domain !== "ACTIVE") {
    return "Activate the domain before activating its mailboxes.";
  }
  return null;
}
