/**
 * Campaign launch gate (E15-031e).
 *
 * A campaign may not start if the attached (or named) pool cannot cover its
 * dailyCap today. Launching anyway is how a 1,000/day ListKit-style target
 * burns four cold mailboxes by noon.
 */

import { poolCapacityToday } from "./pool.js";

export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export type LaunchCapacity = { eligible: number; remainingToday: number };

export type LaunchDecision =
  | { ok: true; capacity: LaunchCapacity }
  | {
      ok: false;
      code: "no-active-mailboxes" | "capacity-short";
      capacity: LaunchCapacity;
      dailyCap: number;
      message: string;
    };

export const LAUNCHABLE_STATUSES = ["DRAFT", "SCHEDULED", "PAUSED"] as const;

export function isLaunchableStatus(status: string): boolean {
  return (LAUNCHABLE_STATUSES as readonly string[]).includes(status);
}

export function decideLaunch(
  dailyCap: number,
  mailboxes: Array<{ status: string; dailyCap: number; sentToday: number }>,
): LaunchDecision {
  const capacity = poolCapacityToday(mailboxes);
  if (capacity.eligible === 0) {
    return {
      ok: false,
      code: "no-active-mailboxes",
      capacity,
      dailyCap,
      message: "Attach at least one ACTIVE mailbox before launch.",
    };
  }
  if (capacity.remainingToday < dailyCap) {
    return {
      ok: false,
      code: "capacity-short",
      capacity,
      dailyCap,
      message: `Pool can send ${capacity.remainingToday} today; campaign dailyCap is ${dailyCap}. Attach more mailboxes or lower the cap.`,
    };
  }
  return { ok: true, capacity };
}
