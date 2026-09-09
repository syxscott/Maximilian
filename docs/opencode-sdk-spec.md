# opencode SDK & HTTP/SSE Protocol Spec

> Reverse-engineered from `/home/user/shenyaxuan/Maximilian/opencode/` (commit on
> disk). Source roots:
> - HTTP server: `packages/server/src/`
> - Public HTTP API (instance + global + control): `packages/opencode/src/server/routes/instance/httpapi/`
> - Protocol / route definitions: `packages/protocol/src/groups/`
> - Schema: `packages/schema/src/`
> - SDK (generated): `packages/sdk/js/src/v2/gen/`
> - Public OpenAPI spec: `packages/sdk/openapi.json` (also copied to `packages/docs/openapi.json`).
>
> All paths below are absolute and refer to the opencode checkout unless noted.

This document is the source of truth for an external HTTP + SSE client. Every
route, header, event, error, and lifecycle step needed to talk to a running
`opencode serve` process is described here.

---

## 1. Overview

`opencode serve` runs a single Node.js HTTP/WebSocket server built on
[`effect/unstable/http`](https://effect.website) (`packages/server/src/routes.ts`).
The HTTP API is split into three layers:

| Layer | Group | Source | Path prefix |
|---|---|---|---|
| **Server API (v2)** | `server.health`, `server.location`, `server.agent`, `server.session`, `server.message`, `server.model`, `server.provider`, `server.integration`, `server.credential`, `server.permission`, `server.fs`, `server.command`, `server.skill`, `server.event`, `server.pty`, `server.question`, `server.reference`, `server.projectCopy` | `packages/server/src/handlers/*` + `packages/protocol/src/groups/*` | `/api/...` (one `/experimental/...`) |
| **Instance API** | `config`, `experimental`, `file`, `instance`, `mcp`, `project`, `provider`, `pty`, `question`, `session`, `sync`, `tui`, `workspace`, `permission` | `packages/opencode/src/server/routes/instance/httpapi/handlers/*` and `groups/*` | mostly `/session/...`, `/config/...`, `/file/...`, `/mcp/...`, etc. (no `/api` prefix) |
| **Root API** | `control`, `controlPlane`, `global` | same package | `/global/...`, `/control/...`, etc. |

The `OpenCodeHttpApi` in `packages/opencode/src/server/routes/instance/httpapi/api.ts`
fuses the three layers into one `HttpApi` with metadata
`OpenApi.fromApi(PublicApi)` → `packages/sdk/openapi.json`.

> **Two coexisting surfaces.** The `v2.*` surface (under `/api/...`) is the new,
> protocol-defined HTTP API. It is the recommended target for external clients
> and is what the generated `OpencodeClient.v2.*` SDK wrapper uses.
> Everything else (root / instance) is internal-facing and is documented in the
> same OpenAPI for compatibility, but the SDK auto-generated file at
> `packages/sdk/js/src/v2/sdk.gen.ts` exposes both surfaces under one
> `OpencodeClient` instance.

---

## 2. Process Management

### 2.1 CLI command

| | |
|---|---|
| Command | `opencode serve` |
| Source | `packages/opencode/src/cli/cmd/serve.ts` |
| Description | "starts a headless opencode server" |
| Yargs flags (see `packages/opencode/src/cli/network.ts`) | `--port <number>` (default `0`, see below), `--hostname <string>` (default `127.0.0.1`), `--mdns <bool>` (default `false`), `--mdns-domain <string>` (default `opencode.local`), `--cors <string[]>` (extra CORS origins) |
| Env vars | `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` (see auth); `OPENCODE_CONFIG_CONTENT` (full JSON config as string, used by SDK helper); `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_GIT_BASH_PATH`, etc. (`packages/core/src/flag/flag.ts`) |

The server warns and continues when `OPENCODE_SERVER_PASSWORD` is unset:
```ts
// packages/opencode/src/cli/cmd/serve.ts
if (!Flag.OPENCODE_SERVER_PASSWORD) {
  console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
}
```

### 2.2 Port resolution

`packages/opencode/src/server/server.ts → startWithPortFallback`:

- If `--port` is non-zero → listen on that port.
- If `--port=0` (the default) → try `4096` first, fall back to any free port.

The resolved port is read from `state.server.address` after
`Layer.buildWithMemoMap` succeeds. mDNS (`packages/opencode/src/server/mdns.ts`)
publishes the listener only when:
- `opts.mdns === true` AND
- `hostname` is not `127.0.0.1` / `localhost` / `::1`.

### 2.3 Ready signal & log format

After bind success the CLI prints:
```
opencode server listening on http://<hostname>:<port>
```

The SDK helper `createOpencodeServer` (`packages/sdk/js/src/v2/server.ts`)
parses stdout for that line and resolves the URL via `on\s+(https?://\S+)`,
so any external client (or `Process.spawn`) can do the same.

### 2.4 Graceful shutdown

`makeStop` in `server.ts` builds a finalizer that:
1. Unpublishes mDNS.
2. If the caller requested `close: true`, force-closes all HTTP sockets and
   all tracked WebSockets (`WebSocketTracker.closeAll` → 1-second timeout per
   socket, `packages/opencode/src/server/routes/instance/httpapi/websocket-tracker.ts`).
3. Closes the effect `Scope`, which finalizes the `HttpServer` layer.

`NodeHttpServer.layer` is created with `gracefulShutdownTimeout: "1 second"`
(`server.ts:214`). Signals that reach the process end the `Effect.never`
in `serve.ts`, triggering the listener's finalizer.

### 2.5 Embedding the server

`createEmbeddedRoutes()` (`packages/server/src/routes.ts:48`) builds the same
route layer without `ServerAuth.required` (no password check) — used when the
HTTP server is mounted inside an already-authenticated host process (e.g.
Electron renderer). Endpoints and event payloads are identical.

---

## 3. HTTP Headers

### 3.1 `Content-Type`

| Use | Value |
|---|---|
| Request bodies | `application/json` (auto-set by `@hey-api/client-fetch`; handlers also accept JSON for `prompt`/`revert.stage`/`pty.create`/etc.) |
| SSE responses | `text/event-stream` (see §5) |
| `GET /api/fs/read/*` | `application/octet-stream` (raw bytes, file content) |
| Other responses | `application/json` |

### 3.2 `x-opencode-directory`

- Required? **Optional.** When omitted, the server uses `process.cwd()`.
- When set, must be an absolute path (server normalizes through
  `Location.Ref.make({ directory: AbsolutePath.make(...) })`).
- Decoded from URL-encoded form (`decodeURIComponent`), so paths with spaces
  / unicode must be encoded.
- Resolution precedence (see `packages/server/src/location.ts`):
  1. `location[directory]` query param (if request URL is `/api/...`),
  2. `x-opencode-directory` header,
  3. `process.cwd()`.

The generated SDK rewrites this header into `?directory=…&location[directory]=…`
for GETs and strips it (`packages/sdk/js/src/v2/client.ts:18-48`).

### 3.3 `x-opencode-workspace`

- Optional; same precedence as directory.
- Value is a `WorkspaceV2.ID` (the worktree/workspace id).

### 3.4 `Authorization`

- Only enforced when `OPENCODE_SERVER_PASSWORD` is set to a non-empty string.
- Implementation: `packages/server/src/middleware/authorization.ts`.
- Expected format: `Basic <base64(username:password)>`.
- Default username: `opencode` (configurable via `OPENCODE_SERVER_USERNAME`).
- Alternative: pass credentials in the URL query string as `auth_token=<base64>`.
  Useful for browsers that cannot set `Authorization` headers on
  `EventSource` or WebSocket upgrades.
- When `OPENCODE_SERVER_PASSWORD` is unset, all authenticated routes
  short-circuit to the no-op effect.

### 3.5 `WWW-Authenticate`

Response header set on 401 responses:
```
WWW-Authenticate: Basic realm="Secure Area"
```

### 3.6 `x-opencode-ticket`

Custom header required by `POST /api/pty/{ptyID}/connect-token` to gate
cross-origin ticket issuance against the CORS allowlist:
```
x-opencode-ticket: 1
```
See `packages/protocol/src/groups/pty.ts` and `packages/server/src/handlers/pty.ts`.

### 3.7 Response headers added by the event endpoint

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
X-Content-Type-Options: nosniff
```
(`packages/server/src/handlers/event.ts:38-47`)

---

## 4. Authentication

`ServerAuth.required(config)` returns true iff
`OPENCODE_SERVER_PASSWORD` is set to a non-empty string
(`packages/server/src/auth.ts`). When true, every `/api/...` endpoint
flows through `authorizationLayer`:

1. Decode `Authorization: Basic …` (or `?auth_token=…`).
2. Compare username + password against `OPENCODE_SERVER_USERNAME` (default
   `opencode`) and `OPENCODE_SERVER_PASSWORD`.
3. Reject with `401 UnauthorizedError` + `WWW-Authenticate: Basic realm="Secure Area"`
   on mismatch.

The PTY connect route (`GET /api/pty/{ptyID}/connect`) opts out: when the URL
has `?ticket=<value>`, the ticket is consumed (`PtyTicket.consume`) and the
basic-auth check is skipped. This lets browsers open WebSockets without setting
headers.

`packages/server/src/cors.ts` describes the allowed origins (default):
- `http://localhost:*` / `http://127.0.0.1:*` (any port)
- `oc://renderer` (Electron renderer)
- `tauri://localhost` / `http://tauri.localhost` / `https://tauri.localhost`
- `https://*.opencode.ai`
- Plus any explicit values passed via `opts.cors` (CLI `--cors` flag).

---

## 5. SSE Event Stream

### 5.1 Subscribe

| | |
|---|---|
| Method + Path | `GET /api/event` |
| Handler | `server.event` → `event.subscribe` (`packages/server/src/handlers/event.ts`) |
| Response content type | `text/event-stream` |
| Heartbeat | `: heartbeat\n\n` every 15s (`Stream.tick("15 seconds")`) |
| First event | Always `server.connected` (sent before live tail) |

### 5.2 SSE wire format

Each event is emitted as:
```
event: message\n
data: {"id":"evt_…","type":"<type>","data":{...}}\n
\n
```

The server reuses a single event name `message` for every payload and tags
events by the `type` field on the JSON `data` line. `id` is the event id
(format `evt_<ascending>`), `data` is the encoded payload.

Per the V2 schema (`packages/protocol/src/groups/event.ts`) every payload has
the envelope:

```ts
{
  id: string                       // "evt_<ascending>"
  type: string                     // discriminator (see §5.3)
  metadata?: Record<string, unknown>
  durable?: { aggregateID: string, seq: number, version: number }
  location?: { directory: string, workspaceID?: string }
  data: <type-specific>
}
```

The stream also includes a `failureEvent: effect/httpapi/stream/failure` for
stream-level errors (per `OpenApi.fromApi` annotations).

### 5.3 Event types

Source: `packages/schema/src/event-manifest.ts → EventManifest.Latest`. The full
server-stream union (`EventManifest.ServerDefinitions`) is what
`GET /api/event` actually emits. The complete instance union
(`EventManifest.Definitions`, used by `/api/session/{sessionID}/event`) is
larger and includes v1 session/message events.

#### 5.3.1 Session lifecycle (durable, `session.next.*`)

| `type` | `data` payload |
|---|---|
| `session.next.agent.switched` | `{ timestamp, sessionID, messageID, agent }` |
| `session.next.model.switched` | `{ timestamp, sessionID, messageID, model: { id, providerID, variant? } }` |
| `session.next.moved` | `{ timestamp, sessionID, location, subdirectory? }` |
| `session.next.prompted` | `{ timestamp, sessionID, messageID, prompt: { text, files?, agents? }, delivery: "steer"\|"queue" }` |
| `session.next.prompt.admitted` | same as `prompted` |
| `session.next.context.updated` | `{ timestamp, sessionID, messageID, text }` |
| `session.next.synthetic` | `{ timestamp, sessionID, messageID, text }` |
| `session.next.shell.started` | `{ timestamp, sessionID, messageID, callID, command }` |
| `session.next.shell.ended` | `{ timestamp, sessionID, callID, output }` |
| `session.next.step.started` | `{ timestamp, sessionID, assistantMessageID, agent, model, snapshot? }` |
| `session.next.step.ended` (durable v2) | `{ timestamp, sessionID, assistantMessageID, finish, cost, tokens, snapshot?, files? }` |
| `session.next.step.failed` | `{ timestamp, sessionID, assistantMessageID, error: { type: "unknown", message } }` |
| `session.next.text.started` | `{ timestamp, sessionID, assistantMessageID, textID }` |
| `session.next.text.delta` *(live only)* | `{ timestamp, sessionID, assistantMessageID, textID, delta }` |
| `session.next.text.ended` | `{ timestamp, sessionID, assistantMessageID, textID, text }` |
| `session.next.reasoning.started` | `{ timestamp, sessionID, assistantMessageID, reasoningID, providerMetadata? }` |
| `session.next.reasoning.delta` *(live only)* | `{ timestamp, sessionID, assistantMessageID, reasoningID, delta }` |
| `session.next.reasoning.ended` | `{ timestamp, sessionID, assistantMessageID, reasoningID, text, providerMetadata? }` |
| `session.next.tool.input.started` | `{ timestamp, sessionID, assistantMessageID, callID, name }` |
| `session.next.tool.input.delta` *(live only)* | `{ timestamp, sessionID, assistantMessageID, callID, delta }` |
| `session.next.tool.input.ended` | `{ timestamp, sessionID, assistantMessageID, callID, text }` |
| `session.next.tool.called` | `{ timestamp, sessionID, assistantMessageID, callID, tool, input, provider: { executed, metadata? } }` |
| `session.next.tool.progress` | `{ timestamp, sessionID, assistantMessageID, callID, structured, content: ToolContent[] }` |
| `session.next.tool.success` | `{ timestamp, sessionID, assistantMessageID, callID, structured, content, outputPaths?, result?, provider }` |
| `session.next.tool.failed` | `{ timestamp, sessionID, assistantMessageID, callID, error, result?, provider }` |
| `session.next.retried` | `{ timestamp, sessionID, attempt, error: { message, statusCode?, isRetryable, … } }` |
| `session.next.compaction.started` | `{ timestamp, sessionID, messageID, reason: "auto"\|"manual" }` |
| `session.next.compaction.delta` *(live only)* | `{ timestamp, sessionID, messageID, text }` |
| `session.next.compaction.ended` | `{ timestamp, sessionID, messageID, reason, text, recent }` |
| `session.next.revert.staged` | `{ timestamp, sessionID, revert: RevertState }` |
| `session.next.revert.cleared` | `{ timestamp, sessionID }` |
| `session.next.revert.committed` | `{ timestamp, sessionID, messageID }` |

#### 5.3.2 Session v1 events (legacy shapes; still emitted by opencode)

| `type` | `data` |
|---|---|
| `session.created` | `{ sessionID, info: SessionInfo }` |
| `session.updated` | `{ sessionID, info: SessionInfo }` |
| `session.deleted` | `{ sessionID, info: SessionInfo }` |
| `session.compacted` | `{ sessionID }` |
| `session.status` | `{ sessionID, status: { type: "idle" } \| { type: "retry", attempt, message, action?, next } \| { type: "busy" } }` |
| `session.idle` *(deprecated)* | `{ sessionID }` |
| `message.updated` | `{ sessionID, info: Message }` |
| `message.removed` | `{ sessionID, messageID }` |
| `message.part.updated` | `{ sessionID, part, time }` |
| `message.part.removed` | `{ sessionID, messageID, partID }` |
| `message.part.delta` *(live only)* | `{ sessionID, messageID, partID, field, delta }` |
| `session.diff` | `{ sessionID, diff: FileDiff[] }` |
| `session.error` | `{ sessionID?, error: AssistantError }` |
| `command.executed` | `{ name, sessionID, arguments, messageID }` |

#### 5.3.3 Permission / Question

| `type` | `data` |
|---|---|
| `permission.asked` *(v1)* | `PermissionRequest` (id, sessionID, permission, patterns, metadata, always, tool?) |
| `permission.replied` *(v1)* | `{ sessionID, requestID, reply: "once"\|"always"\|"reject" }` |
| `permission.v2.asked` | `{ id, sessionID, action, resources, save?, metadata?, source?: { type: "tool", messageID, callID } }` |
| `permission.v2.replied` | `{ sessionID, requestID, reply }` |
| `question.asked` *(v1)* | `QuestionV1.Request` |
| `question.replied` *(v1)* | `{ sessionID, requestID, answers: string[][] }` |
| `question.rejected` *(v1)* | `{ sessionID, requestID }` |
| `question.v2.asked` | `{ id, sessionID, questions: QuestionV2.Info[], tool? }` |
| `question.v2.replied` | `{ sessionID, requestID, answers: string[][] }` |
| `question.v2.rejected` | `{ sessionID, requestID }` |

#### 5.3.4 Workspace / Worktree / VCS

| `type` | `data` |
|---|---|
| `workspace.ready` | `{ name }` |
| `workspace.failed` | `{ message }` |
| `workspace.status` | `{ workspaceID, status: "connected"\|"connecting"\|"disconnected"\|"error" }` |
| `worktree.ready` | `{ name, branch? }` |
| `worktree.failed` | `{ message }` |
| `vcs.branch.updated` | `{ branch? }` |
| `project.updated` | `Project.Info` |
| `project.directories.updated` | `{ projectID }` |

#### 5.3.5 File / FS / Plugin / Reference / Catalog / ModelsDev / Installation / Integration

| `type` | `data` |
|---|---|
| `file.edited` | `{ file }` |
| `file.watcher.updated` | `{ file, event: "add"\|"change"\|"unlink" }` |
| `plugin.added` | `{ id }` |
| `reference.updated` | `{}` |
| `catalog.updated` | `{}` |
| `models-dev.refreshed` | `{}` |
| `installation.updated` | `{ version }` |
| `installation.update-available` | `{ version }` |
| `integration.updated` | `{}` |
| `integration.connection.updated` | `{ integrationID }` |

#### 5.3.6 Pty / LSP / MCP / Todo

| `type` | `data` |
|---|---|
| `pty.created` | `{ info: Pty.Info }` |
| `pty.updated` | `{ info: Pty.Info }` |
| `pty.exited` | `{ id, exitCode }` |
| `pty.deleted` | `{ id }` |
| `lsp.updated` | `{}` |
| `mcp.tools.changed` | `{ server }` |
| `mcp.browser.open.failed` | `{ mcpName, url }` |
| `todo.updated` | `{ sessionID, todos: Todo[] }` |

#### 5.3.7 TUI / Server

| `type` | `data` |
|---|---|
| `tui.prompt.append` | `{ text }` |
| `tui.command.execute` | `{ command: TuiCommand }` |
| `tui.toast.show` | `{ title?, message, variant: "info"\|"success"\|"warning"\|"error", duration }` |
| `tui.session.select` | `{ sessionID }` |
| `server.connected` | `{}` (synthetic, sent on connect) |
| `global.disposed` | `{}` |
| `ide.installed` | `{ ide }` |

### 5.4 Session event stream

| | |
|---|---|
| Method + Path | `GET /api/session/{sessionID}/event` |
| Query | `?after=<seq>` (NonNegativeInt; exclusive aggregate sequence — replay from there forward) |
| Response | `text/event-stream` of `SessionDurableEvent` (`packages/schema/src/session-event.ts:514`) — same envelope as the global stream but **only the session-scoped, replayable subset** (no `*.delta` live events) |
| Initial event | First event after `after` is replayed; new durable events follow. |

---

## 6. Routes

The `/api/...` (v2) routes are listed below. Each row gives method, path,
query / body, success response, error classes, and auth. All routes except
`/api/fs/read/*` return JSON.

For non-`/api/...` routes (root + instance), refer to
`packages/sdk/openapi.json`. The SDK exposes them under
`client.<group>.<method>(...)`. The sections below note the most commonly
needed ones (session control, mcp, file, etc.) but the v2 surface is the
primary recommendation.

### 6.1 Health / Location

| Method | Path | Query | Success | Errors | Auth |
|---|---|---|---|---|---|
| GET | `/api/health` | – | `{ healthy: true }` | 400, 401 | yes (when password set) |
| GET | `/api/location` | `?location[directory]=...&location[workspace]=...` | `Location.Info` (see below) | 400, 401 | yes |

`Location.Info`:
```ts
{
  directory: string
  workspaceID?: string
  project: { id: string, directory: string }
}
```

### 6.2 Agent / Model / Provider / Integration

| Method | Path | Query | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/agent` | `location[directory/workspace]` | – | `{ location, data: AgentV2.Info[] }` | 400, 401 |
| GET | `/api/model` | `location` | – | `{ location, data: ModelV2.Info[] }` | 400, 401, 503 |
| GET | `/api/provider` | `location` | – | `{ location, data: ProviderV2.Info[] }` | 400, 401, 503 |
| GET | `/api/provider/{providerID}` | `location` | – | `{ location, data: ProviderV2.Info }` | 400, 401, 404, 503 |
| GET | `/api/integration` | `location` | – | `{ location, data: Integration.Info[] }` | 400, 401 |
| GET | `/api/integration/{integrationID}` | `location` | – | `{ location, data: Integration.Info }` | 400, 401 |
| POST | `/api/integration/{integrationID}/connect/key` | `location` | `{ key: string, label?: string }` | `204` | 400 |
| POST | `/api/integration/{integrationID}/connect/oauth` | `location` | `{ methodID, inputs: Record<string,string>, label? }` | `{ location, data: Integration.Attempt }` | 400 |
| GET | `/api/integration/attempt/{attemptID}` | `location` | – | `{ location, data: Integration.AttemptStatus }` | 400, 401 |
| POST | `/api/integration/attempt/{attemptID}/complete` | `location` | `{ code?: string }` | `204` | 400 |
| DELETE | `/api/integration/attempt/{attemptID}` | `location` | – | `204` | 400 |

`Integration.Attempt`:
```ts
{ attemptID, url, instructions, mode: "auto"|"code", time: { created, expires } }
```

`Integration.AttemptStatus` (tagged union on `status`):
- `pending { time }` / `complete { time }` / `failed { message, time }` / `expired { time }`

### 6.3 Credential

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| PATCH | `/api/credential/{credentialID}` | `{ label: string }` | `204` | 400, 401 |
| DELETE | `/api/credential/{credentialID}` | – | `204` | 400, 401 |

### 6.4 Session

All session routes use `:sessionID` (prefixed `ses_`).

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/session` | query: `workspace, limit, order, search, directory, project, subpath, cursor` | `{ data: SessionV2Info[], cursor: { previous?, next? } }` | 400, 401 |
| POST | `/api/session` | `{ id?, agent?, model?, location? }` | `{ data: SessionV2Info }` | 400, 401 |
| GET | `/api/session/active` | – | `{ data: Record<sessionID, { type: "running" }> }` | 400, 401 |
| GET | `/api/session/{sessionID}` | – | `{ data: SessionV2Info }` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/agent` | `{ agent: string }` | `204` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/model` | `{ model: ModelRef }` | `204` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/prompt` | `{ id?, prompt: PromptInput, delivery?: "steer"\|"queue", resume? }` | `{ data: SessionInput.Admitted }` | 400, 401, 404, 409 |
| POST | `/api/session/{sessionID}/compact` | – | `204` | 400, 401, 404, 503 |
| POST | `/api/session/{sessionID}/wait` | – | `204` (long-poll) | 400, 401, 404, 503 |
| POST | `/api/session/{sessionID}/revert/stage` | `{ messageID, files? }` | `{ data: Revert.State }` | 400, 401, 404, 500 |
| POST | `/api/session/{sessionID}/revert/clear` | – | `204` | 400, 401, 404, 500 |
| POST | `/api/session/{sessionID}/revert/commit` | – | `204` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/context` | – | `{ data: SessionMessage[] }` | 400, 401, 404, 500 |
| GET | `/api/session/{sessionID}/history` | `?limit, ?after` | `{ data: SessionDurableEvent[], hasMore }` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/event` | `?after=<seq>` | `text/event-stream` of `SessionDurableEvent` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/interrupt` | – | `204` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/message/{messageID}` | – | `{ data: SessionMessage }` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/message` | `?limit, ?order, ?cursor` | `{ data: SessionMessage[], cursor: { previous?, next? } }` | 400, 401, 404, 500 |

`SessionV2Info`:
```ts
{
  id: string                     // "ses_<id>"
  parentID?: string
  projectID: string
  agent?: string
  model?: ModelRef
  cost: number
  tokens: { input, output, reasoning, cache: { read, write } }
  time: { created, updated, archived? }
  title: string
  location: { directory, workspaceID? }
  subpath?: string
  revert?: RevertState
}
```

`ModelRef`:
```ts
{ id: string, providerID: string, variant?: string }
```

`PromptInput`:
```ts
{
  text: string
  files?: Array<{ uri: string, mime: string, name?, description?, source?: { start, end, text } }>
  agents?: Array<{ name: string, source? }>
}
```

`SessionInput.Admitted`:
```ts
{
  admittedSeq: number
  id: string
  sessionID: string
  prompt: Prompt
  delivery: "steer" | "queue"
  timeCreated: number
  promotedSeq?: number
}
```

`Revert.State`:
```ts
{
  messageID: string
  partID?: string
  snapshot?: string
  diff?: string
  files?: Array<{ path, status: "added"|"modified"|"deleted", additions, deletions, patch }>
}
```

`SessionMessage` (tagged union on `type`):
- `agent-switched`, `model-switched`, `user`, `synthetic`, `system`, `shell`,
  `assistant`, `compaction`.
- `assistant.content` is an array of `AssistantText | AssistantReasoning | AssistantTool`.
- `assistant.tool.state` is `pending | running | completed | error` with
  inputs, content, structured metadata, output, attachments etc.

### 6.5 Permission

`Permission.ID` is prefixed `per_`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/permission/request` | – | `{ location, data: PermissionV2.Request[] }` | 400, 401 |
| GET | `/api/permission/saved` | query `?projectID` | `{ data: PermissionSaved.Info[] }` | 400, 401 |
| DELETE | `/api/permission/saved/{id}` | – | `204` | 400, 401 |
| POST | `/api/session/{sessionID}/permission` | `{ id?, action, resources, save?, metadata?, source?: { type: "tool", messageID, callID }, agent? }` | `{ data: { id, effect: "allow"\|"deny"\|"ask" } }` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/permission` | – | `{ data: PermissionV2.Request[] }` | 400, 401, 404 |
| GET | `/api/session/{sessionID}/permission/{requestID}` | – | `{ data: PermissionV2.Request }` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/permission/{requestID}/reply` | `{ reply: "once"\|"always"\|"reject", message? }` | `204` | 400, 401, 404 |

`PermissionV2.Request`:
```ts
{
  id: string                 // "per_<id>"
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  metadata?: Record<string, unknown>
  source?: { type: "tool", messageID: string, callID: string }
}
```

### 6.6 Question

`Question.ID` is prefixed `que_`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/question/request` | – | `{ location, data: QuestionV2.Request[] }` | 400, 401 |
| GET | `/api/session/{sessionID}/question` | – | `{ data: QuestionV2.Request[] }` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/question/{requestID}/reply` | `QuestionV2.Reply` | `204` | 400, 401, 404 |
| POST | `/api/session/{sessionID}/question/{requestID}/reject` | – | `204` | 400, 401, 404 |

`QuestionV2.Request`:
```ts
{
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string, description: string }>
    multiple?: boolean
    custom?: boolean
  }>
  tool?: { messageID, callID }
}
```

`QuestionV2.Reply`:
```ts
{ answers: string[][] }  // one array per question, each entry is a selected option label
```

### 6.7 File System

| Method | Path | Notes |
|---|---|---|
| GET | `/api/fs/read/*` | Path after `/read/` is the file path (URI-decoded). Returns `application/octet-stream`. |
| GET | `/api/fs/list` | Query `?path`, `?location[directory/workspace]` |
| GET | `/api/fs/find` | Query `?query=<str>`, `?type=file\|directory`, `?limit<num>` |

`FileSystem.Entry`:
```ts
{ path: string, type: "file" | "directory" }
```

### 6.8 Command / Skill / Reference

| Method | Path | Response |
|---|---|---|
| GET | `/api/command` | `{ location, data: CommandV2.Info[] }` |
| GET | `/api/skill` | `{ location, data: SkillV2.Info[] }` |
| GET | `/api/reference` | `{ location, data: Reference.Info[] }` |

`SkillV2.Info`:
```ts
{
  name: string
  description?: string
  slash?: boolean
  location: string
  content: string
}
```

`Reference.Info`:
```ts
{
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: { type: "local", path } | { type: "git", repository, branch?, description?, hidden? }
}
```

### 6.9 PTY

`Pty.ID` is prefixed `pty_`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/pty` | – | `{ location, data: Pty.Info[] }` | 400, 401 |
| POST | `/api/pty` | `{ command?, args?, cwd?, title?, env?: Record<string,string> }` | `{ location, data: Pty.Info }` | 400, 401 |
| GET | `/api/pty/{ptyID}` | – | `{ location, data: Pty.Info }` | 400, 401, 404 |
| PUT | `/api/pty/{ptyID}` | `{ title?, size?: { rows, cols } }` | `{ location, data: Pty.Info }` | 400, 401, 404 |
| DELETE | `/api/pty/{ptyID}` | – | `204` | 400, 401, 404 |
| POST | `/api/pty/{ptyID}/connect-token` | requires header `x-opencode-ticket: 1` and `Origin` matching allowed CORS list | `{ location, data: { ticket, expires_in } }` | 400, 401, 403, 404 |
| GET | `/api/pty/{ptyID}/connect` | query `?ticket=…`, `?cursor=<n>`, `?location[directory/workspace]` | **WebSocket upgrade** (`x-websocket: true`); on missing pty returns 404, bad ticket returns 403 | 400, 401, 403, 404 |

`Pty.Info`:
```ts
{
  id, title, command, args, cwd, status: "running"|"exited", pid, exitCode?
}
```

`PtyTicket.ConnectToken`: `{ ticket: string, expires_in: number }`. Default
TTL is 60s (`packages/core/src/pty/ticket.ts`).

**PTY wire protocol** (`packages/core/src/pty/protocol.ts`):

- Server → client: UTF-8 text fragments of terminal output (chunked at 64 KB
  via `PtyProtocol.chunks`), plus a single control frame after replay:
  `0x00 + utf8(JSON.stringify({ cursor: <number> }))`. A `CloseEvent` with
  code `1000` is emitted on PTY exit, `4404` if the session was not found or
  exited by the time the WS opens.
- Client → server: UTF-8 text (terminal input, e.g. keystrokes) **or** binary
  (invalid UTF-8 is dropped).

### 6.10 Project Copy (experimental)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/experimental/project/{projectID}/copy` | `{ strategy, directory, name? }` | `ProjectCopy.Copy` (`{ directory }`) | 400 |
| DELETE | `/experimental/project/{projectID}/copy` | `{ directory, force }` | `204` | 400 |
| POST | `/experimental/project/{projectID}/copy/refresh` | – | `204` | 400 |

All take `?location[directory/workspace]`.

### 6.11 Non-`/api/...` routes (instance + root)

The OpenAPI spec exposes ~150+ additional paths under `/session/...`,
`/config/...`, `/file/...`, `/find/...`, `/formatter/...`, `/global/...`,
`/control/...`, `/controlPlane/...`, `/instance/...`, `/mcp/...`,
`/path/...`, `/project/...`, `/pty/...`, `/question/...`, `/permission/...`,
`/provider/...`, `/sync/...`, `/tool/...`, `/tui/...`, `/vcs/...`,
`/worktree/...`, `/workspace/...`, `/experimental/...`, etc.

The SDK exposes them under `client.<group>.<method>(...)` —
`client.session.*`, `client.global.*`, `client.config.*`,
`client.tool.*`, `client.find.*`, `client.file.*`, `client.path.*`,
`client.worktree.*`, `client.vcs.*`, `client.command.*`, `client.lsp.*`,
`client.formatter.*`, `client.mcp.*`, `client.project.*`, `client.pty.*`,
`client.question.*`, `client.permission.*`, `client.provider.*`,
`client.part.*`, `client.sync.*`, `client.tui.*`,
`client.experimental.*`. See `packages/sdk/js/src/v2/sdk.gen.ts` (≈7,200
lines) for the full per-method typing. The generated `OpencodeClient.v2.*`
namespace maps to the `/api/...` routes above.

---

## 7. Errors

All error responses are JSON objects with a `_tag` discriminator.
Sources: `packages/protocol/src/errors.ts` + `packages/server/src/middleware/schema-error.ts`.

| Status | `_tag` | Extra fields |
|---|---|---|
| 400 | `InvalidRequestError` | `message`, optional `kind`, optional `field` |
| 400 | `InvalidCursorError` | `message` |
| 401 | `UnauthorizedError` | `message` |
| 403 | `ForbiddenError` | `message` (e.g. PTY ticket without CORS) |
| 404 | `SessionNotFoundError` | `sessionID`, `message` |
| 404 | `MessageNotFoundError` | `sessionID`, `messageID`, `message` |
| 404 | `PermissionNotFoundError` | `requestID`, `message` |
| 404 | `QuestionNotFoundError` | `requestID`, `message` |
| 404 | `ProviderNotFoundError` | `providerID`, `message` |
| 404 | `PtyNotFoundError` | `ptyID`, `message` |
| 404 | `NotFoundError` (legacy, raw handler) | `message` |
| 409 | `ConflictError` | `message`, optional `resource` |
| 500 | `UnknownError` | `message`, optional `ref` (`err_<8-hex>`) |
| 503 | `ServiceUnavailableError` | `message`, optional `service` |

The schema-error middleware truncates reasons to 1024 characters before
returning.

---

## 8. SDK Client Surface (v2)

`packages/sdk/js/src/v2/sdk.gen.ts` (auto-generated by `@hey-api/openapi-ts`)
exposes the class hierarchy:

```ts
class OpencodeClient {
  auth, app, experimental, global, event, config, tool, worktree,
  find, file, instance, path, vcs, command, lsp, formatter, mcp,
  project, pty, question, permission, provider, session, part, sync,
  tui, v2
}

class V2 {
  health, location, agent, session, model, provider, integration,
  credential, permission, fs, command, skill, event, pty, question,
  reference, projectCopy
}
```

For each v2 method the SDK call shape matches exactly the type shown in §6
(e.g. `client.v2.session.prompt({ sessionID, id?, prompt, delivery?, resume? })`).

Entry point (`packages/sdk/js/src/v2/client.ts:50`):
```ts
createOpencodeClient({
  baseUrl?: string,                 // default "http://localhost:4096"
  directory?: string,               // → x-opencode-directory
  experimental_workspaceID?: string,// → x-opencode-workspace
  headers?, fetch?, throwOnError?
})
```

When `directory` is set, the request interceptor rewrites GETs from
`x-opencode-directory` to `?directory=…&location[directory]=…` so non-v2
(`/global/...`, `/session/...`) routes work without modification.

### Convenience helpers (`packages/sdk/js/src/v2/server.ts`)

- `createOpencodeServer({ hostname?, port?, timeout?, signal?, config? })`
  - Default `hostname = "127.0.0.1"`, `port = 4096`, `timeout = 5000ms`.
  - Spawns `opencode serve --hostname=… --port=… [--log-level=…]`, with
    `OPENCODE_CONFIG_CONTENT` set from `options.config`.
  - Parses stdout line `opencode server listening on http://…`.
  - Returns `{ url, close() }`.
- `createOpencode(options)` → `{ server, client }`.

### Process termination (`packages/sdk/js/src/process.ts`)

`stop(proc)` is a no-op once the child has exited; otherwise it
`taskkill /T /F` on Windows or `proc.kill()` elsewhere. `bindAbort` ties
`AbortSignal` abort and process exit to that cleanup.

### Error wrapping (`error-interceptor.ts`)

Only active with `throwOnError: true`. Non-`Error` payloads are wrapped into
`new Error(message, { cause: { body, status } })`. Empty bodies get a
synthesized `"empty response body"` / `"network error (no response)"`
message.

---

## 9. Session Lifecycle (end-to-end)

1. **Create**: `POST /api/session` with `{ agent?, model?, location? }` →
   `{ data: SessionV2Info }`. To pin a project, set `location.directory`
   (and `location.workspaceID` if you have one).
2. **Send a prompt**: `POST /api/session/{sessionID}/prompt`
   ```json
   {
     "prompt": { "text": "Hello", "files": [...], "agents": [...] },
     "delivery": "queue",         // or "steer"
     "resume": true,              // default; set false to admit without running the loop
     "id": "msg_<your-id>"        // optional durable id; collision → 409
   }
   ```
   Returns `{ data: SessionInput.Admitted }` synchronously — execution is
   **not** awaited by the response; stream `/api/event` or
   `/api/session/{sessionID}/event` to observe.
3. **Stream progress**: open `GET /api/event` (cross-session) or
   `GET /api/session/{sessionID}/event?after=<seq>` (replay from seq +
   live). Each event is a single SSE `message` frame with a JSON `data`
   payload. See §5.3.
4. **Wait for idle**: `POST /api/session/{sessionID}/wait` blocks until the
   agent loop is idle or returns `503` if compaction/wait is unavailable.
5. **Interrupt**: `POST /api/session/{sessionID}/interrupt`. Idle interrupt
   is a no-op.
6. **Manual compaction**: `POST /api/session/{sessionID}/compact`.
   Subscribe to `session.next.compaction.{started,delta,ended}` events.
7. **Revert**: stage a message boundary, then optionally clear or commit:
   ```
   POST /api/session/{sessionID}/revert/stage  body={ messageID, files? }
   POST /api/session/{sessionID}/revert/clear                       (drop)
   POST /api/session/{sessionID}/revert/commit                      (finalize)
   ```
8. **Tool permission flow**: server emits `permission.v2.asked` events.
   External code can also inject asks via `POST /api/session/{id}/permission`
   (returns `{ effect }`). Respond with
   `POST /api/session/{id}/permission/{requestID}/reply body={ reply: "once"|"always"|"reject", message? }`.
9. **Question flow**: `question.v2.asked` → `POST .../question/{requestID}/reply`
   body=`{ answers: [[labelA,labelB], [...]] }` or `.../reject`.

---

## 10. Examples

### 10.1 Raw HTTP client (Node 18+ `fetch`)

```ts
const base = "http://127.0.0.1:4096"
const auth = "Basic " + Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")
const headers = {
  "Authorization": auth,
  "x-opencode-directory": encodeURIComponent("/path/to/project"),
  "Content-Type": "application/json"
}

// Create session
const created = await fetch(`${base}/api/session`, {
  method: "POST",
  headers,
  body: JSON.stringify({ agent: "build", model: { id: "claude-3-5-sonnet", providerID: "anthropic" } })
}).then((r) => r.json())
const sessionID = created.data.id

// Send prompt
await fetch(`${base}/api/session/${sessionID}/prompt`, {
  method: "POST",
  headers,
  body: JSON.stringify({ prompt: { text: "Refactor foo() to use Result" } })
})

// Wait
await fetch(`${base}/api/session/${sessionID}/wait`, { method: "POST", headers })

// Read context (post-compaction)
const ctx = await fetch(`${base}/api/session/${sessionID}/context`, { headers }).then((r) => r.json())
console.log(ctx.data)
```

### 10.2 SSE listener

```ts
const sse = await fetch(`${base}/api/event`, {
  headers: { Authorization: auth, Accept: "text/event-stream" }
})
const reader = sse.body!.getReader()
const decoder = new TextDecoder()
let buf = ""
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buf.indexOf("\n\n")) !== -1) {
    const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
    const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("")
    if (!data || data.startsWith(":")) continue          // heartbeat or comment
    const evt = JSON.parse(data)                         // { id, type, data, ... }
    if (evt.type === "session.next.text.delta") process.stdout.write(evt.data.delta)
    if (evt.type === "permission.v2.asked") {
      await fetch(`${base}/api/session/${evt.data.sessionID}/permission/${evt.data.id}/reply`, {
        method: "POST", headers,
        body: JSON.stringify({ reply: "once" })
      })
    }
  }
}
```

### 10.3 PTY WebSocket (Node 22+)

```ts
// 1. Mint a ticket (requires CORS-allowed Origin and x-opencode-ticket header).
const tok = await fetch(`${base}/api/pty/${ptyID}/connect-token`, {
  method: "POST",
  headers: { ...headers, "x-opencode-ticket": "1", Origin: "http://localhost:5173" }
}).then((r) => r.json())
const ticket = tok.data.ticket

// 2. Open WS
const ws = new WebSocket(
  `ws://127.0.0.1:4096/api/pty/${ptyID}/connect?location[directory]=${encodeURIComponent(dir)}&ticket=${ticket}`
)
ws.onmessage = (ev) => {
  const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data
  if (data instanceof Uint8Array && data[0] === 0) {
    const meta = JSON.parse(new TextDecoder().decode(data.slice(1)))
    console.log("cursor after replay:", meta.cursor)
  } else {
    process.stdout.write(String(data))
  }
}
ws.onopen = () => ws.send("ls -la\n")                    // terminal input
```

### 10.4 SDK helper

```ts
import { createOpencode } from "@opencode-ai/sdk"

const { server, client } = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
  config: { /* full Config object, JSON-serialized into OPENCODE_CONFIG_CONTENT */ },
})

