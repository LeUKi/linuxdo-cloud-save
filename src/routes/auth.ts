import { Hono } from "hono";
import { getAppConfig } from "../config/apps";
import { createDb } from "../db/client";
import type { AppBindings } from "../env";
import { HttpError, jsonError, toHttpError } from "../http/errors";
import { issueServiceToken } from "../auth/service-tokens";
import {
  consumeOAuthState,
  createOAuthState,
  exchangeCodeForLinuxDoAccessToken,
  fetchLinuxDoUserInfo,
  upsertLinuxDoUser
} from "../auth/oauth";
import { appendQueryParams, validateRedirectUri } from "../utils/redirect";

export const authRoutes = new Hono<AppBindings>();

authRoutes.get("/start", async (c) => {
  try {
    const appId = c.req.query("app");
    const redirectUri = c.req.query("redirect_uri");
    if (!appId || !redirectUri) throw new HttpError(400, "invalid_request", "Missing app or redirect_uri.");

    const app = getAppConfig(appId);
    if (!app) throw new HttpError(400, "unknown_app", "Unknown app.");

    const redirect = validateRedirectUri(app, redirectUri);
    if (!redirect.ok) throw new HttpError(400, "invalid_redirect_uri", "Redirect URI is not allowed.");

    const db = createDb(c.env.DB);
    const callbackUrl = new URL("/auth/callback", c.req.url).toString();
    const state = await createOAuthState({ db, env: c.env, app, redirectUri, callbackUrl });
    return c.redirect(state.authorizeUrl, 302);
  } catch (error) {
    return jsonError(c, toHttpError(error));
  }
});

authRoutes.get("/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) throw new HttpError(400, "invalid_request", "Missing code or state.");

    const db = createDb(c.env.DB);
    const consumed = await consumeOAuthState({ db, state });
    if (!consumed) throw new HttpError(400, "invalid_state", "OAuth state is invalid, consumed, or expired.");

    const app = getAppConfig(consumed.appId);
    if (!app) throw new HttpError(400, "unknown_app", "Unknown app.");
    const redirect = validateRedirectUri(app, consumed.redirectUri);
    if (!redirect.ok) throw new HttpError(400, "invalid_redirect_uri", "Redirect URI is not allowed.");

    const callbackUrl = new URL("/auth/callback", c.req.url).toString();
    const accessToken = await exchangeCodeForLinuxDoAccessToken({
      env: c.env,
      code,
      callbackUrl,
      codeVerifier: consumed.codeVerifier
    });
    const linuxDoUser = await fetchLinuxDoUserInfo({ env: c.env, accessToken });
    const user = await upsertLinuxDoUser(db, linuxDoUser);
    const serviceToken = await issueServiceToken({ db, env: c.env, app, userId: user.id, linuxDoId: user.linuxDoId });

    return c.redirect(
      appendQueryParams(redirect.url, {
        token: serviceToken.token,
        token_type: serviceToken.tokenType,
        token_kind: serviceToken.tokenKind,
        app: app.id,
        linux_do_id: user.linuxDoId
      }),
      302
    );
  } catch (error) {
    return jsonError(c, toHttpError(error));
  }
});
