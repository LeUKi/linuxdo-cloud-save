export const LLM_TOOL_CONTRACT_PATH = "/docs/llm-tool-contract";

export function rootHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>linuxdo-cloud-save</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; padding: 2rem; line-height: 1.55; }
      main { max-width: 760px; margin: 0 auto; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      ul { padding-left: 1.25rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>linuxdo-cloud-save</h1>
      <p>Cloud-save Worker for self-authored programs using Linux DO OAuth2, D1, and app-scoped save slots.</p>
      <ul>
        <li><a href="/health">Health check</a></li>
        <li><a href="${LLM_TOOL_CONTRACT_PATH}">LLM Tool Contract</a></li>
      </ul>
      <p>API routes are intentionally UI-free. Use <code>/auth/start</code>, private slot routes, and public slot routes from your own clients.</p>
    </main>
  </body>
</html>`;
}

export const LLM_TOOL_CONTRACT_MARKDOWN = `# LLM Tool Contract

This document defines an application-side tool contract for self-authored LLM applications that need to use this Worker. It is not a remote MCP server, SDK, or executor. The Worker keeps the existing REST API, auth model, and D1 schema; your LLM application registers these tools with its model provider and executes selected tool calls by calling the existing HTTP endpoints.

## Execution Model

\`\`\`text
LLM
  -> tool call JSON
  -> your application executor
  -> existing Worker REST API
  -> D1
\`\`\`

The model sees tool names, descriptions, and input schemas. The application executor owns credentials, validates arguments, performs HTTP requests, and returns sanitized results to the model.

Do not put Bearer tokens or public write keys in model-visible tool arguments. Keep them in application runtime configuration, secure local storage, Worker-side secrets, or another non-prompt credential store owned by your application.

## Why This Is Not MCP

MCP is useful when an MCP-compatible client should discover and call tools through an MCP server. This first pass targets applications you write yourself, so a tool contract is smaller and clearer:

- no remote MCP server
- no MCP endpoint in this Worker
- no local MCP adapter
- no SDK or TypeScript executor
- no new API routes
- no changes to OAuth, Bearer tokens, public write keys, or D1 tables

## Tools

- \`list_allowed_slots(appId)\`
- \`get_private_slot(appId, slotId)\`
- \`put_private_slot(appId, slotId, data)\`
- \`get_public_slot(appId, publicSlotId)\`
- \`put_public_slot(appId, publicSlotId, data)\`

\`slotId\` names private slots exactly as configured, such as \`main\`. \`publicSlotId\` is the bare public id, such as \`news\`; the Worker route maps it to the stored \`public:news\` slot.

## Tool Schemas

The following definitions use an OpenAI-style function tool shape. Other providers can use the same \`name\`, \`description\`, and JSON Schema parameters.

\`\`\`json
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
          "appId": { "type": "string", "description": "Hardcoded application id." }
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
          "appId": { "type": "string", "description": "Hardcoded application id." },
          "slotId": { "type": "string", "description": "Allowed private slot id." }
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
          "appId": { "type": "string", "description": "Hardcoded application id." },
          "slotId": { "type": "string", "description": "Allowed private slot id." },
          "data": { "type": "object", "description": "JSON object to store in the slot.", "additionalProperties": true }
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
          "appId": { "type": "string", "description": "Hardcoded application id." },
          "publicSlotId": { "type": "string", "description": "Bare public slot id. Do not include the public: prefix." }
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
          "appId": { "type": "string", "description": "Hardcoded application id." },
          "publicSlotId": { "type": "string", "description": "Bare public slot id. Do not include the public: prefix." },
          "data": { "type": "object", "description": "JSON object to store in the public slot.", "additionalProperties": true }
        }
      }
    }
  }
]
\`\`\`

## REST Mapping

### \`list_allowed_slots(appId)\`

This tool is configuration discovery for the LLM application. It should return the app's hardcoded configured slots, not D1 records and not a user's saved-slot history.

There is no Worker REST endpoint for this in the first pass. Implement it in your application from the same hardcoded allowlist policy you use to register tools. This contract is independent of repository layout and maps only to the existing REST endpoints. Do not query D1 for this tool.

### \`get_private_slot(appId, slotId)\`

\`\`\`http
GET /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <user-service-token>
\`\`\`

### \`put_private_slot(appId, slotId, data)\`

\`\`\`http
PUT /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <user-service-token>
Content-Type: application/json

<data>
\`\`\`

### \`get_public_slot(appId, publicSlotId)\`

\`\`\`http
GET /api/apps/<appId>/public/<publicSlotId>
\`\`\`

### \`put_public_slot(appId, publicSlotId, data)\`

\`\`\`http
PUT /api/apps/<appId>/public/<publicSlotId>
X-Public-Write-Key: <app-public-write-key>
Content-Type: application/json

<data>
\`\`\`

## Credential Rules

Private slot tools require \`Authorization: Bearer <user-service-token>\`. Public reads require no credential. Public writes require \`X-Public-Write-Key\`.

Tool schemas must not include \`token\`, \`authorization\`, \`publicWriteKey\`, or similar secret fields. If a model can write those fields, the secrets can leak into logs, traces, or prompt history.

## Safety Notes

- Treat model tool arguments as untrusted input.
- Do not let the model choose arbitrary route paths or raw URLs.
- Do not expose "list saved private slots" in the first pass.
- Public slot data is intentionally readable by anyone who knows the route.
- Private slot data is user-scoped and must always use the Bearer-token route.

## Non-Goals

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
`;
