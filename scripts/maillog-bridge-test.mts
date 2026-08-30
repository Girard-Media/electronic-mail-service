// The maillog bridge turns Postfix's own delivery lines into `delivered` events.
// Correlation must be exact: emitting a delivered event against the WRONG email
// id would be worse than emitting none, so an unknown queue id must stay silent.
process.env.MAILLOG_TEST = "1";
const { handleLine } = await import("../apps/maillog-bridge/src/index.js");

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); if (!c) fail++; };

const QID = "11CC6481956";
const EMAIL = "cmt0vhmx8002poa4ayfso67lp";

// A delivery for a queue id we have never seen must NOT be correlated.
ok("unknown queue id emits nothing",
  handleLine(`Aug 20 01:59:50 mail postfix/smtp[1]: DEADBEEF01: to=<a@b.com>, relay=x, delay=1, dsn=2.0.0, status=sent (250 ok)`) === null);

// Learn the id from the VERP envelope sender.
ok("from= line learns the id, emits nothing",
  handleLine(`Aug 20 01:59:49 mail postfix/qmgr[2]: ${QID}: from=<bounce+${EMAIL}@bounce.electronicmailservices.com>, size=1381, nrcpt=1 (queue active)`) === null);

const d = handleLine(`Aug 20 01:59:50 mail postfix/smtp[3]: ${QID}: to=<sgirard@girardmedia.com>, relay=aspmx.l.google.com[192.178.155.26]:25, delay=0.99, dsn=2.0.0, status=sent (250 2.0.0 OK gsmtp)`);
ok("status=sent emits delivered", d?.type === "delivered");
ok("correlates to the right email id", d?.emailId === EMAIL);
ok("captures the recipient", d?.recipient === "sgirard@girardmedia.com");
ok("captures the dsn code", d?.code === "2.0.0");

// A second delivery on the same qid must not double-fire (id is consumed).
ok("delivered is not emitted twice for one queue id",
  handleLine(`Aug 20 01:59:51 mail postfix/smtp[3]: ${QID}: to=<sgirard@girardmedia.com>, relay=x, delay=1, dsn=2.0.0, status=sent (250 ok)`) === null);

// message-id= is the fallback when VERP is off.
const Q2 = "AA11BB22CC";
ok("message-id line learns the id",
  handleLine(`Aug 20 02:00:00 mail postfix/cleanup[4]: ${Q2}: message-id=<abc123@electronicmailservices.com>`) === null);
const d2 = handleLine(`Aug 20 02:00:01 mail postfix/smtp[5]: ${Q2}: to=<x@y.com>, relay=r, delay=1, dsn=5.1.1, status=bounced (550 no such user)`);
ok("status=bounced maps to bounced", d2?.type === "bounced");
ok("bounce correlates via message-id", d2?.emailId === "abc123");

const Q3 = "BB33CC44DD";
handleLine(`Aug 20 02:00:02 mail postfix/qmgr[6]: ${Q3}: from=<bounce+deferredid@bounce.electronicmailservices.com>, size=1, nrcpt=1`);
const d3 = handleLine(`Aug 20 02:00:03 mail postfix/smtp[7]: ${Q3}: to=<z@q.com>, relay=r, delay=1, dsn=4.2.2, status=deferred (mailbox full)`);
ok("status=deferred maps to delivery_delayed", d3?.type === "delivery_delayed");

ok("noise lines are ignored", handleLine("Aug 20 02:00:04 mail postfix/master[1]: daemon started") === null);
ok("empty line is ignored", handleLine("") === null);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`); process.exit(fail ? 1 : 0);
