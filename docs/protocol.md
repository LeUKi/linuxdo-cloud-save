# Protocol

## Login

1. Client generates a high-entropy local `verifier` and computes:

   ```text
   challenge = base64url(sha256(verifier))
   ```

2. Client opens:

   ```text
   https://<worker>/auth/start?app=<appId>&flow=<flowId>&challenge=<challenge>
   ```

3. Worker validates `app` and `flow` against hardcoded config and stores the client `challenge` in one-time OAuth state.
4. Worker redirects to Linux DO Connect authorize URL using the configured Worker-owned callback path, such as `/auth/callback/browser_code`.
5. Linux DO redirects back to the configured Worker callback.
6. Worker consumes state, exchanges the Linux DO code, fetches user info, upserts the user, and creates a short-lived one-time exchange code.
7. Worker redirects to the configured completion page:

   ```text
   /auth/complete/<flowId>?code=<one-time-exchange-code>&app=<appId>&flow=<flowId>
   ```

8. Client reads only the one-time code, then exchanges it:

   ```http
   POST /auth/exchange
   Content-Type: application/json

   {
     "code": "<one-time-exchange-code>",
     "verifier": "<client-held-verifier>"
   }
   ```

9. Worker atomically consumes the exchange code only when `code + verifier` match and returns:

   ```json
   {
     "token": "<bearer-token>",
     "token_type": "Bearer",
     "token_kind": "opaque_reuse",
     "app": "sample-notes",
     "linux_do_id": "332940"
   }
   ```

The completion URL never carries a Bearer token. The one-time exchange code is short-lived and cannot be redeemed without the original verifier.

## Private Save Slots

Read:

```http
GET /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <token>
```

Missing slot response:

```json
{
  "found": false,
  "app": "sample-notes",
  "slot": "main",
  "data": null,
  "version": 0,
  "updatedAt": null
}
```

Write:

```http
PUT /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <token>
Content-Type: application/json

{"example": true}
```

Write response:

```json
{
  "app": "sample-notes",
  "slot": "main",
  "data": { "example": true },
  "version": 1,
  "updatedAt": "2026-06-28T00:00:00.000Z"
}
```

Semantics:

- App ids and slot ids must be hardcoded and allowed by the Worker.
- A token is bound to one app id.
- Slot payloads must be JSON objects.
- Writes are last-write-wins.
- `version` increments on overwrite.

## Public Slots

Public slots are app-scoped global records. They are not tied to a Linux DO user and are stored separately from private save slots. Public slot ids use the internal `public:<id>` namespace, while the HTTP route accepts the bare id.

Read:

```http
GET /api/apps/<appId>/public/<publicSlotId>
```

Missing public slot response:

```json
{
  "found": false,
  "app": "sample-notes",
  "slot": "public:news",
  "data": null,
  "version": 0,
  "updatedAt": null
}
```

Write:

```http
PUT /api/apps/<appId>/public/<publicSlotId>
X-Public-Write-Key: <app-public-write-key>
Content-Type: application/json

{"example": true}
```

Write response:

```json
{
  "app": "sample-notes",
  "slot": "public:news",
  "data": { "example": true },
  "version": 1,
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

Semantics:

- Public reads are intentionally unauthenticated.
- Public writes require the app's hardcoded public write key.
- Public write keys do not authorize private save slot reads or writes.
- App ids and public slot ids must be hardcoded and allowed by the Worker.
- `publicSlotId` is a bare id such as `news`; the stored slot id is `public:news`.
- Slot payloads must be JSON objects.
- Writes are last-write-wins.
- `version` increments on overwrite.
- Public read and write responses use `Cache-Control: no-store` in the first pass.
