// sdk.ts — typed method surface mirroring opencode v2 routes
// 借鉴 opencode: SDK shape lifted from packages/sdk/js/src/v2/sdk.gen.ts;
// v2 routes are documented in docs/opencode-sdk-spec.md §6.

import type { OpencodeHttpClient } from "./client.js";
import type {
  EventEnvelope,
  HealthResponse,
  PromptAdmitted,
  SendPromptResult,
  Session,
  SessionCreateInput,
  SessionListResponse,
  SessionMessage,
  SessionPromptInput,
  StreamEvent,
  TextPart,
  FilePart,
  Part,
  AssistantMessage,
} from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert caller-facing `parts` into the v2 `prompt` shape. */
function partsToPrompt(parts: SessionPromptInput["parts"]): {
  text: string;
  files?: PromptAdmitted["prompt"]["files"];
  agents?: PromptAdmitted["prompt"]["agents"];
} {
  const texts: string[] = [];
  const files: NonNullable<PromptAdmitted["prompt"]["files"]> = [];
  const agents: NonNullable<PromptAdmitted["prompt"]["agents"]> = [];
  for (const p of parts) {
    switch (p.type) {
      case "text":
        texts.push((p as TextPart).text);
        break;
      case "file": {
        const fp = p as FilePart;
        files.push({ uri: fp.url, mime: fp.mime, name: fp.filename });
        break;
      }
      case "agent":
        agents.push({ name: p.name });
        break;
    }
  }
  return {
    text: texts.join("\n"),
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  };
}

function unwrapData<T>(wrapper: { data: T } | T): T {
  // Some opencode endpoints wrap responses as `{ data: ... }`; tolerate raw shapes too.
  if (wrapper && typeof wrapper === "object" && "data" in (wrapper as object)) {
    return (wrapper as { data: T }).data;
  }
  return wrapper as T;
}

function messagePath(sessionID: string, suffix = ""): string {
  return `/api/session/${encodeURIComponent(sessionID)}${suffix}`;
}

// ── Health ─────────────────────────────────────────────────────────────────

/** GET /api/health → ping. 借鉴 opencode: server.health. */
export async function health(client: OpencodeHttpClient): Promise<HealthResponse> {
  return client.get<HealthResponse>("/api/health");
}

// ── Session CRUD ───────────────────────────────────────────────────────────

/** POST /api/session → create a new session. 借鉴 opencode: v2.session.create. */
export async function createSession(
  client: OpencodeHttpClient,
  opts: SessionCreateInput = {},
): Promise<Session> {
  const body: Record<string, unknown> = {};
  if (opts.parentID !== undefined) body.parentID = opts.parentID;
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.agent !== undefined) body.agent = opts.agent;
  if (opts.model !== undefined) body.model = opts.model;
  const res = await client.post<{ data: Session } | Session>("/api/session", body);
  return unwrapData(res);
}

/** GET /api/session/{id} → fetch a session by id. */
export async function getSession(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<Session> {
  const res = await client.get<{ data: Session } | Session>(messagePath(sessionID));
  return unwrapData(res);
}

/** GET /api/session → list sessions. */
export async function listSessions(
  client: OpencodeHttpClient,
): Promise<Session[]> {
  const res = await client.get<SessionListResponse | Session[]>(
    "/api/session",
  );
  if (Array.isArray(res)) return res;
  return res.data;
}

/** DELETE /api/session/{id} → delete a session. */
export async function deleteSession(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<void> {
  await client.delete<void>(messagePath(sessionID));
}

// ── Prompting ──────────────────────────────────────────────────────────────

/**
 * POST /api/session/{id}/prompt → submit a prompt, wait for the session to
 * settle, then return the latest assistant message + its parts.
 *
 * Non-streaming from the caller's perspective; uses the `/wait` long-poll to
 * know when to fetch the response message. For real-time deltas, use
 * {@link streamPrompt} instead.
 */
export async function sendPrompt(
  client: OpencodeHttpClient,
  sessionID: string,
  opts: SessionPromptInput,
): Promise<SendPromptResult> {
  const body: Record<string, unknown> = {
    prompt: partsToPrompt(opts.parts),
  };
  if (opts.id !== undefined) body.id = opts.id;
  if (opts.delivery !== undefined) body.delivery = opts.delivery;
  if (opts.resume !== undefined) body.resume = opts.resume;
  if (opts.model !== undefined) {
    body.model = { id: opts.model.modelID, providerID: opts.model.providerID };
  }
  if (opts.agent !== undefined) body.agent = opts.agent;

  await client.post(messagePath(sessionID, "/prompt"), body);

  // Block on the server until the agent loop becomes idle, then fetch the
  // last message.
  await client.post(messagePath(sessionID, "/wait"), {});

  const messages = await listMessages(client, sessionID);
  // listMessages returns most-recent-last in our impl; the assistant message
  // is the trailing one (if any).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      return {
        info: m as AssistantMessage,
        parts: (m as AssistantMessage).parts,
      };
    }
  }
  return { info: undefined as unknown as AssistantMessage, parts: [] };
}

