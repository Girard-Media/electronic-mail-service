// SC-001 "definition of trust" e2e — the Phase 1 launch gate (per CLAUDE.md).
// Exercises the whole pipeline against a RUNNING stack:
//   signup → verify email → create key → register webhook → send (resend-compat
//   payload) → email shows in the log as sent → a signed webhook is received
//   + verifies.
//
// Requires the stack up (DB + Redis + api + workers) with the send STUBBED so it
// doesn't need a live MTA, and the test webhook flag on:
//   pnpm infra:up
//   MAIL_RELAY_STUB=true WEBHOOK_ALLOW_PRIVATE=true pnpm dev:api      # :8787
//   MAIL_RELAY_STUB=true pnpm dev:workers
//   API_URL=http://localhost:8787 pnpm test:e2e
//
// Sends from @electronicmailservices.com (a SYSTEM_SENDING_DOMAINS member) so no real DNS
// verification is needed for the trust path. Customer sends on that domain
// require the org owner to have verified their email — signup in non-production
// returns `verifyToken` so this script can hit /auth/verify.
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const API = (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const HOOK_PORT = Number(process.env.E2E_HOOK_PORT ?? 8799);

let failures = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function main(): Promise<number> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(HOOK_PORT, r));
  const hookUrl = `http://127.0.0.1:${HOOK_PORT}/hook`;

  let cookie = "";
  const api = async (path: string, init: RequestInit = {}, key?: string) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
    const setc = res.headers.get("set-cookie");
    if (setc) cookie = setc.split(";")[0]!;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { status: res.status, json: json as Record<string, unknown> | null, text };
  };

  try {
    const email = `trust+${process.env.E2E_STAMP ?? Date.now()}@electronicmailservices.com`;
    const signup = await api("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password: "trust-test-pw-123", name: "Trust Test" }),
    });
    ok("signup ok", signup.status === 200, `HTTP ${signup.status}`);
    const verifyToken = signup.json?.verifyToken as string | undefined;
    ok("signup returned verifyToken (non-prod)", Boolean(verifyToken));
    if (verifyToken) {
      await api(`/auth/verify?token=${encodeURIComponent(verifyToken)}`, {
        redirect: "manual",
      });
    }
    const me = await api("/auth/me");
    ok("email verified", me.json?.emailVerified === true, `verified=${String(me.json?.emailVerified)}`);

    const keyRes = await api("/app/keys", {
      method: "POST",
      body: JSON.stringify({ name: "e2e", permission: "full_access" }),
    });
    const apiKey = keyRes.json?.key as string | undefined;
    ok("api key minted", Boolean(apiKey), `HTTP ${keyRes.status}`);

    const hook = await api("/app/webhooks", { method: "POST", body: JSON.stringify({ url: hookUrl }) });
    const secret = hook.json?.secret as string | undefined;
    ok(
      "webhook registered (private allowed in test)",
      Boolean(secret),
      `HTTP ${hook.status} ${hook.text.slice(0, 80)}`,
    );

    const inbox = await api("/inboxes", { method: "POST", body: JSON.stringify({}) }, apiKey);
    const fromAddr = inbox.json?.address as string | undefined;
    ok("shared inbox created", Boolean(fromAddr), `HTTP ${inbox.status} ${inbox.text.slice(0, 80)}`);

    const send = await api(
      "/emails",
      {
        method: "POST",
        body: JSON.stringify({
          from: fromAddr ?? "trust@electronicmailservices.com",
          to: "sink@electronicmailservices.com",
          subject: "SC-001",
          html: "<p>trust</p>",
        }),
      },
      apiKey,
    );
    const emailId = send.json?.id as string | undefined;
    ok("send accepted", Boolean(emailId), `HTTP ${send.status} ${send.text.slice(0, 80)}`);

    let status = "";
    for (let i = 0; i < 30 && emailId; i++) {
      const g = await api(`/emails/${emailId}`, {}, apiKey);
      status = String(g.json?.status ?? "");
      if (status === "sent" || status === "delivered") break;
      await sleep(500);
    }
    ok("email delivered in log", status === "sent" || status === "delivered", `status=${status}`);

    let hit: Received | undefined;
    for (let i = 0; i < 30; i++) {
      hit = emailId ? received.find((r) => r.body.includes(emailId)) : undefined;
      if (hit) break;
      await sleep(500);
    }
    ok("webhook received", Boolean(hit));
    if (hit && secret) {
      const sig = String(hit.headers["ems-signature"] ?? "");
      const expected = "sha256=" + createHmac("sha256", secret).update(hit.body).digest("hex");
      ok("webhook signature verifies", sig === expected, sig ? "" : "no signature header");
    }
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "\nSC-001 PASS — definition of trust holds" : `\n${failures} FAILURE(S)`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("e2e error:", e);
    process.exit(1);
  });
