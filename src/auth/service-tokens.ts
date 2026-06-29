import { eq } from "drizzle-orm";
import type { AppConfig } from "../config/apps";
import type { AppDb } from "../db/client";
import { users } from "../db/schema";
import type { WorkerEnv } from "../env";
import { issueServiceJwt, verifyServiceJwt } from "./jwt";
import { issueOrReuseOpaqueToken, validateOpaqueToken } from "./opaque";

export interface AuthenticatedPrincipal {
  userId: number;
  linuxDoId: string;
  appId: string;
  tokenKind: "opaque_reuse" | "jwt";
}

export async function issueServiceToken(options: {
  db: AppDb;
  env: WorkerEnv;
  app: AppConfig;
  userId: number;
  linuxDoId: string;
}): Promise<{ token: string; tokenType: "Bearer"; tokenKind: "opaque_reuse" | "jwt"; reused?: boolean }> {
  if (options.app.tokenStrategy === "opaque_reuse") {
    const result = await issueOrReuseOpaqueToken({
      db: options.db,
      userId: options.userId,
      appId: options.app.id,
      pepper: options.env.SERVICE_TOKEN_PEPPER,
      encryptionKey: options.env.SERVICE_TOKEN_ENCRYPTION_KEY
    });
    return { token: result.token, tokenType: "Bearer", tokenKind: "opaque_reuse", reused: result.reused };
  }

  return {
    token: await issueServiceJwt({
      secret: options.env.JWT_SIGNING_SECRET,
      issuer: options.env.SERVICE_ISSUER,
      userId: options.userId,
      linuxDoId: options.linuxDoId,
      appId: options.app.id
    }),
    tokenType: "Bearer",
    tokenKind: "jwt"
  };
}

export async function authenticateBearerToken(options: {
  db: AppDb;
  env: WorkerEnv;
  token: string;
  appId: string;
}): Promise<AuthenticatedPrincipal | null> {
  const opaque = await validateOpaqueToken({
    db: options.db,
    token: options.token,
    pepper: options.env.SERVICE_TOKEN_PEPPER,
    appId: options.appId
  });
  if (opaque) {
    return { ...opaque, tokenKind: "opaque_reuse" };
  }

  try {
    const claims = await verifyServiceJwt({
      token: options.token,
      secret: options.env.JWT_SIGNING_SECRET,
      issuer: options.env.SERVICE_ISSUER,
      appId: options.appId
    });
    const user = await options.db.query.users.findFirst({ where: eq(users.id, claims.userId) });
    if (!user || user.linuxDoId !== claims.linux_do_id) return null;
    return { userId: user.id, linuxDoId: user.linuxDoId, appId: claims.app, tokenKind: "jwt" };
  } catch {
    return null;
  }
}

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}
