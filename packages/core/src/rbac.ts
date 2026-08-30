// Tenant RBAC — the single source of truth for what each org role may do.
// Roles live on Membership (Prisma `Role` enum); this module is DB-agnostic so it
// can be shared by the API, workers, and the dashboard without a db dependency.
//
// Model: four ranked roles. A permission has a minimum rank; a role satisfies it
// when its rank is >= that minimum. Role *management* (invite/change/remove) is
// gated by rank too — you can never act on a role above your own, and only an
// owner can grant or revoke ownership. This keeps privilege-escalation impossible
// by construction rather than by scattered if-checks.

export type OrgRole = "owner" | "admin" | "developer" | "viewer";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "developer", "viewer"];

/** Higher = more authority. Used for permission checks and "can't touch a peer above you". */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  developer: 1,
  viewer: 0,
};

export interface RoleMeta {
  label: string;
  description: string;
}

export const ROLE_META: Record<OrgRole, RoleMeta> = {
  owner: {
    label: "Owner",
    description: "Full control, including billing and ownership of the account.",
  },
  admin: {
    label: "Admin",
    description: "Manage domains, team, branding, and sending — everything except billing and ownership.",
  },
  developer: {
    label: "Developer",
    description: "Send email and manage API keys, domains, templates, and mailboxes.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to logs, domains, and usage.",
  },
};

export type Permission =
  | "team:read"
  | "team:invite"
  | "team:role"
  | "team:remove"
  | "branding:write"
  | "billing:write"
  | "org:delete"
  | "subaccount:manage"
  | "domain:write"
  | "key:write"
  | "webhook:write"
  | "email:send"
  | "suppression:write"
  | "template:write"
  | "mailbox:write";

// Minimum rank required for each permission. Tuned so: viewer can only read,
// developer can operate sending resources, admin manages the org/team/branding,
// and billing + ownership stay owner-only.
const PERMISSION_MIN_RANK: Record<Permission, number> = {
  "team:read": ROLE_RANK.viewer, // any member sees the roster
  "email:send": ROLE_RANK.developer,
  "key:write": ROLE_RANK.developer,
  "domain:write": ROLE_RANK.developer,
  "template:write": ROLE_RANK.developer,
  "mailbox:write": ROLE_RANK.developer,
  "suppression:write": ROLE_RANK.developer,
  "webhook:write": ROLE_RANK.developer,
  "team:invite": ROLE_RANK.admin,
  "team:role": ROLE_RANK.admin,
  "team:remove": ROLE_RANK.admin,
  "branding:write": ROLE_RANK.admin,
  "subaccount:manage": ROLE_RANK.admin,
  "billing:write": ROLE_RANK.owner,
  "org:delete": ROLE_RANK.owner,
};

export const PERMISSIONS = Object.keys(PERMISSION_MIN_RANK) as Permission[];

export function isOrgRole(x: unknown): x is OrgRole {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(ROLE_RANK, x);
}

/** Does this role hold the given permission? Unknown roles are treated as no-access. */
export function can(role: OrgRole | null | undefined, perm: Permission): boolean {
  if (!role || !isOrgRole(role)) return false;
  return ROLE_RANK[role] >= PERMISSION_MIN_RANK[perm];
}

/** Permissions this role is allowed to exercise — what `/auth/me` ships to the dashboard. */
export function grantedPermissions(role: OrgRole | null | undefined): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

/**
 * May `actor` create/modify/remove a membership or invite that carries `target`?
 * Only when the actor outranks-or-equals the target — so an admin can manage other
 * admins/developers/viewers but never an owner, and only an owner can manage owners.
 */
export function canManageRole(actor: OrgRole | null | undefined, target: OrgRole): boolean {
  if (!actor || !isOrgRole(actor)) return false;
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}

/** Roles `actor` is allowed to assign (drives the UI dropdown and server validation). */
export function assignableRoles(actor: OrgRole | null | undefined): OrgRole[] {
  if (!actor || !isOrgRole(actor)) return [];
  return ORG_ROLES.filter((r) => ROLE_RANK[actor] >= ROLE_RANK[r]);
}
