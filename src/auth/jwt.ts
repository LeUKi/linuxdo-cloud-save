import { jwtVerify, SignJWT } from "jose";
import { createId } from "../utils/crypto";

const ALG = "HS256";

export interface ServiceJwtClaims {
  sub: string;
  userId: number;
  app: string;
  linux_do_id: string;
  jti: string;
}

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueServiceJwt(options: {
  secret: string;
  issuer: string;
  userId: number;
  linuxDoId: string;
  appId: string;
}): Promise<string> {
  const jti = createId("jwt");
  return new SignJWT({ app: options.appId, linux_do_id: options.linuxDoId })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuer(options.issuer)
    .setSubject(String(options.userId))
    .setJti(jti)
    .setIssuedAt()
    .sign(signingKey(options.secret));
}

export async function verifyServiceJwt(options: {
  token: string;
  secret: string;
  issuer: string;
  appId?: string;
}): Promise<ServiceJwtClaims> {
  const { payload, protectedHeader } = await jwtVerify(options.token, signingKey(options.secret), {
    issuer: options.issuer,
    algorithms: [ALG]
  });

  if (protectedHeader.alg !== ALG) throw new Error("Unexpected JWT algorithm.");
  if (typeof payload.sub !== "string") throw new Error("Missing JWT subject.");
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0 || String(userId) !== payload.sub) {
    throw new Error("Invalid JWT subject.");
  }
  if (typeof payload.app !== "string") throw new Error("Missing JWT app.");
  if (typeof payload.linux_do_id !== "string") throw new Error("Missing JWT linux_do_id.");
  if (typeof payload.jti !== "string") throw new Error("Missing JWT id.");
  if (options.appId && payload.app !== options.appId) throw new Error("JWT app mismatch.");

  return {
    sub: payload.sub,
    userId,
    app: payload.app,
    linux_do_id: payload.linux_do_id,
    jti: payload.jti
  };
}
