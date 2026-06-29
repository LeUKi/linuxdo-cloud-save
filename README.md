# linuxdo-cloud-save

`linuxdo-cloud-save` 是一个部署在 Cloudflare Workers 上的轻量云存档服务。用户通过 Linux DO Connect OAuth2 登录后，Worker 会下发一个长期 Bearer token；客户端再用这个 token 读写按应用和 slot 隔离的 JSON 存档。

这个项目的目标是服务自己写的程序，不是公开 SaaS 或通用开发者平台。应用 id、slot、auth flow、token 策略和公共写 key 摘要都硬编码在代码里，方便个人维护和审计。

## 功能

- Linux DO OAuth2 登录
- 长期 Bearer token，下发方式为 verifier 绑定的一次性 code exchange
- 两种 token 策略：`opaque_reuse` 和 `jwt`
- 私有用户存档 slot：`GET/PUT /api/apps/:appId/slots/:slotId`
- 公共只读 slot：`GET /api/apps/:appId/public/:publicSlotId`
- 公共 slot 写入 key：`PUT /api/apps/:appId/public/:publicSlotId`
- Cloudflare D1 持久化
- Hono + Drizzle + Wrangler
- 无用户界面、无管理界面

## 当前仓库配置说明

本仓库采用双轨配置：

- [wrangler.jsonc](./wrangler.jsonc) 保留维护者当前实例配置，里面的 `name = linuxdo-cloud-save` 和 D1 `database_id = 56b00910-a9af-4563-bec3-fa9d85f60888` 属于维护者自己的 Cloudflare 资源。
- [wrangler.example.jsonc](./wrangler.example.jsonc) 是给 fork/复用者参考的模板配置，里面使用占位值。

如果你只是换一台自己的机器继续维护当前实例，可以保留 `wrangler.jsonc`，登录同一个 Cloudflare 账号后部署。

如果你是 fork 或部署自己的实例，必须先创建自己的 D1 数据库，然后把 `wrangler.jsonc` 里的 `database_id`、`database_name`、`name` 和 `SERVICE_ISSUER` 换成自己的值。不要尝试使用维护者的 D1 id。

## 技术栈

