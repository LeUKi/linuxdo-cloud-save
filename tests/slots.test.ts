import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { getAppConfig } from "../src/config/apps";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { issueServiceToken } from "../src/auth/service-tokens";
import { migratedDb } from "./d1";
import { testEnv } from "./env";

async function setupToken(appId: string) {
  const d1 = await migratedDb();
  const env = testEnv(d1);
  const db = createDb(d1);
  await db.insert(users).values({ linuxDoId: "10086", username: "alice" });
  const user = await db.query.users.findFirst();
  const appConfig = getAppConfig(appId);
  if (!user || !appConfig) throw new Error("test setup failed");
  const token = await issueServiceToken({ db, env, app: appConfig, userId: user.id, linuxDoId: user.linuxDoId });
  return { env, token: token.token };
}

describe("slot api", () => {
  it("writes and reads object-only JSON with last-write-wins version metadata", async () => {
    const { env, token } = await setupToken("sample-notes");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const first = await app.request("/api/apps/sample-notes/slots/main", {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: 1 })
    }, env);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ app: "sample-notes", slot: "main", data: { value: 1 }, version: 1 });

    const second = await app.request("/api/apps/sample-notes/slots/main", {
      method: "PUT",
      headers,
      body: JSON.stringify({ value: 2 })
    }, env);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ data: { value: 2 }, version: 2 });

    const read = await app.request("/api/apps/sample-notes/slots/main", { headers }, env);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ found: true, data: { value: 2 }, version: 2 });
  });

  it("rejects missing bearer, wrong app, unknown slot, and non-object JSON", async () => {
    const { env, token } = await setupToken("sample-notes");

    expect((await app.request("/api/apps/sample-notes/slots/main", {}, env)).status).toBe(401);
    expect(
      (await app.request("/api/apps/sample-game/slots/profile", { headers: { authorization: `Bearer ${token}` } }, env)).status
    ).toBe(401);
    expect(
      (await app.request("/api/apps/sample-notes/slots/missing", { headers: { authorization: `Bearer ${token}` } }, env)).status
    ).toBe(404);

    const invalid = await app.request("/api/apps/sample-notes/slots/main", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(["not", "object"])
    }, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_json_shape" } });
  });
});
