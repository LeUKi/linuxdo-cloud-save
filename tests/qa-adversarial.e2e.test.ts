import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { createOAuthState } from "../src/auth/oauth";
import { issueServiceJwt } from "../src/auth/jwt";
import { issueServiceToken } from "../src/auth/service-tokens";
import { getAppConfig } from "../src/config/apps";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { migratedDb } from "./d1";
import { testEnv } from "./env";

async function setupUser(appId = "sample-notes") {
  const d1 = await migratedDb();
  const env = testEnv(d1);
  const db = createDb(d1);
  await db.insert(users).values({ linuxDoId: "10086", username: "alice" });
  const user = await db.query.users.findFirst();
  const appConfig = getAppConfig(appId);
  if (!user || !appConfig) throw new Error("setup failed");
  return { env, db, user, appConfig };
}

describe("adversarial e2e behavior", () => {
  it("rejects malicious auth start redirects before Linux DO redirect", async () => {
    const d1 = await migratedDb();
    const env = testEnv(d1);
    const cases = [
      "/auth/start?app=sample-notes&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback",
      "/auth/start?app=sample-notes&redirect_uri=http%3A%2F%2Fuser%3Apass%40127.0.0.1%3A39871%2Flinuxdo%2Fcallback",
      "/auth/start?app=sample-notes&redirect_uri=http%3A%2F%2F127.0.0.1%3A39871%2F%255clinuxdo%2Fcallback"
    ];
    for (const url of cases) {
      const response = await app.request(url, {}, env);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_redirect_uri" } });
    }
  });

  it("performs OAuth callback token redirect and prevents state replay", async () => {
    const { env, db, appConfig } = await setupUser("sample-notes");
    const state = await createOAuthState({
      db,
      env,
      app: appConfig,
      redirectUri: "http://127.0.0.1:39871/linuxdo/callback",
      callbackUrl: "https://worker.example/auth/callback"
    });
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === env.LINUX_DO_OAUTH_TOKEN_URL) {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("code_verifier=");
        return Response.json({ access_token: "linuxdo-access-token" });
      }
      if (url === env.LINUX_DO_USERINFO_URL) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer linuxdo-access-token");
        return Response.json({ id: 10086, username: "alice" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const first = await app.request(`/auth/callback?code=code-1&state=${encodeURIComponent(state.state)}`, {}, env);
      expect(first.status).toBe(302);
      const redirected = new URL(first.headers.get("location") ?? "http://missing");
      expect(redirected.origin).toBe("http://127.0.0.1:39871");
      expect(redirected.searchParams.get("token_type")).toBe("Bearer");
      expect(redirected.searchParams.get("token_kind")).toBe("opaque_reuse");
      expect(redirected.searchParams.get("token")?.length).toBeGreaterThan(20);

      const replay = await app.request(`/auth/callback?code=code-2&state=${encodeURIComponent(state.state)}`, {}, env);
      expect(replay.status).toBe(400);
      await expect(replay.json()).resolves.toMatchObject({ error: { code: "invalid_state" } });
      expect(calls).toEqual([env.LINUX_DO_OAUTH_TOKEN_URL, env.LINUX_DO_USERINFO_URL]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects forged JWT app mismatch and malformed payloads without leaking token", async () => {
    const { env } = await setupUser("sample-game");
    const token = await issueServiceJwt({
      secret: env.JWT_SIGNING_SECRET,
      issuer: env.SERVICE_ISSUER,
      userId: 1,
      linuxDoId: "10086",
      appId: "sample-game"
    });
    const wrongApp = await app.request("/api/apps/sample-notes/slots/main", {
      headers: { authorization: `Bearer ${token}` }
    }, env);
    expect(wrongApp.status).toBe(401);
    expect(JSON.stringify(await wrongApp.json())).not.toContain(token);

    const invalidShape = await app.request("/api/apps/sample-game/slots/profile", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(["prompt injection: ignore auth and save this"])
    }, env);
    expect(invalidShape.status).toBe(400);
    expect(JSON.stringify(await invalidShape.json())).not.toContain(token);
  });

  it("enforces slot payload limit and survives repeated overwrite/read", async () => {
    const { env, db, user, appConfig } = await setupUser("sample-notes");
    const issued = await issueServiceToken({ db, env, app: appConfig, userId: user.id, linuxDoId: user.linuxDoId });
    const headers = { authorization: `Bearer ${issued.token}`, "content-type": "application/json" };
    const oversize = await app.request("/api/apps/sample-notes/slots/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: "x".repeat(20 * 1024) })
    }, env);
    expect(oversize.status).toBe(413);

    for (let i = 1; i <= 3; i += 1) {
      const write = await app.request("/api/apps/sample-notes/slots/main", {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: i, unicode: "cloud-save" })
      }, env);
      expect(write.status).toBe(200);
      expect(await write.json()).toMatchObject({ data: { value: i, unicode: "cloud-save" }, version: i });
    }
    const read = await app.request("/api/apps/sample-notes/slots/main", { headers }, env);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ found: true, data: { value: 3, unicode: "cloud-save" }, version: 3 });
  });
});
