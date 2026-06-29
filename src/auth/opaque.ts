import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { serviceTokens, users } from "../db/schema";
import { createId, createOpaqueToken, decryptString, encryptString, hmacSha256Base64Url } from "../utils/crypto";
import { nowIso } from "../utils/time";

export interface OpaqueIssueResult {
  token: string;
  tokenId: string;
  reused: boolean;
}

export async function hashOpaqueToken(pepper: string, token: string): Promise<string> {
  return hmacSha256Base64Url(pepper, token);
}

async function findActiveOpaqueToken(options: {
  db: AppDb;
  userId: number;
  appId: string;
  encryptionKey: string;
}): Promise<OpaqueIssueResult | null> {
  const existing = await options.db.query.serviceTokens.findFirst({
    where: and(
      eq(serviceTokens.userId, options.userId),
      eq(serviceTokens.appId, options.appId),
      eq(serviceTokens.tokenStrategy, "opaque_reuse"),
      isNull(serviceTokens.revokedAt)
    )
  });

  if (!existing?.encryptedToken) return null;

  return {
    token: await decryptString(options.encryptionKey, existing.encryptedToken),
    tokenId: existing.id,
    reused: true
  };
}

export async function issueOrReuseOpaqueToken(options: {
  db: AppDb;
  userId: number;
  appId: string;
  pepper: string;
  encryptionKey: string;
}): Promise<OpaqueIssueResult> {
  const existing = await findActiveOpaqueToken(options);
  if (existing) return existing;

  const token = createOpaqueToken();
  const tokenId = createId("tok");
  const now = nowIso();
  const record = await options.db
    .insert(serviceTokens)
    .values({
      id: tokenId,
      userId: options.userId,
      appId: options.appId,
      tokenStrategy: "opaque_reuse",
      tokenHash: await hashOpaqueToken(options.pepper, token),
      encryptedToken: await encryptString(options.encryptionKey, token),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [serviceTokens.userId, serviceTokens.appId],
      targetWhere: sql`revoked_at IS NULL AND token_strategy = 'opaque_reuse'`,
      set: {
        updatedAt: sql`${serviceTokens.updatedAt}`
      }
    })
    .returning({
      id: serviceTokens.id,
      encryptedToken: serviceTokens.encryptedToken
    })
    .get();

  if (record?.id && record.id !== tokenId && record.encryptedToken) {
    return {
      token: await decryptString(options.encryptionKey, record.encryptedToken),
      tokenId: record.id,
      reused: true
    };
  }

  if (record?.id && record.id !== tokenId) {
    throw new Error("Active opaque token record is missing encrypted token.");
  }

  return { token, tokenId, reused: false };
}

export async function validateOpaqueToken(options: {
  db: AppDb;
  token: string;
  pepper: string;
  appId?: string;
}): Promise<{ userId: number; linuxDoId: string; appId: string; tokenId: string } | null> {
  const tokenHash = await hashOpaqueToken(options.pepper, options.token);
  const record = await options.db
    .select({
      tokenId: serviceTokens.id,
      userId: serviceTokens.userId,
      appId: serviceTokens.appId,
      linuxDoId: users.linuxDoId
    })
    .from(serviceTokens)
    .innerJoin(users, eq(users.id, serviceTokens.userId))
    .where(and(eq(serviceTokens.tokenHash, tokenHash), eq(serviceTokens.tokenStrategy, "opaque_reuse"), isNull(serviceTokens.revokedAt)))
    .get();

  if (!record) return null;
  if (options.appId && record.appId !== options.appId) return null;

  await options.db.update(serviceTokens).set({ lastUsedAt: nowIso() }).where(eq(serviceTokens.id, record.tokenId));
  return record;
}
