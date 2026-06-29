import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getAppConfig } from "../src/config/apps";
import { createDb } from "../src/db/client";
import {
  consumeAuthExchangeCode,
  consumeOAuthState,
  createAuthExchangeCode,
  createOAuthState,
  exchangeCodeForLinuxDoAccessToken,
  fetchLinuxDoUserInfo,
  hashExchangeCode,
  upsertLinuxDoUser
} from "../src/auth/oauth";
import { testEnv } from "./env";
import { migratedDb } from "./d1";
import { authExchangeCodes, users } from "../src/db/schema";
import { createPkceChallenge } from "../src/utils/pkce";

describe("oauth support", () => {
  it("creates and consumes one-time state with flow and PKCE fields", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    const app = getAppConfig("sample-notes");
    expect(app).toBeDefined();
    if (!app) return;
    const flow = app.authFlows[0];
    expect(flow).toBeDefined();
    if (!flow) return;
    const exchangeChallenge = await createPkceChallenge("exchange-verifier");

    const state = await createOAuthState({
      db,
      env,
      app,
      flow,
      exchangeChallenge,
      callbackUrl: "https://worker.example/auth/callback/browser_code"
    });
    const authorizeUrl = new URL(state.authorizeUrl);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("state")).toBe(state.state);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("https://worker.example/auth/callback/browser_code");

    const consumed = await consumeOAuthState({ db, state: state.state });
    expect(consumed).toMatchObject({ appId: "sample-notes", flowId: "browser_code", exchangeChallenge });
    expect(consumed?.codeVerifier).toBeTruthy();
    await expect(consumeOAuthState({ db, state: state.state })).resolves.toBeNull();
  });

  it("atomically allows only one consumer for the same state", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    const app = getAppConfig("sample-notes");
    expect(app).toBeDefined();
    if (!app) return;
    const flow = app.authFlows[0];
    expect(flow).toBeDefined();
    if (!flow) return;

    const state = await createOAuthState({
      db,
      env,
      app,
      flow,
      exchangeChallenge: await createPkceChallenge("exchange-verifier"),
      callbackUrl: "https://worker.example/auth/callback/browser_code"
    });

    const results = await Promise.all([
      consumeOAuthState({ db, state: state.state }),
      consumeOAuthState({ db, state: state.state })
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
  });

  it("does not consume OAuth state when expected flow mismatches", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    const app = getAppConfig("sample-notes");
    expect(app).toBeDefined();
    if (!app) return;
    const flow = app.authFlows[0];
    expect(flow).toBeDefined();
    if (!flow) return;

    const state = await createOAuthState({
      db,
      env,
      app,
      flow,
      exchangeChallenge: await createPkceChallenge("exchange-verifier"),
      callbackUrl: "https://worker.example/auth/callback/browser_code"
    });

    await expect(consumeOAuthState({ db, state: state.state, flowId: "wrong_flow" })).resolves.toBeNull();
    await expect(consumeOAuthState({ db, state: state.state, flowId: "browser_code" })).resolves.toMatchObject({
      appId: "sample-notes",
      flowId: "browser_code"
    });
  });

  it("creates hashed one-time exchange codes and does not consume on verifier mismatch", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    await db.insert(users).values({ linuxDoId: "exchange-user", username: "exchange" });
    const user = await db.query.users.findFirst();
    expect(user).toBeDefined();
    if (!user) return;

    const exchangeChallenge = await createPkceChallenge("correct-verifier");
    const exchange = await createAuthExchangeCode({
      db,
      pepper: env.SERVICE_TOKEN_PEPPER,
      appId: "linuxdo-friends",
      flowId: "browser_code",
      userId: user.id,
      exchangeChallenge,
      ttlSeconds: 60
    });
    const row = await db.query.authExchangeCodes.findFirst({
      where: eq(authExchangeCodes.codeHash, await hashExchangeCode(env.SERVICE_TOKEN_PEPPER, exchange.code))
    });
    expect(row?.codeHash).not.toBe(exchange.code);
    expect(row?.exchangeChallenge).toBe(exchangeChallenge);

    await expect(
      consumeAuthExchangeCode({ db, pepper: env.SERVICE_TOKEN_PEPPER, code: exchange.code, verifier: "wrong-verifier" })
    ).resolves.toBeNull();
    const afterWrongVerifier = await db.query.authExchangeCodes.findFirst({
      where: eq(authExchangeCodes.codeHash, await hashExchangeCode(env.SERVICE_TOKEN_PEPPER, exchange.code))
    });
    expect(afterWrongVerifier?.consumedAt).toBeNull();

    await expect(
      consumeAuthExchangeCode({ db, pepper: env.SERVICE_TOKEN_PEPPER, code: exchange.code, verifier: "correct-verifier" })
    ).resolves.toMatchObject({ appId: "linuxdo-friends", flowId: "browser_code", userId: user.id });
    await expect(
      consumeAuthExchangeCode({ db, pepper: env.SERVICE_TOKEN_PEPPER, code: exchange.code, verifier: "correct-verifier" })
    ).resolves.toBeNull();
  });

  it("exchanges code, fetches userinfo, and upserts linux do user through mocked fetch", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === env.LINUX_DO_OAUTH_TOKEN_URL) {
        expect(init?.method).toBe("POST");
        return Response.json({ access_token: "linuxdo-access-token" });
      }
      if (url === env.LINUX_DO_USERINFO_URL) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer linuxdo-access-token");
        return Response.json({ id: 10086, username: "alice", name: "Alice" });
      }
      return new Response("not found", { status: 404 });
    };

    const accessToken = await exchangeCodeForLinuxDoAccessToken({
      env,
      code: "code-1",
      callbackUrl: "https://worker.example/auth/callback/browser_code",
      codeVerifier: "verifier",
      fetcher
    });
    const info = await fetchLinuxDoUserInfo({ env, accessToken, fetcher });
    const user = await upsertLinuxDoUser(db, info);

    expect(calls).toEqual([env.LINUX_DO_OAUTH_TOKEN_URL, env.LINUX_DO_USERINFO_URL]);
    expect(user).toMatchObject({ linuxDoId: "10086" });
  });

  it("handles concurrent first Linux DO user upserts by returning one user", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        upsertLinuxDoUser(db, {
          id: "10088",
          username: `concurrent-${index}`,
          name: `Concurrent ${index}`
        })
      )
    );
    const rows = await db.select().from(users).where(eq(users.linuxDoId, "10088"));

    expect(new Set(results.map((result) => result.id))).toHaveLength(1);
    expect(results.every((result) => result.linuxDoId === "10088")).toBe(true);
    expect(rows).toHaveLength(1);
  });
});
