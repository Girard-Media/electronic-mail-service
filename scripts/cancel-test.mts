// Email cancel state machine. A message may only be pulled back while it is
// still ours (queued/scheduled); once handed to a receiving server, cancelling
// must fail loudly rather than reporting a success we cannot deliver on.
import { readFileSync } from "node:fs";
import {
  cancelDecision,
  notCancelableMessage,
  CANCELABLE_STATUSES,
  EMAIL_STATUSES,
  type EmailStatusName,
} from "../packages/core/src/lifecycle.js";

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); if (!c) fail++; };

// --- cancelable states ---
ok("queued is cancelable", cancelDecision("queued").action === "cancel");
ok("scheduled is cancelable", cancelDecision("scheduled").action === "cancel");

// --- idempotency ---
ok("canceled is idempotent, not an error", cancelDecision("canceled").action === "already_canceled");

// --- terminal states must refuse ---
for (const s of ["sent", "delivered", "bounced", "complained", "failed"] as EmailStatusName[]) {
  ok(`${s} refuses cancel`, cancelDecision(s).action === "too_late");
}

// --- exhaustiveness: every schema status has defined semantics, and any status
// added later must be classified deliberately rather than defaulting to cancelable.
const classified = EMAIL_STATUSES.map((s) => cancelDecision(s).action);
ok("every status yields a decision", classified.every(Boolean));
ok(
  "exactly the cancelable set can cancel",
  EMAIL_STATUSES.filter((s) => cancelDecision(s).action === "cancel").join(",") ===
    [...CANCELABLE_STATUSES].join(","),
);
ok("nothing outside the cancelable set is cancelable",
  EMAIL_STATUSES.every((s) =>
    cancelDecision(s).action !== "cancel" || (CANCELABLE_STATUSES as readonly string[]).includes(s)));

// --- drift guard: our status list must match the Prisma enum exactly, or a
// schema change could introduce a status with undefined cancel semantics.
const schema = readFileSync(
  new URL("../packages/db/prisma/schema.prisma", import.meta.url),
  "utf8",
);
const enumBody = schema.match(/enum EmailStatus\s*\{([^}]*)\}/)?.[1] ?? "";
const fromSchema = enumBody.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
ok(
  `EmailStatus enum matches lifecycle.ts (${fromSchema.length} statuses)`,
  fromSchema.slice().sort().join(",") === [...EMAIL_STATUSES].sort().join(","),
);

// --- 409 message quality: names the id and the real state, no placeholder text ---
const msg = notCancelableMessage("em_42", "delivered");
ok("message names the id", msg.includes("em_42"));
ok("message explains the state", msg.includes("already been delivered"));
ok("unknown-ish status still renders a usable message",
  notCancelableMessage("em_7", "queued").includes("em_7"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`); process.exit(fail ? 1 : 0);
