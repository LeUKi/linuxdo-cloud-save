# LLM Tool Contract

This document defines an application-side tool contract for self-authored LLM applications that need to use this Worker. It is not a remote MCP server, SDK, or executor. The Worker keeps the existing REST API, auth model, and D1 schema; your LLM application registers these tools with its model provider and executes the selected tool calls by calling the existing HTTP endpoints.

## Execution Model

```text
LLM
  -> tool call JSON
  -> your application executor
  -> existing Worker REST API
  -> D1
```

The model sees tool names, descriptions, and input schemas. The application executor owns credentials, validates arguments, performs HTTP requests, and returns sanitized results to the model.

Do not put Bearer tokens or public write keys in model-visible tool arguments. Keep them in application runtime configuration, secure local storage, Worker-side secrets, or another non-prompt credential store owned by your application.

## Why This Is Not MCP

MCP is useful when an MCP-compatible client should discover and call tools through an MCP server. This first pass targets applications you write yourself, so a tool contract is smaller and clearer:

- no remote MCP server
- no MCP endpoint in this Worker
- no local MCP adapter
- no SDK or TypeScript executor
- no new API routes
- no model-visible OAuth, Bearer token, public write key, or D1-table operations

The contract only describes how your own application should expose model tools and map tool calls to the existing REST API.

## Tools

The first-pass tool set is intentionally small:

- `list_allowed_slots(appId)`
- `get_private_slot(appId, slotId)`
- `put_private_slot(appId, slotId, data)`
- `get_public_slot(appId, publicSlotId)`
- `put_public_slot(appId, publicSlotId, data)`

`slotId` names private slots exactly as configured, such as `main`. `publicSlotId` is the bare public id, such as `news`; the Worker route maps it to the stored `public:news` slot.

## Shared Types

Slot data must be a JSON object. Arrays, strings, numbers, booleans, and `null` are not valid top-level slot payloads.

Successful slot reads and writes use the existing response shape:

