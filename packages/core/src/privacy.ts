/**
 * GDPR stubs: account-level export + delete eligibility. DB I/O stays in the
 * dashboard route; this module is the decision the tests lock.
 */

export type OwnedOrgRoster = {
  orgId: string;
  name: string;
  /** Members besides the deleting user. */
  otherMemberCount: number;
  /** Client sub-accounts hanging off this org. Default 0. */
  subaccountCount?: number;
};

export type AccountDeleteDecision =
  | { action: "allow"; deleteOrgIds: string[] }
  | { action: "blocked"; orgNames: string[] };

/**
 * You can delete your user. Orgs you solely own go with you. Orgs that still
 * have other members stay — transfer ownership first (don't take teammates down).
 */
export function accountDeleteDecision(owned: OwnedOrgRoster[]): AccountDeleteDecision {
  const blocking = owned.filter(
    (o) => o.otherMemberCount > 0 || (o.subaccountCount ?? 0) > 0,
  );
  if (blocking.length) {
    return { action: "blocked", orgNames: blocking.map((o) => o.name) };
  }
  return { action: "allow", deleteOrgIds: owned.map((o) => o.orgId) };
}

export function accountDeleteBlockedMessage(orgNames: string[]): string {
  const listed = orgNames.map((n) => `"${n}"`).join(", ");
  return `You still own ${listed} with other members or sub-accounts. Transfer ownership or remove them before deleting your account.`;
}
