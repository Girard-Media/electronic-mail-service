import { sign, verify as verifyJwt } from "hono/jwt";
import { env, errors, encryptSecret } from "@ems/core";
import { prisma } from "@ems/db";
import {
  googleAuthUrl,
  exchangeGoogleCode,
  googleAddress,
  microsoftAuthUrl,
  exchangeMicrosoftCode,
  microsoftAddress,
  GOOGLE_SCOPES,
  MS_SCOPES,
  type OAuthAppConfig,
  type TokenSet,
} from "@ems/providers";

export type ConnectProvider = "google" | "microsoft";

export const isConnectProvider = (p: string): p is ConnectProvider =>
  p === "google" || p === "microsoft";

// OAuth app credentials for a provider, or null when not configured (the
// "Connect mailbox" flow is simply unavailable until the env is set).
export function oauthAppConfig(provider: ConnectProvider): OAuthAppConfig | null {
  if (provider === "google") {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri:
        env.GOOGLE_OAUTH_REDIRECT_URI ?? `${env.API_URL}/connect/google/callback`,
    };
  }
  if (!env.MS_OAUTH_CLIENT_ID || !env.MS_OAUTH_CLIENT_SECRET) return null;
  return {
    clientId: env.MS_OAUTH_CLIENT_ID,
    clientSecret: env.MS_OAUTH_CLIENT_SECRET,
    redirectUri:
      env.MS_OAUTH_REDIRECT_URI ?? `${env.API_URL}/connect/microsoft/callback`,
    tenant: env.MS_OAUTH_TENANT,
  };
}

export const connectAvailable = (provider: ConnectProvider): boolean =>
  oauthAppConfig(provider) !== null;

// Signed, short-lived OAuth `state` — binds the consent round-trip to the
// project + provider and prevents CSRF (HS256 with the session secret).
async function signState(projectId: string, provider: ConnectProvider): Promise<string> {
  return sign(
    { projectId, provider, exp: Math.floor(Date.now() / 1000) + 600 },
    env.AUTH_SECRET,
  );
}

/** Build the provider consent URL for a "Connect mailbox" click. */
export async function startConnect(
  provider: ConnectProvider,
  projectId: string,
): Promise<string> {
  const cfg = oauthAppConfig(provider);
  if (!cfg) throw errors.validation(`${provider} connect is not configured.`);
  const state = await signState(projectId, provider);
  return provider === "google"
    ? googleAuthUrl(cfg, state)
    : microsoftAuthUrl(cfg, state);
}

/** Exchange the OAuth callback for tokens and upsert the connected account. */
export async function handleCallback(
  provider: ConnectProvider,
  code: string,
  state: string,
  sessionProjectId: string,
): Promise<{ email: string }> {
  let payload: { projectId?: string; provider?: string };
  try {
    payload = (await verifyJwt(state, env.AUTH_SECRET, "HS256")) as {
      projectId?: string;
      provider?: string;
    };
  } catch {
    throw errors.validation("Invalid or expired OAuth state.");
  }
  if (payload.provider !== provider || payload.projectId !== sessionProjectId) {
    throw errors.validation("OAuth state mismatch.");
  }

  const cfg = oauthAppConfig(provider);
  if (!cfg) throw errors.validation(`${provider} connect is not configured.`);

  const tokens: TokenSet =
    provider === "google"
      ? await exchangeGoogleCode(cfg, code)
      : await exchangeMicrosoftCode(cfg, code);
  if (!tokens.refreshToken) {
    throw errors.validation(
      "No refresh token returned — re-connect and grant offline access.",
    );
  }
  const address =
    provider === "google"
      ? await googleAddress(tokens.accessToken)
      : await microsoftAddress(tokens.accessToken);
  if (!address) throw errors.validation("Could not read the connected mailbox address.");

  const email = address.toLowerCase();
  const scopes = provider === "google" ? GOOGLE_SCOPES : MS_SCOPES;
  const tokenFields = {
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: encryptSecret(tokens.refreshToken),
    tokenExpiresAt: new Date(tokens.expiresAt),
    scopes,
    status: "active" as const,
  };
  await prisma.connectedAccount.upsert({
    where: { projectId_email: { projectId: sessionProjectId, email } },
    create: { projectId: sessionProjectId, provider, email, ...tokenFields },
    update: { provider, lastError: null, ...tokenFields },
  });
  return { email };
}

export function listConnected(projectId: string) {
  return prisma.connectedAccount.findMany({
    where: { projectId },
    select: {
      id: true,
      provider: true,
      email: true,
      displayName: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function disconnectAccount(projectId: string, id: string): Promise<void> {
  // deleteMany scopes the delete to this project — no cross-tenant access.
  await prisma.connectedAccount.deleteMany({ where: { id, projectId } });
}
