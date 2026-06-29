import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { issueServiceJwt } from "../src/auth/jwt";
import { issueServiceToken } from "../src/auth/service-tokens";
import { getAppConfig } from "../src/config/apps";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { createPkceChallenge } from "../src/utils/pkce";
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
  it("rejects invalid auth start requests before Linux DO redirect", async () => {
    const d1 = await migratedDb();
    const env = testEnv(d1);
    const challenge = await createPkceChallenge("verifier");
    const cases = [
      "/auth/start?app=sample-notes",
      "/auth/start?app=sample-notes&flow=missing",
      "/auth/start?app=sample-notes&flow=browser_code",
      "/auth/start?app=sample-notes&flow=browser_code&challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      `/auth/start?app=sample-notes&flow=browser_code&challenge=${challenge}&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback`
    ];
    for (const url of cases) {
      const response = await app.request(url, {}, env);
      expect(response.status).toBe(400);
      const payload = await response.json() as { error: { code: string } };
      expect(payload.error.code).toMatch(/invalid_request|unknown_flow|invalid_challenge/u);
    }
  });

  it("performs verifier-bound code exchange and prevents state/code replay", async () => {
    const { env } = await setupUser("linuxdo-friends");
    const verifier = "correct-e2e-verifier";
    const challenge = await createPkceChallenge(verifier);
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
      const start = await app.request(`/auth/start?app=linuxdo-friends&flow=browser_code&challenge=${challenge}`, {}, env);
      expect(start.status).toBe(302);
      const authorizeUrl = new URL(start.headers.get("location") ?? "http://missing");
      const state = authorizeUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "http://missing").pathname).toBe(
        "/auth/callback/browser_code"
      );

      const callback = await app.request(`/auth/callback/browser_code?code=code-1&state=${encodeURIComponent(state ?? "")}`, {}, env);
      expect(callback.status).toBe(302);
      const completionUrl = new URL(callback.headers.get("location") ?? "http://missing");
      expect(completionUrl.pathname).toBe("/auth/complete/browser_code");
      const exchangeCode = completionUrl.searchParams.get("code");
      expect(exchangeCode).toBeTruthy();
      expect(completionUrl.searchParams.has("token")).toBe(false);

      const page = await app.request(completionUrl.pathname + completionUrl.search, {}, env);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      const html = await page.text();
      expect(html).toContain(exchangeCode ?? "missing");
      expect(html).not.toContain("Bearer");
      expect(html).not.toContain("token_type");

      const wrongVerifier = await app.request("/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: exchangeCode, verifier: "wrong-verifier" })
      }, env);
      expect(wrongVerifier.status).toBe(400);

      const exchanged = await app.request("/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: exchangeCode, verifier })
      }, env);
      expect(exchanged.status).toBe(200);
      expect(exchanged.headers.get("cache-control")).toBe("no-store");
      const tokenPayload = await exchanged.json() as Record<string, string>;
      expect(tokenPayload).toMatchObject({ token_type: "Bearer", token_kind: "jwt", app: "linuxdo-friends", linux_do_id: "10086" });
      expect(tokenPayload.token?.length).toBeGreaterThan(20);

      const codeReplay = await app.request("/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: exchangeCode, verifier })
      }, env);
      expect(codeReplay.status).toBe(400);

      const replay = await app.request(`/auth/callback/browser_code?code=code-2&state=${encodeURIComponent(state ?? "")}`, {}, env);
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
    const flow = appConfig.authFlows[0];
    if (!flow) throw new Error("setup failed");
    const issued = await issueServiceToken({
      db,
      env,
      app: appConfig,
      tokenStrategy: flow.tokenStrategy,
      userId: user.id,
      linuxDoId: user.linuxDoId
    });
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
