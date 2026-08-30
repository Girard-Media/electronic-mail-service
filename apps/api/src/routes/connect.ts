import { Hono } from "hono";
import { sessionAuth, type SessionVars } from "../middleware/session.js";
import { requirePerm } from "../lib/require-perm.js";
import {
  startConnect,
  handleCallback,
  isConnectProvider,
} from "../lib/connected-accounts.js";

// Connected-mailbox OAuth flow (session-authed; same-origin so the session
// cookie rides along through the provider redirect). Mounted at /connect.
export const connect = new Hono<{ Variables: SessionVars }>();

connect.use("*", sessionAuth);

// Start: redirect the browser to the provider's consent screen.
connect.get("/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isConnectProvider(provider)) return c.notFound();
  requirePerm(c, "mailbox:write");
  const url = await startConnect(provider, c.get("projectId"));
  return c.redirect(url);
});

// Callback: exchange the code, store the account, bounce back to the dashboard.
connect.get("/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  if (!isConnectProvider(provider)) return c.notFound();
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (c.req.query("error") || !code || !state) {
    return c.redirect("/dashboard?connected=error");
  }
  requirePerm(c, "mailbox:write");
  try {
    const { email } = await handleCallback(
      provider,
      code,
      state,
      c.get("projectId"),
    );
    return c.redirect(`/dashboard?connected=${encodeURIComponent(email)}`);
  } catch {
    return c.redirect("/dashboard?connected=error");
  }
});
