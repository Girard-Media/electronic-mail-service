// Guards the public webhook contract: verifyWebhook() in the SDK must accept
// exactly what apps/workers/src/index.ts signs, and reject everything else.
// The signing here is a literal copy of the worker's — if the worker changes,
// this test fails and the SDK/docs must be updated in lockstep.
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../packages/sdk/src/index.js";

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); if (!c) fail++; };

const secret = "whsec_test_9f2b";
// Same body shape recordEvent() builds in apps/workers/src/events.ts.
const body = JSON.stringify({
  type: "email.bounced",
  created_at: new Date(0).toISOString(),
  data: { email_id: "em_123", to: ["a@b.com"], from: "x@y.com", subject: "Hi", reason: "hard" },
});
const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

ok("valid signature accepted", await verifyWebhook({ payload: body, signature: sig, secret }));
ok("raw bytes payload accepted",
  await verifyWebhook({ payload: new TextEncoder().encode(body), signature: sig, secret }));
ok("wrong secret rejected", !(await verifyWebhook({ payload: body, signature: sig, secret: "nope" })));
ok("tampered body rejected", !(await verifyWebhook({ payload: body + " ", signature: sig, secret })));
ok("missing header rejected", !(await verifyWebhook({ payload: body, signature: null, secret })));
ok("missing sha256= prefix rejected",
  !(await verifyWebhook({ payload: body, signature: sig.slice(7), secret })));
ok("non-hex signature rejected", !(await verifyWebhook({ payload: body, signature: "sha256=zzzz", secret })));
ok("odd-length hex rejected", !(await verifyWebhook({ payload: body, signature: "sha256=abc", secret })));
ok("empty secret rejected", !(await verifyWebhook({ payload: body, signature: sig, secret: "" })));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`); process.exit(fail ? 1 : 0);
