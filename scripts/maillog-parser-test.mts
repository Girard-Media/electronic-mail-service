/**
 * Maillog parser fixture suite (E08-018, E08-019). Invariants I4 and I6.
 *
 * These are real Postfix lines. The suite fails CI on any parser regression,
 * because every number on the deliverability cockpit descends from this code.
 */
import {
  parseLine, ingestBatch, Correlator, espFromRelay,
  type SmtpDelivery,
} from "../packages/deliverability/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

console.log("\n--- envelope ---");
{
  const r = parseLine("Aug 30 04:38:57 mta01 postfix/smtp[8841]: 3F2A1C4D91: to=<buyer@acme.com>, relay=aspmx.l.google.com[142.251.16.27]:25, delay=1.4, delays=0.09/0/0.6/0.7, dsn=2.0.0, status=sent (250 2.0.0 OK 1756533291 d2e1af)");
  const d = r.line as SmtpDelivery;
  ok("parses a delivered line", !r.unparsed && d.kind === "smtp");
  ok("queue id", d.queueId === "3F2A1C4D91", String(d.queueId));
  ok("recipient", d.to === "buyer@acme.com", String(d.to));
  ok("relay host", d.relayHost === "aspmx.l.google.com", String(d.relayHost));
  ok("status", d.status === "sent");
  ok("dsn", d.dsn === "2.0.0");
  ok("delay converted to ms", d.delayMs === 1400, String(d.delayMs));
  ok("smtp code extracted", d.smtpCode === 250, String(d.smtpCode));
  ok("response preserved VERBATIM, not summarised",
    d.response === "250 2.0.0 OK 1756533291 d2e1af", String(d.response));
}
{
  const r = parseLine("Aug 30 04:39:02 mta01 postfix/smtp[8902]: 7B1E44A20C: to=<ops@northwind.io>, relay=gmail-smtp-in.l.google.com[74.125.24.27]:25, delay=2.1, dsn=4.7.0, status=deferred (host gmail-smtp-in.l.google.com said: 421-4.7.0 Our system has detected an unusual rate of unsolicited mail)");
  const d = r.line as SmtpDelivery;
  ok("parses a deferral", d.status === "deferred");
  ok("keeps the whole 421 text including the host prefix",
    (d.response ?? "").includes("421-4.7.0 Our system has detected an unusual rate"), String(d.response));
}
{
  const r = parseLine("Aug 30 04:40:11 mta01 postfix/smtp[8903]: 9C2D55B31E: to=<nobody@acme.com>, relay=aspmx.l.google.com[142.251.16.27]:25, delay=0.9, dsn=5.1.1, status=bounced (host aspmx.l.google.com said: 550-5.1.1 The email account that you tried to reach does not exist)");
  const d = r.line as SmtpDelivery;
  ok("parses a bounce", d.status === "bounced" && d.dsn === "5.1.1");
  ok("bounce code", d.smtpCode === null || d.smtpCode === 550);
}
{
  const r = parseLine("Aug 30 04:38:55 mta01 postfix/cleanup[8840]: 3F2A1C4D91: message-id=<abc123@mta01.example.com>");
  ok("cleanup line yields the Message-ID (I4)",
    !r.unparsed && r.line?.messageId === "abc123@mta01.example.com", String(r.line?.messageId));
}
{
  const r = parseLine("Aug 30 04:38:56 mta01 postfix/qmgr[900]: 3F2A1C4D91: from=<alex@nw.com>, size=2841, nrcpt=1 (queue active)");
  ok("qmgr line parses", !r.unparsed && r.line?.kind === "qmgr");
}
{
  const r = parseLine("this is not a postfix line at all");
  ok("garbage is flagged unparsed, never silently dropped", r.unparsed && r.line === null);
}
{
  const r = parseLine("Aug 30 04:41:00 mta01 postfix/smtp[8905]: A1B2C3: to=<x@y.com>, relay=none");
  ok("an smtp line with no status is unparsed, not an event with a null outcome", r.unparsed);
}
{
  const r = parseLine("<22>2026-08-30T04:38:57.123456+00:00 mta01 postfix/smtp[8841]: DEAD01: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=0.5, dsn=2.0.0, status=sent (250 ok)");
  ok("RFC5424 / ISO timestamp envelope also parses", !r.unparsed, "syslog variant");
}