```json
{
  "found": true,
  "app": "sample-notes",
  "slot": "main",
  "data": { "example": true },
  "version": 1,
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

Missing slots use:

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

For public slots, `slot` is returned in internal form, such as `public:news`.

Errors should be passed through or normalized from the existing Worker error envelope:

```json
{
  "error": {
    "code": "unknown_slot",
    "message": "Unknown slot."
  }
}
```

## Tool Schemas

The following definitions use an OpenAI-style function tool shape. Other providers can use the same `name`, `description`, and JSON Schema parameters.

```json
[
  {
    "type": "function",
    "function": {
      "name": "list_allowed_slots",
      "description": "List the hardcoded private and public slot ids configured for an app. This does not query user save data.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["appId"],
        "properties": {
          "appId": {
            "type": "string",
            "description": "Hardcoded application id, for example sample-notes."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_private_slot",
      "description": "Read a private per-user save slot using the application's stored user Bearer token.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["appId", "slotId"],
        "properties": {
          "appId": {
            "type": "string",
            "description": "Hardcoded application id."
          },
          "slotId": {
            "type": "string",
            "description": "Allowed private slot id, for example main or settings."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "put_private_slot",
      "description": "Write a private per-user save slot using the application's stored user Bearer token.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["appId", "slotId", "data"],
        "properties": {
          "appId": {
            "type": "string",
            "description": "Hardcoded application id."
          },
          "slotId": {
            "type": "string",
            "description": "Allowed private slot id, for example main or settings."
          },
          "data": {
            "type": "object",
            "description": "JSON object to store in the slot.",
            "additionalProperties": true
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_public_slot",
      "description": "Read an app-scoped public slot. Public reads do not require a Bearer token.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["appId", "publicSlotId"],
        "properties": {
          "appId": {
            "type": "string",
            "description": "Hardcoded application id."
          },
          "publicSlotId": {
            "type": "string",
            "description": "Bare public slot id, for example news. Do not include the public: prefix."
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "put_public_slot",
      "description": "Write an app-scoped public slot using the application's configured public write key.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["appId", "publicSlotId", "data"],
        "properties": {
          "appId": {
            "type": "string",
            "description": "Hardcoded application id."
          },
          "publicSlotId": {
            "type": "string",
            "description": "Bare public slot id, for example news. Do not include the public: prefix."
          },
          "data": {
            "type": "object",
            "description": "JSON object to store in the public slot.",
            "additionalProperties": true
          }
        }
      }
    }
  }
]
```

## REST Mapping

### `list_allowed_slots(appId)`

This tool is configuration discovery for the LLM application. It should return the app's hardcoded configured slots, not D1 records and not a user's saved-slot history.

Recommended result shape:

```json
{
  "app": "sample-notes",
  "privateSlots": [
    { "id": "main" },
    { "id": "settings", "maxJsonBytes": 16384 }
  ],
  "publicSlots": [
    { "id": "news", "internalId": "public:news" }
  ]
}
```

There is no Worker REST endpoint for this in the first pass. Implement it in your application from the same hardcoded allowlist policy you use to register tools. This contract is independent of repository layout and maps only to the existing REST endpoints. Do not query D1 for this tool.

### `get_private_slot(appId, slotId)`

Executor request:

```http
GET /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <user-service-token>
```

Credential source: the application-held service token issued after Linux DO OAuth login for this app.

### `put_private_slot(appId, slotId, data)`

Executor request:

```http
PUT /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <user-service-token>
Content-Type: application/json

<data>
```

Credential source: the application-held service token issued after Linux DO OAuth login for this app.

### `get_public_slot(appId, publicSlotId)`

Executor request:

```http
GET /api/apps/<appId>/public/<publicSlotId>
```

No credential is required. The public slot id is the bare id, such as `news`.

### `put_public_slot(appId, publicSlotId, data)`

Executor request:

```http
PUT /api/apps/<appId>/public/<publicSlotId>
X-Public-Write-Key: <app-public-write-key>
Content-Type: application/json

<data>
```

Credential source: the application-held public write key for that app. This key only authorizes configured public slot writes; it does not authorize private slot reads or writes.

## Executor Responsibilities

The application executor is the trust boundary between model output and the Worker. It should:

- keep credentials out of model-visible tool arguments and transcripts
- validate `appId` against the app ids the application intentionally supports
- validate `slotId` and `publicSlotId` against hardcoded allowlists before HTTP requests
- reject top-level non-object `data` before calling write endpoints
- enforce any app-specific or slot-specific payload size limits before sending writes
- map Worker errors to concise model-visible errors without including raw credentials
- avoid exposing private user slot enumeration; `list_allowed_slots` is allowlist discovery only

## Credential Rules

Private tools:

- `get_private_slot`
- `put_private_slot`

These require `Authorization: Bearer <user-service-token>`. The token is bound to one app and is produced by the existing Linux DO OAuth handoff.

Public tools:

- `get_public_slot` needs no credential.
- `put_public_slot` requires `X-Public-Write-Key`.

Tool schemas must not include `token`, `authorization`, `publicWriteKey`, or similar secret fields. If a model can write those fields, the secrets can leak into logs, traces, or prompt history.

## Safety Notes

- Treat model tool arguments as untrusted input.
- Do not let the model choose arbitrary route paths or raw URLs.
- Do not expose "list saved private slots" in the first pass; that would reveal user-specific data presence and is outside this contract.
- Keep public write keys scoped per app and rotate them manually if they leak.
- Public slot data is intentionally readable by anyone who knows the route.
- Private slot data is user-scoped and must always use the Bearer-token route.

## Non-Goals

This contract does not add:

- remote MCP support
- an MCP route or MCP transport
- a local MCP adapter
- SDK or executor code
- example LLM application code
- new Worker routes
- dynamic app or slot registration
- user saved-slot listing
- new authentication or authorization behavior
- D1 schema changes
