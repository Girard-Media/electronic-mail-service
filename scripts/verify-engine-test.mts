/**
 * Verification engine test (E12-065..E12-069).
 *
 * Ports are injected, so the five stages are exercised without touching a
 * network. The stage-4 isolation rule — probe only from the dedicated
 * verification IP — is asserted structurally: the engine cannot probe at all
 * unless a probe port is supplied.
 */
import {
  verify, checkSyntax, normalizeEmail, isRoleAddress, isDisposableByDomain,
  isDisposableByMx, trapScore, isSendable, isBlocking, TTL_DAYS,
  ALWAYS_ACCEPTS_MX, TRAP_BLOCK_THRESHOLD,
  type VerifyPorts,
} from "../packages/verify/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "yopmail.com"]);
const NOW = new Date("2026-08-30T00:00:00Z");

function ports(over: Partial<VerifyPorts> = {}): VerifyPorts {
  return {
    resolveMx: async (d) => (d === "nomx.test" ? [] : ["mx1." + d]),
    resolveA: async (d) => (d === "dead.test" ? [] : ["1.2.3.4"]),
    smtpProbe: async (_h, addr) => ({
      accepted: !addr.startsWith("ems-probe-") && !addr.startsWith("gone@"),
      response: addr.startsWith("gone@") ? "550 5.1.1 User unknown" : "250 2.1.5 Ok",
    }),
    ...over,
  };
}
const opts = (over = {}) => ({ disposableDomains: DISPOSABLE, now: NOW, ...over });

console.log("\n--- syntax ---");
ok("a normal address passes", checkSyntax("dana@acme.com").ok);
ok("dots in the local part are fine", checkSyntax("dana.k.lee@acme.com").ok);
ok("plus tags are fine", checkSyntax("dana+ems@acme.com").ok);
ok("no @ fails", !checkSyntax("danaacme.com").ok);
ok("two @ takes the LAST as the separator", checkSyntax("a@b@acme.com").ok === false);
ok("a leading dot fails", !checkSyntax(".dana@acme.com").ok);
ok("a double dot fails", !checkSyntax("da..na@acme.com").ok);
ok("a space fails", !checkSyntax("da na@acme.com").ok);
ok("a bare TLD fails", !checkSyntax("dana@acme").ok);
ok("a numeric TLD fails", !checkSyntax("dana@acme.123").ok);
ok("a 65-char local part fails", !checkSyntax("a".repeat(65) + "@acme.com").ok);
ok("over 254 chars total fails", !checkSyntax("a".repeat(240) + "@" + "b".repeat(20) + ".com").ok);
ok("a label starting with a hyphen fails", !checkSyntax("dana@-acme.com").ok);
ok("unicode in the local part fails (no provider issues these)", !checkSyntax("dänä@acme.com").ok);

console.log("\n--- normalisation ---");
ok("the domain is lowercased", normalizeEmail("Dana@ACME.com") === "Dana@acme.com");
ok("the local part case is PRESERVED — RFC says it is significant",
  normalizeEmail("Dana@acme.com") === "Dana@acme.com");
ok("whitespace is trimmed", normalizeEmail("  dana@acme.com  ") === "dana@acme.com");

console.log("\n--- role and disposable ---");
ok("info@ is a role address", isRoleAddress("info"));
ok("postmaster@ is a role address", isRoleAddress("postmaster"));
ok("a person is not", !isRoleAddress("dana.lee"));
ok("a listed disposable domain is caught", isDisposableByDomain("mailinator.com", DISPOSABLE));
ok("a disposable SUBdomain is caught too", isDisposableByDomain("x.mailinator.com", DISPOSABLE));
ok("a normal domain is not", !isDisposableByDomain("acme.com", DISPOSABLE));
ok("a novel disposable domain is caught by its MX",
  isDisposableByMx(["mail.guerrillamail.com"]));

console.log("\n--- trap heuristics ---");
ok("a honeypot local part scores high", trapScore("spamtrap", {}).score >= 0.6);
ok("do-not-mail scores high", trapScore("do-not-mail", {}).score >= 0.6);
ok("a normal address scores zero", trapScore("dana.lee", {}).score === 0);
ok("signals accumulate",
  trapScore("dana", { recycledDomain: true, noWebPresence: true, unknownProvenance: true }).score >= 0.5);
ok("the score is capped at 1",
  trapScore("spamtrap", { recycledDomain: true, noWebPresence: true, unknownProvenance: true, neverEngaged: true, honeypotPattern: true }).score === 1);
ok("reasons are always given", trapScore("spamtrap", {}).reasons.length > 0);

