# Protocol

## Login

1. Local app opens:

   ```text
   https://<worker>/auth/start?app=<appId>&redirect_uri=<url-encoded-local-callback>
   ```

2. Worker validates `app` and `redirect_uri` against hardcoded config.
3. Worker creates one-time D1 OAuth state with PKCE verifier/challenge.
4. Worker redirects to Linux DO Connect authorize URL.
5. Linux DO redirects back to `/auth/callback`.
6. Worker consumes state, exchanges code, fetches user info, upserts the user, and issues the app's configured service token.
7. Worker redirects to the original allowed target with query params:

   ```text
   token=<bearer-token>&token_type=Bearer&token_kind=<opaque_reuse|jwt>&app=<appId>&linux_do_id=<id>
   ```

The local app should immediately store the token in its local secure storage and remove it from visible/browser history where possible.

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