const session = await client.v2.session.create({
  body: { agent: "build" }
})
await client.v2.session.prompt({
  path: { sessionID: session.data.id },
  body: { prompt: { text: "Hi" } }
})
await client.v2.session.wait({ path: { sessionID: session.data.id } })

await server.close()
```

---

## 11. OpenAPI Spec Coverage

File: `/home/user/shenyaxuan/Maximilian/opencode/packages/sdk/openapi.json` (and
`packages/docs/openapi.json`, byte-identical). 36,949 lines, OpenAPI 3.1.0,
generated by `packages/opencode/src/cli/cmd/generate.ts` (runs
`Server.openapi()` → `OpenApi.fromApi(PublicApi)` and patches `x-codeSamples`).

The spec covers all 18 v2 groups (Health, Location, Agent, Session,
Message, Model, Provider, Integration, Credential, Permission, FS, Command,
Skill, Event, Pty, Question, Reference, ProjectCopy) plus the full
instance/root surface (config, control, experimental, file, find, formatter,
global, instance, mcp, part, path, permission(v1), project, provider,
question(v1), session(v1), sync, tool, tui, vcs, worktree, workspace, pty,
etc.). `/api/...` tags use `"opencode HttpApi"` *or* the legacy title
(e.g. `"events"`, `"sessions"`, `"messages"`, `"filesystem"`,
`"projectCopy"`, `"session questions"`, `"pty"`, `"commands"`,
`"integrations"`, `"providers"`, `"models"`, `"skills"`, `"permissions"`,
`"reference"`).

### 11.1 Generation flow

```
$ bun dev generate              # packages/opencode/src/cli/cmd/generate.ts
$ bun dev generate > openapi.json
$ bun ./script/build.ts         # packages/sdk/js/script/build.ts
```

The SDK build also patches:
- Numeric types on `session.history` `limit`/`after` (Hey-Api codegen bug).
- `SessionNext*1` orphan-component cleanup (only top-level reachable schemas
  are kept).
- `SseFn` second generic in `ServerSentEventsResult` (treats it as `void`).

### 11.2 Coverage gaps (observed vs. spec)

- **PTY connect protocol**: spec annotates `x-websocket: true` but does not
  document the `0x00 + JSON({cursor})` control frame or the 64 KB chunking.
  See `packages/core/src/pty/protocol.ts` for the wire format.
- **`x-opencode-ticket` header**: required on
  `POST /api/pty/{ptyID}/connect-token` but not surfaced as a documented
  parameter.
- **PTY connect query params**: `?cursor` (absolute output cursor for
  resume), `?ticket` (single-use ticket), and `?location[directory|workspace]`
  are listed in `additionalParameters` via the `OpenApi.transform`, but
  omitted from generated SDK signatures (`sdk.gen.ts:6783-6812` accepts
  them via the `query` literal).
- **`auth_token` query alternative** for browsers: not advertised in
  OpenAPI; visible only in source (`packages/server/src/middleware/authorization.ts:31`).
- **`x-opencode-directory`/`x-opencode-workspace` headers** on every
  request: documented in source but not as explicit `parameters` in the
  OpenAPI; the SDK rewriter
  (`packages/sdk/js/src/v2/client.ts:18-48`) handles them implicitly.
- **Live-only events** (e.g. `session.next.text.delta`,
  `session.next.reasoning.delta`, `session.next.tool.input.delta`,
  `session.next.compaction.delta`, `message.part.delta`) **are not** in
  the durable-history stream. The OpenAPI spec marks `SessionDurableEvent`
  via `SessionDurableEventStream = string`, but does not enumerate the
  delta variants.
- **503 + `service`** on `/api/session/{id}/compact` and `/api/session/{id}/wait`
  uses an internal `Session.OperationUnavailableError` tag that the v2
  surface maps to `ServiceUnavailableError`. The OpenAPI shape is correct
  but the mapping is buried in `packages/server/src/handlers/session.ts`.
- **Experimental routes** under `/experimental/...` not under `/api/...`:
  - `POST /experimental/project/{projectID}/copy/generate-name`
    (instance group; see `packages/opencode/src/server/routes/instance/httpapi/groups/project-copy.ts`)
    is in the spec but has **no SDK wrapper** in `sdk.gen.ts`.
  - `POST /experimental/console/switch`, `/experimental/console/orgs`,
    `/experimental/capabilities`, `/experimental/tool/ids`, etc., are in
    spec + SDK but exposed only via the `experimental.*` namespace.
- **Instance-scoped schema event envelopes** (the
  `EventManifest.Latest` union includes every event with `data` flattened
  under the envelope) are exposed as the `Event` schema in the public spec
  but the SDK does not export the Event class (`packages/sdk/openapi.json`
  maps it as a oneOf schema; `sdk.gen.ts` does not surface a typed helper).
- **No `Security` entries** for Basic auth in the public spec — auth is
  documented as runtime middleware only (`packages/opencode/src/server/routes/instance/httpapi/public.ts:147`).

---

## 12. Quick Reference Tables

### 12.1 ID prefixes

| Domain | Prefix |
|---|---|
| Event | `evt_` |
| Session | `ses_` |
| Session message | `msg_` |
| Permission (v2) | `per_` |
| Question (v2) | `que_` |
| Pty | `pty_` |
| Credential | `cred_` |
| Permission Saved | `psv_` |
| Workspace | (raw) |
| Project | (raw) |
| Provider | (raw) |
| Model | (raw) |
| Agent | (raw) |
| Plugin | (raw) |

### 12.2 Default ports

| Setting | Default |
|---|---|
| `opencode serve` port | `4096` (when `--port=0`; falls back to OS-assigned) |
| SDK `createOpencodeServer` | `4096`, `127.0.0.1` |
| SDK `createOpencodeClient` baseUrl | `http://localhost:4096` |
| PTY ticket TTL | 60s |
| SSE heartbeat | 15s |
| PTY replay chunk | 64 KB |
| Graceful shutdown timeout | 1 second |

