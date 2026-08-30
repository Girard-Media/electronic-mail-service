// Team RBAC + invite-token unit test — the privilege-escalation and last-owner
// invariants the server relies on, plus invite-token roundtrip / tamper / expiry.
import {
  can,
  canManageRole,
  assignableRoles,
  grantedPermissions,
  isOrgRole,
  ROLE_RANK,
} from "../packages/core/src/rbac.js";
import { signInvite, verifyInvite, INVITE_TTL_MS } from "../packages/core/src/invites.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

// --- permission matrix ---
ok("owner can manage billing", can("owner", "billing:write"));
ok("admin CANNOT manage billing", !can("admin", "billing:write"));
ok("admin can invite", can("admin", "team:invite"));
ok("developer CANNOT invite", !can("developer", "team:invite"));
ok("developer can send", can("developer", "email:send"));
ok("viewer CANNOT send", !can("viewer", "email:send"));
ok("viewer can read team", can("viewer", "team:read"));
ok("admin can manage sub-accounts", can("admin", "subaccount:manage"));
ok("developer CANNOT manage sub-accounts", !can("developer", "subaccount:manage"));
ok("null/unknown role has no perms", !can(null, "team:read") && !can("wizard" as never, "email:send"));
ok("viewer granted list is read-only", grantedPermissions("viewer").includes("team:read") && !grantedPermissions("viewer").includes("email:send"));
ok("developer granted includes send but not invite", grantedPermissions("developer").includes("email:send") && !grantedPermissions("developer").includes("team:invite"));
ok("owner granted includes billing", grantedPermissions("owner").includes("billing:write"));

// --- role management (no privilege escalation) ---
ok("owner manages owner", canManageRole("owner", "owner"));
ok("admin CANNOT manage owner", !canManageRole("admin", "owner"));
ok("admin manages admin (peer)", canManageRole("admin", "admin"));
ok("admin manages developer", canManageRole("admin", "developer"));
ok("developer CANNOT manage admin", !canManageRole("developer", "admin"));
ok("only owner can assign owner", assignableRoles("owner").includes("owner") && !assignableRoles("admin").includes("owner"));
ok("admin assignable excludes owner", JSON.stringify(assignableRoles("admin")) === JSON.stringify(["admin", "developer", "viewer"]));
ok("viewer can assign nothing above viewer", JSON.stringify(assignableRoles("viewer")) === JSON.stringify(["viewer"]));
ok("isOrgRole guards bad input", isOrgRole("admin") && !isOrgRole("root") && !isOrgRole(42));
ok("rank is strictly ordered", ROLE_RANK.owner > ROLE_RANK.admin && ROLE_RANK.admin > ROLE_RANK.developer && ROLE_RANK.developer > ROLE_RANK.viewer);

// --- invite tokens ---
const tok = signInvite("inv_123", "Bob@Example.com");
const v = verifyInvite(tok);
ok("invite roundtrip", v?.inviteId === "inv_123" && v.email === "bob@example.com", JSON.stringify(v));
ok("email is lowercased in payload", v?.email === "bob@example.com");

// tamper: flip a payload char → signature must fail
const dot = tok.lastIndexOf(".");
const body = Buffer.from(tok.slice(0, dot), "base64url").toString("utf8").replace("inv_123", "inv_999");
const forged = `${Buffer.from(body).toString("base64url")}.${tok.slice(dot + 1)}`;
ok("tampered invite id rejected", verifyInvite(forged) === null);

// tamper: swap the signature
ok("bad signature rejected", verifyInvite(`${tok.slice(0, dot)}.deadbeefdeadbeefdeadbeefdeadbeef`) === null);

// garbage / shape
ok("garbage token rejected", verifyInvite("not-a-token") === null && verifyInvite("") === null && verifyInvite(".") === null);

// expiry: a token minted in the past is rejected once its TTL has elapsed
const old = signInvite("inv_old", "a@b.com", 1_000);
ok("expired invite rejected", verifyInvite(old, 1_000 + INVITE_TTL_MS + 1) === null);
ok("invite valid before expiry", verifyInvite(old, 1_000 + INVITE_TTL_MS - 1)?.inviteId === "inv_old");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
