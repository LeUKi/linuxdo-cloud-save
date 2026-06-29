import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { getAppConfig } from "../src/config/apps";
import { issueServiceToken } from "../src/auth/service-tokens";
import { createDb } from "../src/db/client";
import { publicSlots, saveSlots, users } from "../src/db/schema";
import { migratedDb } from "./d1";
import { testEnv } from "./env";

const NOTES_PUBLIC_KEY = "sample-notes-public-write-key";
const GAME_PUBLIC_KEY = "sample-game-public-write-key";

async function setupEnv() {
  const d1 = await migratedDb();
  const env = testEnv(d1);
  return { d1, env, db: createDb(d1) };
}

async function setupBearerToken(appId: string) {
  const { env, db } = await setupEnv();
  await db.insert(users).values({ linuxDoId: "public-test-user", username: "alice" });
  const user = await db.query.users.findFirst();
  const appConfig = getAppConfig(appId);
  if (!user || !appConfig) throw new Error("test setup failed");
  const flow = appConfig.authFlows[0];
  if (!flow) throw new Error("test setup failed");
  const token = await issueServiceToken({
    db,
    env,
    app: appConfig,
    tokenStrategy: flow.tokenStrategy,
    userId: user.id,
    linuxDoId: user.linuxDoId
  });
  return { env, token: token.token };
}

describe("public slot api", () => {
  it("reads missing and existing public slots without bearer", async () => {
    const { env } = await setupEnv();

    const missing = await app.request("/api/apps/sample-notes/public/news", {}, env);
    expect(missing.status).toBe(200);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.json()).toMatchObject({
      found: false,
      app: "sample-notes",
      slot: "public:news",
      data: null,
      version: 0,
      updatedAt: null
    });

    const write = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ headline: "hello" })
    }, env);
    expect(write.status).toBe(200);

    const read = await app.request("/api/apps/sample-notes/public/news", {}, env);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.json()).toMatchObject({
      found: true,
      app: "sample-notes",
      slot: "public:news",
      data: { headline: "hello" },
      version: 1
    });
  });

  it("ignores invalid bearer headers on public reads", async () => {
    const { env } = await setupEnv();
    const response = await app.request("/api/apps/sample-notes/public/news", {
      headers: { authorization: "Bearer not-a-real-token" }
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ found: false, app: "sample-notes", slot: "public:news" });
  });

  it("writes public slots only with the matching app key and increments version", async () => {
    const { env } = await setupEnv();

    const missingKey = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 })
    }, env);
    expect(missingKey.status).toBe(401);
    expect(await missingKey.json()).toMatchObject({ error: { code: "missing_public_write_key" } });

    const wrongKey = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": GAME_PUBLIC_KEY },
      body: JSON.stringify({ value: 1 })
    }, env);
    expect(wrongKey.status).toBe(403);
    expect(await wrongKey.json()).toMatchObject({ error: { code: "invalid_public_write_key" } });

    const first = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: 1 })
    }, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toMatchObject({ app: "sample-notes", slot: "public:news", data: { value: 1 }, version: 1 });

    const second = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: 2 })
    }, env);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ data: { value: 2 }, version: 2 });

    const crossApp = await app.request("/api/apps/sample-game/public/leaderboard", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: 3 })
    }, env);
    expect(crossApp.status).toBe(403);
    expect(await crossApp.json()).toMatchObject({ error: { code: "invalid_public_write_key" } });
  });

  it("rejects unknown or malformed public slots and non-object payloads", async () => {
    const { env } = await setupEnv();

    expect((await app.request("/api/apps/missing-app/public/news", {}, env)).status).toBe(404);
    const unknownAppWrite = await app.request("/api/apps/missing-app/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: true })
    }, env);
    expect(unknownAppWrite.status).toBe(404);
    expect(await unknownAppWrite.json()).toMatchObject({ error: { code: "unknown_app" } });

    expect((await app.request("/api/apps/sample-notes/public/missing", {}, env)).status).toBe(404);
    const unknownWrite = await app.request("/api/apps/sample-notes/public/missing", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: true })
    }, env);
    expect(unknownWrite.status).toBe(404);

    const malformed = await app.request("/api/apps/sample-notes/public/public:news", {}, env);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_public_slot" } });

    const invalid = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify(["not", "object"])
    }, env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_json_shape" } });

    const oversized = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ value: "x".repeat(70 * 1024) })
    }, env);
    expect(oversized.status).toBe(413);
  });

  it("keeps public and private slot boundaries separate", async () => {
    const { env, db } = await setupEnv();
    const publicWrite = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-public-write-key": NOTES_PUBLIC_KEY },
      body: JSON.stringify({ public: true })
    }, env);
    expect(publicWrite.status).toBe(200);

    expect((await app.request("/api/apps/sample-notes/slots/main", {}, env)).status).toBe(401);
    expect(
      (await app.request("/api/apps/sample-notes/slots/main", { headers: { "x-public-write-key": NOTES_PUBLIC_KEY } }, env)).status
    ).toBe(401);
    expect((await app.request("/api/apps/sample-notes/slots/public:news", {}, env)).status).toBe(404);

    const privateRows = await db.query.saveSlots.findMany({
      where: and(eq(saveSlots.appId, "sample-notes"), eq(saveSlots.slotId, "public:news"))
    });
    expect(privateRows).toEqual([]);

    const publicRow = await db.query.publicSlots.findFirst({
      where: and(eq(publicSlots.appId, "sample-notes"), eq(publicSlots.slotId, "public:news"))
    });
    expect(publicRow).toBeDefined();
  });

  it("does not let bearer auth alone write public slots", async () => {
    const { env, token } = await setupBearerToken("sample-notes");
    const response = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ value: true })
    }, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "missing_public_write_key" } });
  });

  it("does not write private data into public slots", async () => {
    const { env, token } = await setupBearerToken("sample-notes");
    const db = createDb(env.DB);

    const privateWrite = await app.request("/api/apps/sample-notes/slots/main", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ private: true })
    }, env);
    expect(privateWrite.status).toBe(200);

    const publicRows = await db.query.publicSlots.findMany({
      where: and(eq(publicSlots.appId, "sample-notes"), eq(publicSlots.slotId, "main"))
    });
    expect(publicRows).toEqual([]);
  });

  it("does not accept public write keys from query params or JSON body", async () => {
    const { env } = await setupEnv();
    const queryKey = await app.request(`/api/apps/sample-notes/public/news?public_write_key=${NOTES_PUBLIC_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "query" })
    }, env);
    expect(queryKey.status).toBe(401);
    expect(await queryKey.json()).toMatchObject({ error: { code: "missing_public_write_key" } });

    const bodyKey = await app.request("/api/apps/sample-notes/public/news", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "body", publicWriteKey: NOTES_PUBLIC_KEY })
    }, env);
    expect(bodyKey.status).toBe(401);
    expect(await bodyKey.json()).toMatchObject({ error: { code: "missing_public_write_key" } });
  });
});
