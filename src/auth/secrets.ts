// Every secret goes to the Keychain through OAuth.PKCEClient.setTokens. Tinycast
// keeps preferences, LocalStorage and Cache as plaintext JSON, so no secret goes there.
//
// One token set holds everything, which avoids relying on two provider ids
// getting two Keychain entries:
//   accessToken  the Open API token (personal API token or OAuth access token)
//   idToken      the v2 session cookie, when one is set
//   scope        how the user signed in: "token" or "oauth"
import { OAuth } from "@raycast/api";
import { base64 } from "./base64";

export type LoginKind = "token" | "oauth";

export interface Auth {
  token?: string;
  kind?: LoginKind;
  v2Cookie?: string;
  expired: boolean;
  updatedAt?: Date;
}

const PROVIDER = {
  providerName: "TickTick",
  providerId: "ticktick",
  description: "Sign in to TickTick to manage your tasks.",
};

export const OAUTH_AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://ticktick.com/oauth/token";
export const OAUTH_SCOPE = "tasks:read tasks:write";

export type RedirectChoice = "web" | "tinycast" | "app";

function client(redirect: RedirectChoice = "web"): OAuth.PKCEClient {
  const redirectMethod = redirect === "web" ? OAuth.RedirectMethod.Web : OAuth.RedirectMethod.App;
  return new OAuth.PKCEClient({ redirectMethod, ...PROVIDER });
}

export async function getAuth(): Promise<Auth> {
  const set = await client().getTokens();
  if (!set?.accessToken && !set?.idToken) return { expired: false };
  const kind = set.scope === "oauth" ? "oauth" : "token";
  return {
    token: set.accessToken || undefined,
    kind,
    v2Cookie: set.idToken || undefined,
    expired: kind === "oauth" && set.isExpired(),
    updatedAt: set.updatedAt,
  };
}

async function write(next: { token?: string; kind?: LoginKind; v2Cookie?: string; expiresIn?: number }): Promise<void> {
  await client().setTokens({
    accessToken: next.token ?? "",
    idToken: next.v2Cookie,
    scope: next.kind ?? "token",
    expiresIn: next.expiresIn,
  });
}

export async function saveApiToken(token: string): Promise<void> {
  const current = await getAuth();
  await write({ token: token.trim(), kind: "token", v2Cookie: current.v2Cookie });
}

export async function saveV2Cookie(cookie: string | undefined): Promise<void> {
  const current = await getAuth();
  await write({ token: current.token, kind: current.kind, v2Cookie: cookie?.trim() || undefined });
}

/** Removes every stored secret. */
export async function signOut(): Promise<void> {
  await client().removeTokens();
}

/**
 * Browser sign-in with your own TickTick developer app. Tinycast hands the
 * authorization code back to the extension, and the extension exchanges it
 * with HTTP Basic. The client secret is used for this one call and never stored.
 */
export async function oauthSignIn(clientId: string, clientSecret: string, redirect: RedirectChoice): Promise<void> {
  const pkce = client(redirect);
  const extraParameters: Record<string, string> = {};
  if (redirect === "tinycast") extraParameters.redirect_uri = "tinycast://oauth";
  const request = await pkce.authorizationRequest({
    endpoint: OAUTH_AUTHORIZE_URL,
    clientId,
    scope: OAUTH_SCOPE,
    extraParameters,
  });
  const redirectUri = extraParameters.redirect_uri ?? request.redirectURI;
  const { authorizationCode } = await pkce.authorize(request);

  const body = new URLSearchParams({
    code: authorizationCode,
    grant_type: "authorization_code",
    scope: OAUTH_SCOPE,
    redirect_uri: redirectUri,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TickTick refused the sign-in (${res.status}): ${text.slice(0, 200)}`);
  const reply = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!reply.access_token) throw new Error("TickTick sent no access token.");
  const current = await getAuth();
  await write({ token: reply.access_token, kind: "oauth", v2Cookie: current.v2Cookie, expiresIn: reply.expires_in });
}
