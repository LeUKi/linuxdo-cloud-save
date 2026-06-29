import type { WorkerEnv } from "../src/env";

export function testEnv(db: D1Database): WorkerEnv {
  return {
    DB: db,
    LINUX_DO_CLIENT_ID: "linuxdo-client-id",
    LINUX_DO_CLIENT_SECRET: "linuxdo-client-secret",
    SERVICE_TOKEN_PEPPER: "test-pepper-with-enough-entropy",
    SERVICE_TOKEN_ENCRYPTION_KEY: "test-encryption-key-with-enough-entropy",
    JWT_SIGNING_SECRET: "test-jwt-signing-secret-with-enough-entropy",
    SERVICE_ISSUER: "ld-save-worker-test",
    LINUX_DO_OAUTH_AUTHORIZE_URL: "https://connect.linux.do/oauth2/authorize",
    LINUX_DO_OAUTH_TOKEN_URL: "https://connect.linux.do/oauth2/token",
    LINUX_DO_USERINFO_URL: "https://connect.linux.do/api/user"
  };
}