### 12.3 Endpoint count by surface

| Surface | Routes |
|---|---|
| `/api/...` (v2) | 47 endpoints (18 groups) |
| `/session/...`, `/file/...`, `/mcp/...`, `/tool/...`, `/find/...`, `/project/...`, `/config/...`, etc. (instance) | ~120 endpoints |
| `/global/...`, `/control/...`, `/controlPlane/...` (root) | ~15 endpoints |
| `/experimental/...` | ~25 endpoints |
| **Total in OpenAPI** | ≈210 operations |

---

## 13. File Path Index

Use these paths to verify or extend the spec.

| Topic | Path |
|---|---|
| Server composition | `/home/user/shenyaxuan/Maximilian/opencode/packages/server/src/routes.ts` |
| Handlers (server side) | `/home/user/shenyaxuan/Maximilian/opencode/packages/server/src/handlers/{health,location,agent,session,message,model,provider,integration,credential,permission,fs,command,skill,event,pty,question,reference,project-copy}.ts` |
| Middleware | `/home/user/shenyaxuan/Maximilian/opencode/packages/server/src/middleware/{authorization,schema-error,session-location}.ts` |
| Auth helpers | `/home/user/shenyaxuan/Maximilian/opencode/packages/server/src/auth.ts`, `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/server/auth.ts` |
| Cors allowlist | `/home/user/shenyaxuan/Maximilian/opencode/packages/server/src/cors.ts` |
| Server entrypoint | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/server/server.ts` |
| CLI command | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/cli/cmd/serve.ts` |
| Network options | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/cli/network.ts` |
| Public OpenAPI factory | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/server/routes/instance/httpapi/public.ts` |
| V2 protocol (v2 routes) | `/home/user/shenyaxuan/Maximilian/opencode/packages/protocol/src/groups/*.ts` |
| V2 API composition | `/home/user/shenyaxuan/Maximilian/opencode/packages/protocol/src/api.ts` |
| Errors | `/home/user/shenyaxuan/Maximilian/opencode/packages/protocol/src/errors.ts` |
| Schemas | `/home/user/shenyaxuan/Maximilian/opencode/packages/schema/src/*.ts` |
| Event manifest | `/home/user/shenyaxuan/Maximilian/opencode/packages/schema/src/event-manifest.ts` |
| SDK v2 client | `/home/user/shenyaxuan/Maximilian/opencode/packages/sdk/js/src/v2/{client,server,data,index}.ts` |
| SDK v2 generated types | `/home/user/shenyaxuan/Maximilian/opencode/packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` |
| SDK v2 build script | `/home/user/shenyaxuan/Maximilian/opencode/packages/sdk/js/script/build.ts` |
| OpenAPI generation | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/cli/cmd/generate.ts` |
| Public OpenAPI JSON | `/home/user/shenyaxuan/Maximilian/opencode/packages/sdk/openapi.json` and `/home/user/shenyaxuan/Maximilian/opencode/packages/docs/openapi.json` |
| PTY wire protocol | `/home/user/shenyaxuan/Maximilian/opencode/packages/core/src/pty/protocol.ts` |
| PTY ticket store | `/home/user/shenyaxuan/Maximilian/opencode/packages/core/src/pty/ticket.ts` |
| WebSocket tracker | `/home/user/shenyaxuan/Maximilian/opencode/packages/opencode/src/server/routes/instance/httpapi/websocket-tracker.ts` |
| Env / Flag table | `/home/user/shenyaxuan/Maximilian/opencode/packages/core/src/flag/flag.ts` |
