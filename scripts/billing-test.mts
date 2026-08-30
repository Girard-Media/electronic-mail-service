// Billing seam unit test — fail-closed Null provider + Stripe webhook signature
// verification (the security-critical bit), all without touching Stripe's network.
import { createHmac } from "node:crypto";
import { makeBillingProvider } from "../packages/core/src/billing.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

// --- Null provider (no key) fails closed ---
const nul = makeBillingProvider(undefined);
ok("null: not configured", nul.configured === false && nul.name === "null");
ok("null: status reports not-connected", (await nul.getConnectStatus("acct_x")).connected === false);
ok("null: verifyWebhook always false", nul.verifyWebhook("{}", "t=1,v1=abc") === false);
let threw = false;
try {
  await nul.createConnectAccount({});
} catch {
  threw = true;
}
ok("null: createConnectAccount throws (catchable)", threw);

// --- Stripe provider: webhook signature verification ---
const secret = "whsec_test_secret";
const sp = makeBillingProvider("sk_test_x", secret);
ok("stripe: configured", sp.configured === true && sp.name === "stripe");

const payload = JSON.stringify({ id: "evt_1", type: "account.updated" });
const sign = (ts: number, body: string, sec: string) =>
  createHmac("sha256", sec).update(`${ts}.${body}`).digest("hex");
const t = Math.floor(Date.now() / 1000);

ok("stripe: valid signature accepted", sp.verifyWebhook(payload, `t=${t},v1=${sign(t, payload, secret)}`) === true);
// Secret rotation: Stripe sends one v1 per active secret; ANY valid one must pass,
// regardless of position (order-independent).
ok("stripe: multi-v1 valid-first accepted", sp.verifyWebhook(payload, `t=${t},v1=${sign(t, payload, secret)},v1=deadbeef`) === true);
ok("stripe: multi-v1 valid-last accepted", sp.verifyWebhook(payload, `t=${t},v1=${"0".repeat(64)},v1=${sign(t, payload, secret)}`) === true);
ok("stripe: multi-v1 all-bad rejected", sp.verifyWebhook(payload, `t=${t},v1=${"0".repeat(64)},v1=deadbeef`) === false);
ok("stripe: future-dated t rejected", sp.verifyWebhook(payload, `t=${t + 1000},v1=${sign(t + 1000, payload, secret)}`) === false);
ok("stripe: tampered payload rejected", sp.verifyWebhook(payload + " ", `t=${t},v1=${sign(t, payload, secret)}`) === false);
ok("stripe: wrong secret rejected", sp.verifyWebhook(payload, `t=${t},v1=${sign(t, payload, "wrong")}`) === false);
ok("stripe: stale timestamp rejected (replay)", sp.verifyWebhook(payload, `t=${t - 1000},v1=${sign(t - 1000, payload, secret)}`) === false);
ok("stripe: missing v1 rejected", sp.verifyWebhook(payload, `t=${t}`) === false);
ok("stripe: missing/garbage header rejected", sp.verifyWebhook(payload, null) === false && sp.verifyWebhook(payload, "garbage") === false);

// No webhook secret configured → verification can never pass.
const noWh = makeBillingProvider("sk_test_x");
ok("stripe: no webhook secret → always false", noWh.verifyWebhook(payload, `t=${t},v1=${sign(t, payload, secret)}`) === false);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
