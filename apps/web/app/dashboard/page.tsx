import { getSession } from "@/lib/session";
import { DashGate } from "@/components/DashGate";

export const dynamic = "force-dynamic";

// Overview — the first ported view. Renders live session data fetched through the API
// bridge, proving the auth + data path end to end.
export default async function DashboardOverview() {
  const session = await getSession();
  if (!session?.user) return <DashGate />;

  const plan = session.branding ? (session.account?.name ?? "—") : "—";
  const memberCount = session.account?.memberships?.length ?? 1;
  const cards: { label: string; value: string; icon: string }[] = [
    { label: "Role", value: session.role ?? "—", icon: "ti-shield-check" },
    {
      label: "Email",
      value: session.emailVerified ? "Verified" : "Unverified",
      icon: session.emailVerified ? "ti-rosette-discount-check" : "ti-alert-triangle",
    },
    { label: "Organizations", value: String(memberCount), icon: "ti-building-community" },
    { label: "Sub-account", value: session.account?.isSubAccount ? "Yes" : "No", icon: "ti-sitemap" },
  ];

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28 }}>Welcome back{session.user.name ? `, ${session.user.name}` : ""}.</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {session.branding?.name ? `${session.branding.name} · ` : ""}
          Signed in as {session.user.email}
        </p>
      </div>

      <div className="grid g4">
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className="ic">
              <i className={`ti ${c.icon}`} />
            </div>
            <h3 style={{ fontSize: 15, color: "var(--tx2)", fontWeight: 600 }}>{c.label}</h3>
            <p style={{ fontSize: 20, color: "var(--tx)", marginTop: 2 }}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>This dashboard is being ported to Next.js</h3>
        <p className="muted" style={{ fontSize: 14.5 }}>
          You&apos;re looking at the new dashboard foundation. Domains, logs, API keys, team,
          and billing views are ported incrementally — the existing dashboard remains
          available while the port completes. {plan ? "" : ""}
        </p>
      </div>
    </>
  );
}
