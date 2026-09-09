# @max/core-thin-sdk

A thin HTTP + SSE client for the [opencode](https://opencode.ai) server protocol
(`opencode serve`). Designed for Maximilian to talk to `opencode serve` without
depending on the upstream `@opencode-ai/sdk` package.

## Highlights

- **Zero runtime dependencies** — uses native `fetch` (Node 18+) and `AbortSignal`.
- **Strict TypeScript** — every route, request, response, and event is typed.
- **SSE streaming** — `streamPrompt` and `subscribeEvents` return `AsyncIterable`s
  parsed from `text/event-stream` frames.
- **Built-in session pool** — `SessionPool` caches opencode sessions per
  workspace with LRU eviction and TTL.
- **Typed errors** — `UnauthorizedError`, `NotFoundError`, `InvalidRequestError`,
  `ServiceUnavailableError` all derive from `OpencodeError`.

## Quickstart

```ts
import { OpencodeHttpClient, SessionPool, OpencodeSdk } from "@max/core-thin-sdk";

const client = new OpencodeHttpClient({
  baseUrl: "http://127.0.0.1:4096",
  directory: "/path/to/project",
  auth: { username: "opencode", password: process.env.OPENCODE_SERVER_PASSWORD! },
});

const pool = new SessionPool(client, { maxSessions: 16, ttlMs: 30 * 60 * 1000 });

const session = await pool.getOrCreate("ws-1");
const { info, parts } = await OpencodeSdk.sendPrompt(client, session.id, {
  parts: [{ type: "text", text: "Refactor foo() to use Result" }],
});

await pool.shutdown();
```

## Layout

| File | Purpose |
|---|---|
| `src/client.ts` | `OpencodeHttpClient` — raw `fetch` wrapper (auth, headers, error parsing, SSE). |
| `src/sdk.ts` | Typed method surface mirroring opencode v2 routes. |
| `src/session-pool.ts` | `SessionPool` — per-workspace session cache. |
| `src/types.ts` | Request/response/event schemas. |
| `src/errors.ts` | Typed error classes. |
| `src/index.ts` | Public barrel. |

## Conventions

Comments prefixed `借鉴 opencode` mark patterns lifted from the opencode
codebase (`packages/sdk/js/src/v2/`). The HTTP wire format mirrors
`docs/opencode-sdk-spec.md`.