/**
 * Subscribe to the session-scoped SSE stream and POST the prompt on the
 * next iteration. Returns an async iterable of stream events; the iterable
 * ends when the caller breaks out (e.g. after a `session.idle` event).
 */
export async function *streamPrompt(
  client: OpencodeHttpClient,
  sessionID: string,
  opts: SessionPromptInput,
  signal?: AbortSignal,
): AsyncIterable<EventEnvelope<StreamEvent>> {
  // Submit the prompt first (best-effort); events flow from the global
  // /api/event stream the caller would also have open via subscribeEvents.
  // Here we stream the per-session event channel so the caller only sees
  // events for `sessionID`.
  await client.post(messagePath(sessionID, "/prompt"), {
    prompt: partsToPrompt(opts.parts),
    delivery: opts.delivery,
    resume: opts.resume,
    id: opts.id,
  });

  yield* client.stream<StreamEvent>(messagePath(sessionID, "/event"), signal);
}

// ── Session operations ─────────────────────────────────────────────────────

/** POST /api/session/{id}/compact → request manual compaction. */
export async function compactSession(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<void> {
  await client.post<void>(messagePath(sessionID, "/compact"), {});
}

/** POST /api/session/{id}/abort → abort the running session loop. */
export async function abortSession(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<void> {
  await client.post<void>(messagePath(sessionID, "/abort"), {});
}

/** POST /api/session/{id}/revert → revert the session to the named message. */
export async function revertMessage(
  client: OpencodeHttpClient,
  sessionID: string,
  messageID: string,
): Promise<void> {
  await client.post<void>(messagePath(sessionID, "/revert"), { messageID });
}

/** POST /api/session/{id}/wait → block until the session becomes idle. */
export async function waitSession(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<void> {
  await client.post<void>(messagePath(sessionID, "/wait"), {});
}

/** GET /api/session/{id}/message → list messages on a session. */
export async function listMessages(
  client: OpencodeHttpClient,
  sessionID: string,
): Promise<SessionMessage[]> {
  const res = await client.get<{ data: SessionMessage[] } | SessionMessage[]>(
    messagePath(sessionID, "/message"),
  );
  if (Array.isArray(res)) return res;
  return res.data;
}

// ── Event streaming ────────────────────────────────────────────────────────

/**
 * Subscribe to the global /api/event SSE stream. Iterates until the caller
 * breaks or `signal` aborts. First event is always `server.connected`.
 */
export async function *subscribeEvents(
  client: OpencodeHttpClient,
  query?: { directory?: string },
  signal?: AbortSignal,
): AsyncIterable<EventEnvelope<StreamEvent>> {
  let path = "/api/event";
  if (query?.directory) {
    path += `?directory=${encodeURIComponent(query.directory)}`;
  }
  yield* client.stream<StreamEvent>(path, signal);
}

// ── Namespace export ──────────────────────────────────────────────────────
// Mirroring the opencode v2 SDK where `client.v2.session.*` is a namespace,
// expose the surface as `OpencodeSdk.*` (consumer calls `OpencodeSdk.health(c)`).

export const OpencodeSdk = {
  health,
  createSession,
  getSession,
  listSessions,
  deleteSession,
  sendPrompt,
  streamPrompt,
  compactSession,
  abortSession,
  revertMessage,
  waitSession,
  listMessages,
  subscribeEvents,
} as const;

// Useful type re-exports for consumers that only want the surface types.
export type { Part, SendPromptResult, SessionPromptInput, SessionCreateInput };