{
  const r = parseLine("Aug 30 04:41:22 mta01 postfix/smtp[8841]: warning: numeric domain name in resource data of MX record");
  ok("`warning:` is NOT mistaken for a queue id", r.line?.queueId === null, String(r.line?.queueId));
}
{
  const r = parseLine("Aug 30 04:41:23 mta01 postfix/smtpd[9001]: NOQUEUE: reject: RCPT from unknown[1.2.3.4]: 554 5.7.1 Relay access denied");
  ok("NOQUEUE is not a queue id either", r.line?.queueId === null, String(r.line?.queueId));
}
{
  const r = parseLine("Aug 30 04:41:24 mta01 postfix/smtp[8841]: 4XxvKf3Yz0zMLnP2: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)");
  ok("long-form base-52 queue ids parse", r.line?.queueId === "4XxvKf3Yz0zMLnP2", String(r.line?.queueId));
}

console.log("\n--- correlation ---");
{
  const c = new Correlator();
  const { events, stats } = ingestBatch([
    "Aug 30 04:38:55 mta01 postfix/cleanup[8840]: QQ1: message-id=<m1@ems>",
    "Aug 30 04:38:57 mta01 postfix/smtp[8841]: QQ1: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)",
  ], c);
  ok("queue id joins to Message-ID", events[0]?.messageId === "m1@ems", String(events[0]?.messageId));
  ok("correlated counter", stats.correlated === 1 && stats.uncorrelated === 0);
}
{
  const c = new Correlator();
  const { events, stats } = ingestBatch([
    "Aug 30 04:38:57 mta01 postfix/smtp[8841]: ZZ9: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)",
  ], c);
  ok("a delivery with no cleanup line is UNCORRELATED, and still emitted",
    events.length === 1 && events[0]?.messageId === null && stats.uncorrelated === 1);
}
{
  // Batches arrive out of order; the correlator must survive across them (E08-011).
  const c = new Correlator();
  ingestBatch(["Aug 30 04:38:55 mta01 postfix/cleanup[8840]: SPLIT1: message-id=<m2@ems>"], c);
  const { events } = ingestBatch([
    "Aug 30 04:39:57 mta01 postfix/smtp[8841]: SPLIT1: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)",
  ], c);
  ok("correlation survives across batches", events[0]?.messageId === "m2@ems");
}
{
  // One message, several recipients → several smtp lines on one queue id (E08-009).
  const c = new Correlator();
  const { events } = ingestBatch([
    "Aug 30 04:38:55 mta01 postfix/cleanup[8840]: MULTI: message-id=<m3@ems>",
    "Aug 30 04:38:57 mta01 postfix/smtp[8841]: MULTI: to=<a@b.com>, relay=mx.b.com[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)",
    "Aug 30 04:38:58 mta01 postfix/smtp[8841]: MULTI: to=<c@d.com>, relay=mx.d.com[5.6.7.8]:25, delay=1.2, dsn=5.1.1, status=bounced (550 no such user)",
  ], c);
  ok("multi-recipient produces one event per recipient", events.length === 2);
  ok("each keeps its own outcome", events[0]?.status === "sent" && events[1]?.status === "bounced");
  ok("both join to the same Message-ID", events.every((e) => e.messageId === "m3@ems"));
}
{
  const c = new Correlator(1000);
  c.remember("OLD", "m@x", 0);
  ok("an entry past its TTL does not resolve", c.resolve("OLD", 5000) === null);
  ok("and is evicted rather than leaking", c.size === 0);
}

console.log("\n--- ESP classification from the relay ---");
ok("google", espFromRelay("aspmx.l.google.com") === "google");
ok("gmail-smtp-in", espFromRelay("gmail-smtp-in.l.google.com") === "google");
ok("microsoft", espFromRelay("acme-com.mail.protection.outlook.com") === "microsoft");
ok("yahoo", espFromRelay("mta7.am0.yahoodns.net") === "yahoo");
ok("proofpoint", espFromRelay("mx1.acme.com.pphosted.com") === "proofpoint");
ok("mimecast", espFromRelay("eu-smtp-inbound-1.mimecast.com") === "mimecast");
ok("an unknown MX falls to generic, never guesses", espFromRelay("mail.some-random-host.tld") === "generic");
ok("no relay at all is generic", espFromRelay(null) === "generic");

console.log("\n--- unparsed lines are evidence, not noise ---");
{
  const c = new Correlator();
  const { unparsed, stats } = ingestBatch([
    "Aug 30 04:38:57 mta01 postfix/smtp[8841]: QQ2: to=<a@b.com>, relay=mx[1.2.3.4]:25, delay=1.0, dsn=2.0.0, status=sent (250 ok)",
    "total garbage",
    "another bad line",
  ], c);
  ok("unparsed lines are retained for the queue", unparsed.length === 2);
  ok("and counted", stats.unparsed === 2 && stats.parsed === 1);
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
