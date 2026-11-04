import { checkSwitchRequest } from "@/lib/workspace-switch";

// Workspace-switch bridge for the dashboard shell (E18-004). Mirrors lib/session.ts:
// the Hono API stays the single source of truth, so this forwards the caller's
// cookies to POST /app/subaccounts/switch (which membership/parent-checks and
// audits) and relays its status, body and active-org cookie back to the browser.
const API_URL = (
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8787"
).replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  const check = checkSwitchRequest({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    hasSession: /(?:^|;\s*)um_session=/.test(cookie),
    body: await request.json().catch(() => null),
  });
  if (!check.ok) return Response.json({ message: check.message }, { status: check.status });

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/app/subaccounts/switch`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ orgId: check.orgId }),
      cache: "no-store",
    });
  } catch {
    return Response.json({ message: "The EMS API is unreachable. Try again shortly." }, { status: 502 });
  }

  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const value of upstream.headers.getSetCookie()) headers.append("set-cookie", value);
  const body = await upstream.text();
  return new Response(body || "{}", { status: upstream.status, headers });
}
