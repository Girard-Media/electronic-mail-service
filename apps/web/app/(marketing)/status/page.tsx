import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Status",
  description: "Live component status for the EMS API, database, and send queue.",
};

type Probe = { ok: boolean; ms: number };
type ReadyBody = {
  status: "ok" | "degraded" | "down";
  service: string;
  checks: {
    postgres: Probe;
    redis: Probe;
    send_queue: { ok: boolean; waiting: number; failed: number };
  };
};

async function loadReadyz(): Promise<{ http: number; body: ReadyBody | null }> {
  const base = (process.env.API_URL ?? "https://api.electronicmailservices.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/readyz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    let body: ReadyBody | null = null;
    try {
      body = (await res.json()) as ReadyBody;
      if (!body || typeof body.status !== "string" || !body.checks) body = null;
    } catch {
      body = null;
    }
    return { http: res.status, body };
  } catch {
    return { http: 0, body: null };
  }
}

function chip(ok: boolean, label: string) {
  const color = ok ? "var(--ok)" : "#f87171";
  const bg = ok ? "var(--okbg)" : "rgba(248,113,113,.13)";
  return (
    <span
      className="chip"
      style={{ background: bg, color, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}
    >
      {label}
    </span>
  );
}

export default async function Status() {
  const { http, body } = await loadReadyz();
  const overall =
    !body || http === 0 ? "down" : body.status === "ok" ? "ok" : body.status === "degraded" ? "degraded" : "down";
  const headline =
    overall === "ok" ? "All systems operational" : overall === "degraded" ? "Degraded performance" : "Service disruption";
  const headlineColor =
    overall === "ok" ? "var(--ok)" : overall === "degraded" ? "var(--warn)" : "#f87171";
  const pg = body?.checks.postgres;
  const redis = body?.checks.redis;
  const q = body?.checks.send_queue;
  const checkedAt = new Date().toISOString();

  const rows: { name: string; ok: boolean; detail: string }[] = [
    {
      name: "API",
      ok: http === 200 && Boolean(body),
      detail: http === 0 ? "Could not reach the API" : `HTTP ${http}`,
    },
    {
      name: "Database",
      ok: Boolean(pg?.ok),
      detail: pg ? `${pg.ms} ms` : "unreachable",
    },
    {
      name: "Queue",
      ok: Boolean(redis?.ok),
      detail: redis ? `${redis.ms} ms` : "unreachable",
    },
    {
      name: "Send queue",
      ok: Boolean(q?.ok),
      detail: q ? `${q.waiting} waiting · ${q.failed} failed` : "unknown",
    },
  ];

  return (
    <main className="wrap" style={{ padding: "72px 24px 96px", maxWidth: 720 }}>
      <span className="eyebrow">
        <i className="ti ti-activity" /> Status
      </span>
      <h1 style={{ fontSize: 36, marginTop: 12 }}>{headline}</h1>
      <p className="muted" style={{ marginTop: 10 }}>
        <span style={{ color: headlineColor, fontWeight: 600 }}>
          {overall === "ok" ? "OK" : overall === "degraded" ? "Degraded" : "Down"}
        </span>
        {" · "}checked {new Date(checkedAt).toUTCString()}
      </p>
      <div className="card" style={{ marginTop: 28, padding: 0, overflow: "hidden" }}>
        {rows.map((r) => (
          <div
            key={r.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            {chip(r.ok, r.ok ? "Operational" : "Down")}
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
              {r.detail}
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
        Liveness is separate from this page: <span className="mono">GET /livez</span> answers even
        when the database is down. This view is <span className="mono">/readyz</span> — whether we
        can serve mail.
      </p>
    </main>
  );
}
