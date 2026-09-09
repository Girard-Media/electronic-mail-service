/**
 * Enrolment + reply-halt (E15-002, E15-003, E15-018, E15-019). Pure.
 */
import {
  enrolDecision,
  canTransitionEnrollment,
  haltTargetForIntent,
  haltEnrollment,
  shouldCancelIntent,
  isDeceptiveFirstTouch,
} from "../packages/sequence/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

console.log("\n--- enrolDecision ---");
const base = { existingState: null as null, frozen: false, suppressed: false, hasFirstStep: true, hasVariant: true };
ok("a clean lead may enrol", enrolDecision(base).ok);
ok("missing first step is refused", !enrolDecision({ ...base, hasFirstStep: false }).ok);
ok("frozen lead is blocked, not skipped", (enrolDecision({ ...base, frozen: true }) as { code: string }).code === "lead-frozen");
ok("suppressed lead is blocked", (enrolDecision({ ...base, suppressed: true }) as { code: string }).code === "lead-suppressed");
ok("already ACTIVE cannot enrol again", (enrolDecision({ ...base, existingState: "ACTIVE" }) as { code: string }).code === "already-enrolled");
ok("a REPLIED enrolment is terminal", (enrolDecision({ ...base, existingState: "REPLIED" }) as { code: string }).code === "terminal");
ok("RE: on first touch is refused",
  (enrolDecision({ ...base, isFirstTouch: true, firstTouchSubject: "RE: your note" }) as { code: string }).code === "deceptive-first-touch");
ok("RE: on a follow-up is fine", enrolDecision({ ...base, isFirstTouch: false, firstTouchSubject: "RE: your note" }).ok);
ok("isDeceptiveFirstTouch matches the helper", isDeceptiveFirstTouch("FW: hi", true) && !isDeceptiveFirstTouch("FW: hi", false));

console.log("\n--- transitions ---");
ok("PENDING can become ACTIVE", canTransitionEnrollment("PENDING", "ACTIVE"));
ok("PENDING can halt on a reply", canTransitionEnrollment("PENDING", "REPLIED"));
ok("ACTIVE can halt on unsubscribe", canTransitionEnrollment("ACTIVE", "UNSUBSCRIBED"));
ok("REPLIED cannot move", !canTransitionEnrollment("REPLIED", "ACTIVE"));

console.log("\n--- halt ---");
ok("INTERESTED is a reply halt", haltTargetForIntent("INTERESTED") === "REPLIED");
ok("UNSUBSCRIBE is an unsub halt", haltTargetForIntent("UNSUBSCRIBE") === "UNSUBSCRIBED");
ok("OUT_OF_OFFICE does not halt", haltTargetForIntent("OUT_OF_OFFICE") === null);
ok("AUTO_REPLY does not halt", haltTargetForIntent("AUTO_REPLY") === null);
ok("ACTIVE enrolment becomes REPLIED", haltEnrollment("ACTIVE", "REPLIED") === "REPLIED");
ok("already REPLIED is a no-op", haltEnrollment("REPLIED", "REPLIED") === null);
ok("PENDING intents are cancelled", shouldCancelIntent("PENDING") && shouldCancelIntent("ROUTED"));
ok("SUBMITTED intents are left for the maillog", !shouldCancelIntent("SUBMITTED"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