console.log("\n--- the five stages ---");
{
  const r = await verify("dana@acme.com", ports(), opts());
  ok("a real mailbox verifies VALID", r.status === "VALID", r.status);
  ok("evidence records the MX", r.evidence.mxHosts[0] === "mx1.acme.com");
  ok("and that the probe ran", r.evidence.smtpOk === true);
}
{
  const r = await verify("not an email", ports(), opts());
  ok("bad syntax short-circuits to INVALID", r.status === "INVALID");
  ok("and never reaches the probe — smtpOk stays null", r.evidence.smtpOk === null);
}
{
  const r = await verify("dana@dead.test", ports({ resolveMx: async () => [] }), opts());
  ok("a domain with no MX and no A is INVALID", r.status === "INVALID");
}
{
  const r = await verify("dana@nomx.test", ports(), opts());
  ok("no MX but an A record still routes mail", r.status !== "INVALID", r.status);
  ok("and evidence says mxOk is false", r.evidence.mxOk === false && r.evidence.domainOk === true);
}
{
  const r = await verify("dana@mailinator.com", ports(), opts());
  ok("a disposable address is DISPOSABLE", r.status === "DISPOSABLE");
  ok("and is never probed", r.evidence.smtpOk === null);
}
{
  const r = await verify("spamtrap@acme.com", ports(), opts());
  ok("a trap-suspect address is blocked before probing", r.status === "TRAP_SUSPECT");
  ok("with its reasons recorded", r.evidence.trapReasons.length > 0);
}
{
  const r = await verify("gone@acme.com", ports(), opts());
  ok("an address the server rejects is INVALID", r.status === "INVALID", r.status);
  ok("and the receiving server's verbatim response is kept",
    r.evidence.smtpResponse === "550 5.1.1 User unknown", String(r.evidence.smtpResponse));
}
{
  // Ordering matters: the trap check must run BEFORE the probe, so a suspected
  // trap is never contacted at all. "nobody" is a published honeypot pattern.
  const r = await verify("nobody@acme.com", ports(), opts());
  ok("a honeypot local part is blocked BEFORE any SMTP contact",
    r.status === "TRAP_SUSPECT" && r.evidence.smtpOk === null, r.status);
}
{
  const r = await verify("info@acme.com", ports(), opts());
  ok("a role address that exists is ROLE, not VALID", r.status === "ROLE", r.status);
}

console.log("\n--- catch-all: the honesty rule ---");
{
  // A server that accepts literally everything, including our random probe.
  const acceptAll = ports({ smtpProbe: async () => ({ accepted: true, response: "250 OK" }) });
  const r = await verify("anyone@catchall.test", acceptAll, opts());
  ok("a catch-all domain returns CATCH_ALL, NOT VALID", r.status === "CATCH_ALL", r.status);
  ok("evidence says catchAll", r.evidence.catchAll === true);
  ok("CATCH_ALL is still sendable — deliverable-unknown, not bad", isSendable("CATCH_ALL"));
  ok("but it gets a shorter TTL than VALID", TTL_DAYS.CATCH_ALL < TTL_DAYS.VALID);
}
{
  const r = await verify("dana@known.test", ports(), opts({ knownCatchAll: new Set(["known.test"]) }));
  ok("a known catch-all domain skips the probe entirely", r.status === "CATCH_ALL" && r.evidence.smtpOk === null);
}

console.log("\n--- probe isolation ---");
{
  // No probe port supplied at all — this is the shape the engine takes when it
  // runs anywhere other than the dedicated verification host.
  const noProbe: VerifyPorts = { resolveMx: async (d) => ["mx1." + d], resolveA: async () => ["1.2.3.4"] };
  const r = await verify("dana@acme.com", noProbe, opts());
  ok("without a probe port the engine CANNOT probe", r.evidence.smtpOk === null);
  ok("and returns UNKNOWN rather than guessing VALID", r.status === "UNKNOWN", r.status);
}
{
  const msMx = ports({ resolveMx: async () => ["acme-com.mail.protection.outlook.com"] });
  const r = await verify("dana@acme.com", msMx, opts({ alwaysAccepts: ALWAYS_ACCEPTS_MX }));
  ok("a provider that always accepts is not probed — the probe proves nothing",
    r.status === "UNKNOWN" && r.evidence.smtpOk === null, r.status);
}
{
  const r = await verify("dana@acme.com", ports({ smtpProbe: async () => null }), opts());
  ok("a probe that declines to run yields UNKNOWN, never VALID", r.status === "UNKNOWN");
}

console.log("\n--- gating ---");
ok("VALID is sendable", isSendable("VALID"));
ok("ROLE is sendable", isSendable("ROLE"));
ok("INVALID is not sendable", !isSendable("INVALID"));
ok("DISPOSABLE blocks", isBlocking("DISPOSABLE"));
ok("TRAP_SUSPECT blocks", isBlocking("TRAP_SUSPECT"));
ok("UNKNOWN is neither sendable nor blocking — it needs a decision",
  !isSendable("UNKNOWN") && !isBlocking("UNKNOWN"));
ok("the trap threshold is documented and below 1", TRAP_BLOCK_THRESHOLD > 0 && TRAP_BLOCK_THRESHOLD < 1);

console.log("\n--- TTLs ---");
{
  const r = await verify("dana@acme.com", ports(), opts());
  const days = Math.round((r.expiresAt.getTime() - r.checkedAt.getTime()) / 86_400_000);
  ok("a VALID result expires on the VALID TTL", days === TTL_DAYS.VALID, String(days));
  ok("risky verdicts expire sooner than clean ones",
    TTL_DAYS.TRAP_SUSPECT < TTL_DAYS.VALID && TTL_DAYS.UNKNOWN < TTL_DAYS.VALID);
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