- [Hono](https://hono.dev/)：Worker HTTP 路由
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)：运行环境
- [Cloudflare D1](https://developers.cloudflare.com/d1/)：SQLite 兼容数据库
- [Drizzle ORM](https://orm.drizzle.team/)：数据库 schema 和查询
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)：本地开发、D1 migration、部署
- [Bun](https://bun.sh/)：依赖安装和脚本运行

## 目录

- [src/config/apps.ts](./src/config/apps.ts)：硬编码应用配置
- [src/routes/auth.ts](./src/routes/auth.ts)：Linux DO OAuth 登录入口和回调
- [src/routes/slots.ts](./src/routes/slots.ts)：私有存档 API
- [src/routes/public-slots.ts](./src/routes/public-slots.ts)：公共 slot API
- [src/db/schema.ts](./src/db/schema.ts)：Drizzle schema
- [migrations/](./migrations)：D1 migration SQL
- [docs/protocol.md](./docs/protocol.md)：接口协议说明
- [docs/security.md](./docs/security.md)：安全边界说明
- [docs/llm-tool-contract.md](./docs/llm-tool-contract.md)：LLM 应用 tool schema 契约

## 应用配置

应用配置写在 [src/config/apps.ts](./src/config/apps.ts)。每个应用可以配置：

- `id`：稳定应用标识，会出现在 API 路由里
- `name`：显示名称
- `authFlows`：显式登录/凭据交付 flow；每个 flow 配置 OAuth callback、完成页、token 策略和 code TTL
- `slots`：允许访问的私有 slot
- `publicSlots`：允许公开读取的公共 slot，内部存储名使用 `public:<id>`
- `publicWriteKeySha256`：公共 slot 写 key 的 SHA-256 摘要
- `maxJsonBytes`：JSON payload 上限

示例：

```ts
{
  id: "linuxdo-friends",
  name: "LinuxDo Friends",
  authFlows: [
    {
      id: "browser_code",
      name: "Browser Code Exchange",
      oauthCallbackPath: "/auth/callback/browser_code",
      completionPath: "/auth/complete/browser_code",
      tokenStrategy: "jwt",
      delivery: {
        kind: "code_exchange",
        codeTtlSeconds: 60,
        requireVerifier: true
      }
    }
  ],
  maxJsonBytes: 64 * 1024,
  slots: [{ id: "config" }]
}
```

## 必要密钥和变量

这些值不要提交到仓库。生产环境使用 `wrangler secret put` 设置；本地开发可以复制 [.dev.vars.example](./.dev.vars.example) 到 `.dev.vars` 后填入自己的值。

Worker secrets：

- `LINUX_DO_CLIENT_ID`
- `LINUX_DO_CLIENT_SECRET`
- `SERVICE_TOKEN_PEPPER`
- `SERVICE_TOKEN_ENCRYPTION_KEY`
- `JWT_SIGNING_SECRET`

普通 vars 已在 `wrangler.jsonc` 里配置：

- `SERVICE_ISSUER`
- `LINUX_DO_OAUTH_AUTHORIZE_URL`
- `LINUX_DO_OAUTH_TOKEN_URL`
- `LINUX_DO_USERINFO_URL`

生成随机 secret 可以用：

```sh
openssl rand -base64 32
```

## Linux DO OAuth 配置

在 Linux DO Connect/OAuth 应用里配置回调地址：

```text
https://<你的-worker-host>/auth/callback/browser_code
```

部署到 workers.dev 后通常类似：

```text
https://<worker-name>.<your-subdomain>.workers.dev/auth/callback/browser_code
```

当前维护者实例的回调地址是：

```text
https://linuxdo-cloud-save.lafish.workers.dev/auth/callback/browser_code
```

客户端自己的回调地址不填到 Linux DO 后台。客户端打开 `/auth/start?app=<appId>&flow=<flowId>&challenge=<challenge>`，Linux DO 只回到 Worker 自己的 `oauthCallbackPath`。Worker 随后跳到 `completionPath?code=<one-time-code>`，客户端用 `code + verifier` 调 `POST /auth/exchange` 换 Bearer token。

## 从新机器 CLI 完整部署

下面流程适用于 fork/复用者创建自己的 Cloudflare 资源后部署。

### 1. 准备环境

需要：

- Node.js 或 Bun 可运行环境
- Bun
- Cloudflare 账号
- Linux DO OAuth 应用
- Wrangler 登录权限

安装依赖：

```sh
bun install
```

登录 Cloudflare：

```sh
bunx wrangler login
```

确认登录状态：

```sh
bunx wrangler whoami
```

### 2. 创建 D1 数据库

创建自己的 D1：

```sh
bunx wrangler d1 create linuxdo-cloud-save
```

命令输出会包含类似：

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "linuxdo-cloud-save",
      "database_id": "<your-database-id>"
    }
  ]
}
```

把输出里的 `database_id` 写入 [wrangler.jsonc](./wrangler.jsonc)：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "linuxdo-cloud-save",
    "database_id": "<your-database-id>",
    "migrations_dir": "migrations"
  }
]
```

如果你也改了 Worker 名称，请同步调整：

- `name`
- `d1_databases[0].database_name`
- `vars.SERVICE_ISSUER`
- OAuth 回调地址里的 host

### 3. 设置生产 secrets

逐个执行：

```sh
bunx wrangler secret put LINUX_DO_CLIENT_ID
bunx wrangler secret put LINUX_DO_CLIENT_SECRET
bunx wrangler secret put SERVICE_TOKEN_PEPPER
bunx wrangler secret put SERVICE_TOKEN_ENCRYPTION_KEY
bunx wrangler secret put JWT_SIGNING_SECRET
```

`LINUX_DO_CLIENT_ID` 和 `LINUX_DO_CLIENT_SECRET` 来自 Linux DO OAuth 应用。其他三个建议使用 `openssl rand -base64 32` 生成。

### 4. 应用远程 D1 migrations

