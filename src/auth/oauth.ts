import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppConfig } from "../config/apps";
import type { AppDb } from "../db/client";
import { oauthStates, users } from "../db/schema";
import type { WorkerEnv } from "../env";
import { createId, randomBase64Url } from "../utils/crypto";
import { createPkceChallenge, createPkceVerifier } from "../utils/pkce";
import { addSecondsIso, nowIso } from "../utils/time";

const STATE_TTL_SECONDS = 10 * 60;

export interface OAuthStateRecord {
  state: string;
  authorizeUrl: string;
}

export interface LinuxDoUserInfo {
  id: string;
  username?: string;
  name?: string;
  avatar_url?: string;
}

export async function createOAuthState(options: {
  db: AppDb;
  env: WorkerEnv;
  app: AppConfig;
  redirectUri: string;
  callbackUrl: string;
  pkceEnabled?: boolean;
}): Promise<OAuthStateRecord> {
  const state = createId("st");
  const pkceEnabled = options.pkceEnabled ?? true;
  const verifier = pkceEnabled ? createPkceVerifier() : null;
  const authorizeUrl = new URL(options.env.LINUX_DO_OAUTH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", options.env.LINUX_DO_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", options.callbackUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "read");
  if (verifier) {
    authorizeUrl.searchParams.set("code_challenge", await createPkceChallenge(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
  }

  await options.db.insert(oauthStates).values({
    state,
    appId: options.app.id,
    redirectUri: options.redirectUri,
    codeVerifier: verifier,
    pkceEnabled,
    expiresAt: addSecondsIso(STATE_TTL_SECONDS),
    createdAt: nowIso()
  });

  return { state, authorizeUrl: authorizeUrl.toString() };
}

export async function consumeOAuthState(options: { db: AppDb; state: string }): Promise<{
  appId: string;
  redirectUri: string;
  codeVerifier: string | null;
} | null> {
  const now = nowIso();
  const record = await options.db
    .update(oauthStates)
    .set({ consumedAt: now })
    .where(and(eq(oauthStates.state, options.state), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, now)))
    .returning({
      appId: oauthStates.appId,
      redirectUri: oauthStates.redirectUri,
      codeVerifier: oauthStates.codeVerifier
    })
    .get();
  if (!record) return null;
  return { appId: record.appId, redirectUri: record.redirectUri, codeVerifier: record.codeVerifier };
}

export async function exchangeCodeForLinuxDoAccessToken(options: {
  env: WorkerEnv;
  code: string;
  callbackUrl: string;
  codeVerifier: string | null;
  fetcher?: typeof fetch;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: options.env.LINUX_DO_CLIENT_ID,
    client_secret: options.env.LINUX_DO_CLIENT_SECRET,
    code: options.code,
    redirect_uri: options.callbackUrl
  });
  if (options.codeVerifier) body.set("code_verifier", options.codeVerifier);

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(options.env.LINUX_DO_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body
  });
  if (!response.ok) throw new Error("Linux DO token exchange failed.");

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Linux DO token response missing access_token.");
  }
  return payload.access_token;
}

export async function fetchLinuxDoUserInfo(options: {
  env: WorkerEnv;
  accessToken: string;
  fetcher?: typeof fetch;
}): Promise<LinuxDoUserInfo> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(options.env.LINUX_DO_USERINFO_URL, {
    headers: { authorization: `Bearer ${options.accessToken}`, accept: "application/json" }
  });
  if (!response.ok) throw new Error("Linux DO userinfo fetch failed.");
  const payload = (await response.json()) as Record<string, unknown>;
  const id = payload.id ?? payload.sub ?? payload.user_id;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("Linux DO userinfo missing id.");
  const info: LinuxDoUserInfo = {
    id: String(id)
  };
  if (typeof payload.username === "string") info.username = payload.username;
  if (typeof payload.name === "string") info.name = payload.name;
  if (typeof payload.avatar_url === "string") info.avatar_url = payload.avatar_url;
  return info;
}

export async function upsertLinuxDoUser(db: AppDb, info: LinuxDoUserInfo): Promise<{ id: number; linuxDoId: string }> {
  const now = nowIso();
  const insert: typeof users.$inferInsert = {
    linuxDoId: info.id,
    createdAt: now,
    updatedAt: now
  };
  if (info.username !== undefined) insert.username = info.username;
  if (info.name !== undefined) insert.name = info.name;
  if (info.avatar_url !== undefined) insert.avatarUrl = info.avatar_url;

  const update: Partial<typeof users.$inferInsert> = { updatedAt: now };
  if (info.username !== undefined) update.username = info.username;
  if (info.name !== undefined) update.name = info.name;
  if (info.avatar_url !== undefined) update.avatarUrl = info.avatar_url;

  const user = await db
    .insert(users)
    .values(insert)
    .onConflictDoUpdate({
      target: users.linuxDoId,
      set: update
    })
    .returning({
      id: users.id,
      linuxDoId: users.linuxDoId
    })
    .get();

  if (!user) throw new Error("Failed to upsert user.");
  return user;
}

export function createMockLinuxDoAccessToken(): string {
  return `ldo_${randomBase64Url(24)}`;
}
