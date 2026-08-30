// Signed-out gate for the Next dashboard foundation. The login UI itself is still
// served by the Hono app (apps/api/public/dashboard.html) until that flow is ported, so
// this points users there to authenticate. Once a `um_session` cookie exists on this
// origin, the dashboard renders the real session view.
export function DashGate() {
  return (
    <main className="mx-auto" style={{ maxWidth: 460, padding: "120px 24px", textAlign: "center" }}>
      <div className="card">
        <div className="ic" style={{ margin: "0 auto 14px" }}>
          <i className="ti ti-lock" />
        </div>
        <h1 style={{ fontSize: 24 }}>Sign in to EMS</h1>
        <p className="muted" style={{ margin: "12px 0 22px" }}>
          You&apos;re signed out. Sign in to manage your domains, API keys, and delivery logs.
        </p>
        <a className="btn pri lg" href="/dashboard">
          <i className="ti ti-login" /> Continue to sign in
        </a>
      </div>
    </main>
  );
}
