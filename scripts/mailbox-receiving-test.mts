// mailboxReceivingStatus unit test — proves the native-mailbox "can this domain
// receive?" check classifies correctly: a Workspace/other-provider domain is a
// non-destructive CONFLICT (steer to a subdomain), our-MTA MX is READY, and a
// bare domain just needs the MX record. DNS-over-HTTPS is mocked (no network).
import { mailboxReceivingStatus } from "../packages/core/src/dns-health.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

// Mock DoH: answer MX (type=15) queries with the given records, everything else empty.
function mockMx(records: { priority: number; host: string }[]) {
  globalThis.fetch = (async (url: unknown) => {
    const isMx = /type=15/.test(String(url));
    return {
      ok: true,
      json: async () => ({
        Answer: isMx
          ? records.map((r) => ({ name: "q", type: 15, data: `${r.priority} ${r.host}.` }))
          : [],
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

// 1. Domain on Google Workspace → not ready, conflict, detected, steers to subdomain.
mockMx([
  { priority: 1, host: "aspmx.l.google.com" },
  { priority: 5, host: "alt1.aspmx.l.google.com" },
]);
let s = await mailboxReceivingStatus("electronicmailservices.com");
ok("google: not ready", s.ready === false);
ok("google: flagged as conflict with live mail", s.conflictsWithExistingMail === true);
ok("google: provider detected", s.handledBy === "Google Workspace", s.handledBy ?? "");
ok("google: advice steers to a subdomain", /subdomain/i.test(s.advice));

// 2. MX already points at our MTA → ready, no conflict.
mockMx([{ priority: 10, host: "mail.electronicmailservices.com" }]);
s = await mailboxReceivingStatus("inbox.electronicmailservices.com");
ok("ours: ready", s.ready === true);
ok("ours: no conflict", s.conflictsWithExistingMail === false);
ok("ours: handledBy ems", s.handledBy === "ems");

// 3. Bare domain with no MX → not ready, nothing to break, give the record to add.
mockMx([]);
s = await mailboxReceivingStatus("fresh.example.com");
ok("nomx: not ready", s.ready === false);
ok("nomx: no conflict (no live mail to break)", s.conflictsWithExistingMail === false);
ok(
  "nomx: record points host→our MTA",
  s.record.host === "fresh.example.com" && s.record.value === "mail.electronicmailservices.com" && s.record.priority === 10,
);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
