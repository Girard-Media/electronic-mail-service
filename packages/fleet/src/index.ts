/**
 * @ems/fleet — node, IP, sending-domain and mailbox registry.
 *
 * State machines only allow the transitions listed here. A node cannot become
 * routable until it has proven it is not an open relay, that it signs DKIM, and
 * that port 25 egress works (E03-061).
 */

export type NodeStatus =
  | "PROVISIONING" | "VERIFYING" | "ACTIVE" | "DRAINING" | "QUARANTINED" | "RETIRED";
export type IpStatus = "NEW" | "WARMING" | "ACTIVE" | "THROTTLED" | "QUARANTINED" | "RETIRED";
export type DomainStatus =
  | "REGISTERED" | "DNS_PENDING" | "AGING" | "WARMING" | "ACTIVE"
  | "PAUSED" | "RETIRING" | "RETIRED" | "BURNED";
export type MailboxStatus =
  | "CREATED" | "WARMING" | "ACTIVE" | "PAUSED" | "DRAINING" | "RETIRED" | "BURNED";

export const NODE_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  PROVISIONING: ["VERIFYING", "RETIRED"],
  VERIFYING: ["ACTIVE", "PROVISIONING", "RETIRED"],
  ACTIVE: ["DRAINING", "QUARANTINED"],
  DRAINING: ["RETIRED", "ACTIVE"],
  QUARANTINED: ["DRAINING", "ACTIVE"],
  RETIRED: [],
};

export const DOMAIN_TRANSITIONS: Record<DomainStatus, DomainStatus[]> = {
  REGISTERED: ["DNS_PENDING", "RETIRED"],
  DNS_PENDING: ["AGING", "REGISTERED"],
  AGING: ["WARMING", "PAUSED"],
  WARMING: ["ACTIVE", "PAUSED", "BURNED"],
  ACTIVE: ["PAUSED", "RETIRING", "BURNED"],
  PAUSED: ["ACTIVE", "RETIRING", "BURNED"],
  RETIRING: ["RETIRED"],
  RETIRED: [],
  BURNED: [], // terminal; never reuse
};

export const MAILBOX_TRANSITIONS: Record<MailboxStatus, MailboxStatus[]> = {
  CREATED: ["WARMING", "RETIRED"],
  WARMING: ["ACTIVE", "PAUSED", "BURNED"],
  ACTIVE: ["PAUSED", "DRAINING", "BURNED"],
  PAUSED: ["ACTIVE", "DRAINING", "BURNED"],
  DRAINING: ["RETIRED", "ACTIVE"],
  RETIRED: [],
  BURNED: [],
};

export function canTransition<S extends string>(
  table: Record<S, S[]>, from: S, to: S,
): boolean {
  return (table[from] ?? []).includes(to);
}

/** The three gates from infra/blast-node/90-verify.sh. All must pass. */
export interface NodeVerification {
  relayTestOk: boolean;
  dkimTestOk: boolean;
  egress25Ok: boolean;
}

export function isRoutable(status: NodeStatus, v: NodeVerification, role: string): boolean {
  return status === "ACTIVE" && role === "CAMPAIGN" && v.relayTestOk && v.dkimTestOk && v.egress25Ok;
}

/**
 * Capacity comes from live mailbox caps, never a static number (E03-065).
 * The safety factor is why we never plan to the theoretical ceiling.
 */
export const CAPACITY_SAFETY_FACTOR = 0.85;

export function dailyCapacity(mailboxCaps: number[]): number {
  return Math.floor(mailboxCaps.reduce((a, b) => a + b, 0) * CAPACITY_SAFETY_FACTOR);
}

/** How many mailboxes and domains a target volume needs (planning/INFRA.md §7). */
export function fleetForTarget(perDay: number, capPerMailbox = 40, mailboxesPerDomain = 2.5) {
  const mailboxes = Math.ceil(perDay / (capPerMailbox * CAPACITY_SAFETY_FACTOR));
  return { mailboxes, domains: Math.ceil(mailboxes / mailboxesPerDomain) };
}

export * from "./identity.js";
export * from "./lifecycle.js";