```sh
bun run db:migrate:remote
```

等价命令：

```sh
bunx wrangler d1 migrations apply linuxdo-cloud-save --remote
```

如果你修改了 `database_name`，这里也要换成你的 D1 数据库名。

### 5. 部署 Worker

```sh
bun run deploy
```

部署成功后 Wrangler 会输出 Worker URL。

### 6. 线上 smoke check

```sh
curl -fsS https://<你的-worker-host>/health
```

期望返回：

```json
{"ok":true,"service":"linuxdo-cloud-save"}
```

测试 OAuth 起始跳转：

```sh
curl -I "https://<你的-worker-host>/auth/start?app=linuxdo-friends&flow=browser_code&challenge=<base64url-sha256-verifier>"
```

期望返回 `302`，`location` 指向 Linux DO OAuth authorize endpoint。

## 本地开发

复制本地变量示例：

```sh
cp .dev.vars.example .dev.vars
```

填入自己的测试值后，应用本地 D1 migrations：

```sh
bun run db:migrate:local
```

启动本地 Worker：

```sh
bun run dev
```

本地 `wrangler dev` 通常会使用 `http://127.0.0.1:8787`。OAuth 登录如果要完整跑通，需要 Linux DO OAuth 回调地址能访问你的 Worker；纯本地调试可以优先使用单元测试和接口测试。

## 测试和检查

```sh
bun run typecheck
bun run test
```

生成 Drizzle migration：

```sh
bun run db:generate
```

## API 概览

根路径：

- `GET /`：简单项目说明和文档链接
- `GET /health`：健康检查
- `GET /docs/llm-tool-contract`：LLM 应用 tool schema 文档

OAuth：

```http
GET /auth/start?app=<appId>&flow=<flowId>&challenge=<base64url-sha256-verifier>
GET /auth/callback/<flowId>?code=<linux-do-code>&state=<state>
GET /auth/complete/<flowId>?code=<one-time-exchange-code>
POST /auth/exchange
Content-Type: application/json

{"code":"<one-time-exchange-code>","verifier":"<client-held-verifier>"}
```

私有 slot：

```http
GET /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <service-token>
```

```http
PUT /api/apps/<appId>/slots/<slotId>
Authorization: Bearer <service-token>
Content-Type: application/json

{"example": true}
```

公共 slot：

```http
GET /api/apps/<appId>/public/<publicSlotId>
```

```http
PUT /api/apps/<appId>/public/<publicSlotId>
X-Public-Write-Key: <app-public-write-key>
Content-Type: application/json

{"example": true}
```

只接受 JSON object 作为 slot 数据。

## Token 策略

`opaque_reuse`：

- 每个 `user + app` 复用一个高熵随机 token
- D1 保存 token HMAC 和加密后的原始 token
- 可通过 `revoked_at` 做服务端撤销

`jwt`：

- 签发长期 HS256 JWT
- token 包含 `sub`、`app`、`linux_do_id` 和 `jti`
- 常规请求不查 D1 撤销状态
- 粗粒度撤销方式是轮换 `JWT_SIGNING_SECRET`

## 安全边界

- 本项目默认服务自己写的程序，不假设本地客户端能保密。
- OAuth 完成页只携带短 TTL、一次性的 exchange code，不携带 Bearer token。
- `/auth/exchange` 必须同时提交 code 和客户端本地保存的 verifier，验证通过后才返回 Bearer token。
- `app`、`flow`、token 策略和 slot 都必须命中代码里的硬编码配置。
- 公共 slot 任何人都能读，只有匹配硬编码写 key 摘要才能写。
- 不要把 Bearer token、Linux DO client secret、JWT signing secret、公共写 key 原文提交到仓库。

更多细节见 [docs/security.md](./docs/security.md)。

## LLM 应用接入

这个仓库不实现远程 MCP Server。LLM 应用应把 [docs/llm-tool-contract.md](./docs/llm-tool-contract.md) 里的工具 schema 注册给模型，然后由你自己的应用执行工具调用并访问现有 REST API。

## 许可证

[MIT](./LICENSE)
