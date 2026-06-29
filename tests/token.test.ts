import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { SignJWT } from "jose";
import { issueServiceJwt, verifyServiceJwt } from "../src/auth/jwt";
import { issueOrReuseOpaqueToken, validateOpaqueToken } from "../src/auth/opaque";
import { serviceTokens, users } from "../src/db/schema";
import { testEnv } from "./env";
import { migratedDb } from "./d1";

describe("service token strategies", () => {
  it("issues and verifies long-lived JWTs without an exp claim", async () => {
    const token = await issueServiceJwt({
      secret: "jwt-secret",
      issuer: "issuer",
      userId: 42,
      linuxDoId: "10086",
      appId: "sample-game"
    });

    const claims = await verifyServiceJwt({ token, secret: "jwt-secret", issuer: "issuer", appId: "sample-game" });
    expect(claims).toMatchObject({ sub: "42", userId: 42, app: "sample-game", linux_do_id: "10086" });
  });

  it("rejects JWTs with a non-numeric subject", async () => {
    const token = await new SignJWT({ app: "sample-game", linux_do_id: "10086" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("issuer")
      .setSubject("not-a-user-id")
      .setJti("jwt_test")
      .setIssuedAt()
      .sign(new TextEncoder().encode("jwt-secret"));

    await expect(verifyServiceJwt({ token, secret: "jwt-secret", issuer: "issuer", appId: "sample-game" })).rejects.toThrow(
      "Invalid JWT subject."
    );
  });

  it("reuses the same opaque token for an active user/app token record", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    await db.insert(users).values({ linuxDoId: "10086", username: "alice" });
    const user = await db.query.users.findFirst();
    expect(user).toBeDefined();
    if (!user) return;

    const first = await issueOrReuseOpaqueToken({
      db,
      userId: user.id,
      appId: "sample-notes",
      pepper: env.SERVICE_TOKEN_PEPPER,
      encryptionKey: env.SERVICE_TOKEN_ENCRYPTION_KEY
    });
    const second = await issueOrReuseOpaqueToken({
      db,
      userId: user.id,
      appId: "sample-notes",
      pepper: env.SERVICE_TOKEN_PEPPER,
      encryptionKey: env.SERVICE_TOKEN_ENCRYPTION_KEY
    });

    expect(second.reused).toBe(true);
    expect(second.token).toBe(first.token);

    const principal = await validateOpaqueToken({
      db,
      token: first.token,
      pepper: env.SERVICE_TOKEN_PEPPER,
      appId: "sample-notes"
    });
    expect(principal).toMatchObject({ userId: user.id, linuxDoId: "10086", appId: "sample-notes" });
  });

  it("handles concurrent first opaque token issuance by reusing one active token", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    await db.insert(users).values({ linuxDoId: "10087", username: "bob" });
    const user = await db.query.users.findFirst();
    expect(user).toBeDefined();
    if (!user) return;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        issueOrReuseOpaqueToken({
          db,
          userId: user.id,
          appId: "sample-notes",
          pepper: env.SERVICE_TOKEN_PEPPER,
          encryptionKey: env.SERVICE_TOKEN_ENCRYPTION_KEY
        })
      )
    );

    expect(new Set(attempts.map((attempt) => attempt.token))).toHaveLength(1);
    expect(new Set(attempts.map((attempt) => attempt.tokenId))).toHaveLength(1);
    expect(attempts.some((attempt) => !attempt.reused)).toBe(true);
    expect(attempts.some((attempt) => attempt.reused)).toBe(true);
  });

  it("rejects malformed active opaque rows instead of returning an unpersisted token", async () => {
    const d1 = await migratedDb();
    const db = createDb(d1);
    const env = testEnv(d1);
    await db.insert(users).values({ linuxDoId: "10089", username: "carol" });
    const user = await db.query.users.findFirst();
    expect(user).toBeDefined();
    if (!user) return;

    await db.insert(serviceTokens).values({
      id: "tok_malformed",
      userId: user.id,
      appId: "sample-notes",
      tokenStrategy: "opaque_reuse",
      tokenHash: null,
      encryptedToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await expect(
      issueOrReuseOpaqueToken({
        db,
        userId: user.id,
        appId: "sample-notes",
        pepper: env.SERVICE_TOKEN_PEPPER,
        encryptionKey: env.SERVICE_TOKEN_ENCRYPTION_KEY
      })
    ).rejects.toThrow("Active opaque token record is missing encrypted token.");
  });
});
