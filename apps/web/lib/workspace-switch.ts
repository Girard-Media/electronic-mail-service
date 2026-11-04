// Validation for the dashboard's workspace-switch bridge (E18-004). The API
// (POST /app/subaccounts/switch) owns the authorization decision; this layer only
// refuses requests that should never be forwarded.
export type SwitchCheck = { ok: true; orgId: string } | { ok: false; status: number; message: string };

export function checkSwitchRequest(input: {
  origin: string | null;
  host: string | null;
  hasSession: boolean;
  body: unknown;
}): SwitchCheck {
  if (!input.hasSession) return { ok: false, status: 401, message: "Sign in first." };
  // Same-origin only: a cross-site page must not be able to switch the active org.
  let originHost: string | null = null;
  try {
    originHost = input.origin ? new URL(input.origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !input.host || originHost !== input.host) {
    return { ok: false, status: 403, message: "Cross-origin workspace switch refused." };
  }
  const orgId = (input.body as { orgId?: unknown } | null)?.orgId;
  if (typeof orgId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(orgId)) {
    return { ok: false, status: 400, message: "An org id is required." };
  }
  return { ok: true, orgId };
}
