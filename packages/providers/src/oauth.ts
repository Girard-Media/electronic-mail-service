// OAuth toolkit for connected-account sending (per-user OAuth). Builds consent
// URLs, exchanges auth codes, refreshes access tokens, and looks up the
// connected address. Provider-agnostic: callers persist the returned TokenSet.
//
// Designed so Workspace domain-wide delegation can be added later as an
// alternative token source without touching the providers.

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Microsoft only — tenant ("common", "organizations", or a tenant id). */
  tenant?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms when accessToken expires */
  expiresAt: number;
  scope?: string;
}

// ---------- Google ----------

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
];

export function googleAuthUrl(cfg: OAuthAppConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // ask for a refresh token
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH}?${p.toString()}`;
}

async function googleToken(
  cfg: OAuthAppConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...params,
    }).toString(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(
      `Google token error: ${(j.error_description as string) ?? (j.error as string) ?? r.status}`,
    );
  }
  return {
    accessToken: j.access_token as string,
    refreshToken: j.refresh_token as string | undefined,
    expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
    scope: j.scope as string | undefined,
  };
}

export const exchangeGoogleCode = (cfg: OAuthAppConfig, code: string) =>
  googleToken(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });

export const refreshGoogleToken = (cfg: OAuthAppConfig, refreshToken: string) =>
  googleToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });

export async function googleAddress(accessToken: string): Promise<string | null> {
  const r = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { email?: string };
  return j.email ?? null;
}

// ---------- Microsoft ----------

const msBase = (tenant = "common") =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";
export const MS_SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "offline_access",
  "openid",
  "email",
];

export function microsoftAuthUrl(cfg: OAuthAppConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: MS_SCOPES.join(" "),
    response_mode: "query",
    state,
  });
  return `${msBase(cfg.tenant)}/authorize?${p.toString()}`;
}

async function microsoftToken(
  cfg: OAuthAppConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const r = await fetch(`${msBase(cfg.tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: MS_SCOPES.join(" "),
      ...params,
    }).toString(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(
      `Microsoft token error: ${(j.error_description as string) ?? (j.error as string) ?? r.status}`,
    );
  }
  return {
    accessToken: j.access_token as string,
    refreshToken: j.refresh_token as string | undefined,
    expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
    scope: j.scope as string | undefined,
  };
}

export const exchangeMicrosoftCode = (cfg: OAuthAppConfig, code: string) =>
  microsoftToken(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });

export const refreshMicrosoftToken = (cfg: OAuthAppConfig, refreshToken: string) =>
  microsoftToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });

export async function microsoftAddress(accessToken: string): Promise<string | null> {
  const r = await fetch(GRAPH_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as {
    mail?: string;
    userPrincipalName?: string;
  };
  return j.mail ?? j.userPrincipalName ?? null;
}
