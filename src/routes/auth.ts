import { Hono } from "hono";
import type { Context } from "hono";
import { getAppConfig, getAuthFlowConfig } from "../config/apps";
import { createDb } from "../db/client";
import type { AppBindings } from "../env";
import { HttpError, jsonError, toHttpError } from "../http/errors";
import { readJsonObject } from "../http/json";
import { issueServiceToken } from "../auth/service-tokens";
import {
  consumeAuthExchangeCode,
  consumeOAuthState,
  createAuthExchangeCode,
  createOAuthState,
  exchangeCodeForLinuxDoAccessToken,
  fetchLinuxDoUserInfo,
  upsertLinuxDoUser
} from "../auth/oauth";

export const authRoutes = new Hono<AppBindings>();

const MAX_EXCHANGE_BODY_BYTES = 4 * 1024;
const S256_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function authHtml(code: string): string {
  const escapedCode = escapeHtml(code);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="cloud-save-exchange-code" content="${escapedCode}">
    <title>linuxdo-cloud-save auth complete</title>
  </head>
  <body>
    <main data-cloud-save-exchange-code="${escapedCode}"></main>
    <script type="application/json" id="cloud-save-auth-code">{"code":"${escapedCode}"}</script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function secureHtml(c: Context<AppBindings>, code: string) {
  return noStore(
    c.html(authHtml(code), 200, {
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    })
  );
}

authRoutes.get("/start", async (c) => {
  try {
    const appId = c.req.query("app");
    const flowId = c.req.query("flow");
    const challenge = c.req.query("challenge");
    if (!appId) throw new HttpError(400, "invalid_request", "Missing app.");
    if (!flowId) throw new HttpError(400, "invalid_request", "Missing flow.");
    if (c.req.query("redirect_uri")) throw new HttpError(400, "invalid_request", "redirect_uri is not supported by this auth flow.");

    const app = getAppConfig(appId);
    if (!app) throw new HttpError(400, "unknown_app", "Unknown app.");
    const flow = getAuthFlowConfig(app, flowId);
    if (!flow) throw new HttpError(400, "unknown_flow", "Unknown auth flow.");
    if (!challenge || !S256_CHALLENGE_PATTERN.test(challenge)) {
      throw new HttpError(400, "invalid_challenge", "Missing or invalid challenge.");
    }

    const db = createDb(c.env.DB);
    const callbackUrl = new URL(flow.oauthCallbackPath, c.req.url).toString();
    const state = await createOAuthState({ db, env: c.env, app, flow, exchangeChallenge: challenge, callbackUrl });
    return c.redirect(state.authorizeUrl, 302);
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});

authRoutes.get("/callback/:flowId", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const flowId = c.req.param("flowId");
    if (!code || !state) throw new HttpError(400, "invalid_request", "Missing code or state.");

    const db = createDb(c.env.DB);
    const consumed = await consumeOAuthState({ db, state, flowId });
    if (!consumed) throw new HttpError(400, "invalid_state", "OAuth state is invalid, consumed, or expired.");

    const app = getAppConfig(consumed.appId);
    if (!app) throw new HttpError(400, "unknown_app", "Unknown app.");
    const flow = getAuthFlowConfig(app, consumed.flowId);
    if (!flow) throw new HttpError(400, "unknown_flow", "Unknown auth flow.");

    const callbackUrl = new URL(flow.oauthCallbackPath, c.req.url).toString();
    const accessToken = await exchangeCodeForLinuxDoAccessToken({
      env: c.env,
      code,
      callbackUrl,
      codeVerifier: consumed.codeVerifier
    });
    const linuxDoUser = await fetchLinuxDoUserInfo({ env: c.env, accessToken });
    const user = await upsertLinuxDoUser(db, linuxDoUser);
    const exchange = await createAuthExchangeCode({
      db,
      pepper: c.env.SERVICE_TOKEN_PEPPER,
      appId: app.id,
      flowId: flow.id,
      userId: user.id,
      exchangeChallenge: consumed.exchangeChallenge,
      ttlSeconds: flow.delivery.codeTtlSeconds
    });

    const completionUrl = new URL(flow.completionPath, c.req.url);
    completionUrl.searchParams.set("code", exchange.code);
    completionUrl.searchParams.set("app", app.id);
    completionUrl.searchParams.set("flow", flow.id);
    return c.redirect(completionUrl.toString(), 302);
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});

authRoutes.get("/complete/:flowId", async (c) => {
  try {
    const code = c.req.query("code");
    if (!code) throw new HttpError(400, "invalid_request", "Missing code.");
    return secureHtml(c, code);
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});

authRoutes.post("/exchange", async (c) => {
  try {
    const body = await readJsonObject(c.req.raw, MAX_EXCHANGE_BODY_BYTES);
    const code = body.code;
    const verifier = body.verifier;
    if (typeof code !== "string" || !code) throw new HttpError(400, "invalid_request", "Missing code.");
    if (typeof verifier !== "string" || !verifier) throw new HttpError(400, "invalid_request", "Missing verifier.");

    const db = createDb(c.env.DB);
    const consumed = await consumeAuthExchangeCode({ db, pepper: c.env.SERVICE_TOKEN_PEPPER, code, verifier });
    if (!consumed) throw new HttpError(400, "invalid_exchange_code", "Exchange code is invalid, consumed, expired, or verifier mismatched.");

    const app = getAppConfig(consumed.appId);
    if (!app) throw new HttpError(400, "unknown_app", "Unknown app.");
    const flow = getAuthFlowConfig(app, consumed.flowId);
    if (!flow) throw new HttpError(400, "unknown_flow", "Unknown auth flow.");

    const user = await db.query.users.findFirst({ where: (users, { eq }) => eq(users.id, consumed.userId) });
    if (!user) throw new HttpError(400, "unknown_user", "Unknown user.");

    const serviceToken = await issueServiceToken({
      db,
      env: c.env,
      app,
      tokenStrategy: flow.tokenStrategy,
      userId: user.id,
      linuxDoId: user.linuxDoId
    });

    return noStore(
      c.json({
        token: serviceToken.token,
        token_type: serviceToken.tokenType,
        token_kind: serviceToken.tokenKind,
        app: app.id,
        linux_do_id: user.linuxDoId
      })
    );
  } catch (error) {
    return noStore(jsonError(c, toHttpError(error)));
  }
});
