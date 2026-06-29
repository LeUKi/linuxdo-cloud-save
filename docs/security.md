# Security Notes

This service is intentionally scoped for the author's own programs, not a public developer platform.

## Trust Boundary

Local apps are not confidential clients. Private save-slot authority is the Worker-issued Bearer token, validated server-side. Public write authority is a separate per-app write key that can only write configured public slots. App ids, auth flows, private slot ids, public slot ids, payload limits, token strategy, and public write-key digests are hardcoded in source.

## Token Strategies

`opaque_reuse`:

- Generates one high-entropy random token per `user + app`.
- Stores an HMAC hash for lookup.
- Stores AES-GCM encrypted raw token only so repeated OAuth login can return the same token.
- Enforces one active opaque token per `user + app` with a D1 partial unique index.
- Can be revoked by setting `revoked_at`.

`jwt`:

- Issues long-lived HS256 JWTs with `sub`, `app`, `linux_do_id`, and `jti`.
- Does not use short expiry in the first pass.
- Does not perform normal per-request D1 revocation checks.
- Coarse revocation is signing-secret rotation unless a future blacklist or token-version check is added.

## Code Exchange Delivery

The configured `code_exchange` flow never puts the long-term Bearer token in the callback URL. The callback path creates a short-lived one-time exchange code and redirects to a Worker-owned completion page with that code. The client then calls `POST /auth/exchange` with the code and a locally held verifier.

Controls in this implementation:

- Auth behavior is selected only by hardcoded per-app `authFlows`.
- `/auth/start` requires an app id, flow id, and client challenge.
- `/auth/start` does not accept caller-supplied `redirect_uri`.
- The exchange code is stored as an HMAC hash, not plaintext.
- The exchange code is short TTL and one-time.
- Wrong verifier attempts do not consume a valid code.
- Long-term service tokens are issued only after successful `/auth/exchange`.
- Error responses do not include raw tokens.
- Redaction helpers cover `Authorization` headers, `X-Public-Write-Key` headers, and token-like URL query params including short-lived codes.

## Public Slots

Public slots are for data that the author's programs intentionally expose to anyone who knows the route.

- Public reads are unauthenticated by design.
- Public data is global per app and is not associated with a Linux DO user.
- Public data lives in the separate `public_slots` table, not `save_slots`.
- Public writes require `X-Public-Write-Key`.
- Public write keys are not Bearer tokens and must not authorize private save-slot APIs.
- Public write keys are checked against hardcoded SHA-256 digests in app config.
- Public read and write responses use `Cache-Control: no-store` in the first pass.

If a public write key is embedded in a local program, it can be extracted. The first-pass mitigation is app-scoped damage and manual key rotation: change the raw key, update the hardcoded digest, redeploy the Worker, and ship updated clients.

## Secrets

Never hardcode these in source:

- Linux DO client secret
- opaque token HMAC pepper
- opaque token encryption key
- JWT signing secret
- raw production public write keys

Use `wrangler secret put` for production.
