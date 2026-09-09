// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodeAcpAdapter — translate ACP `agent/send` requests into opencode
 * SDK calls and map ACP `task.status` updates onto opencode
 * `session.status` events.
 *
 * Phase 4a wiring:
 *   - `translateSend()` turns an `AcpA2AMessage` whose `method` is
 *     `"agent/send"` into the input shape expected by
 *     `OpencodeSdk.sendPrompt()` from `@max/core-thin-sdk`.
 *   - `mapSessionStatus()` turns an opencode `SessionIdleEvent` /
 *     `SessionErrorEvent` / `SessionUpdatedEvent` into an ACP-shaped
 *     `task.status` payload suitable for handing to A2AHandler's
 *     `eventBus.publish`.
 *
 * 借鉴 opencode:
 *   - Event shapes mirror `docs/opencode-sdk-spec.md` §5.3 + §6.4
 *     (session.idle / session.status / session.error envelopes).
 *   - Session create + prompt flow lifted from `@max/core-thin-sdk`'s
 *     `OpencodeSdk.createSession` / `OpencodeSdk.sendPrompt`.
 *   - Per the spec, the opencode server only exposes `POST /api/session`
 *     + `POST /api/session/{id}/prompt` — there is no dedicated ACP
 *     bridge endpoint. We therefore *build* the equivalent opencode
 *     SDK calls locally rather than proxying through any v2 surface.
 */

import { OpencodeHttpClient, OpencodeSdk } from "@max/core-thin-sdk";
import type {
  A2AContent,
  A2ATaskState,
  AcpA2AMessage,
  AcpA2AResponse,
  AcpEvent,
} from "./acp/index.js";
import type { EventBus } from "./event-bus.js";
import type { AssistantMessage, Part, SessionMessage } from "@max/core-thin-sdk";

// ── Types ─────────────────────────────────────────────────────────────────

/** ACP `task.status` payload — a normalised view of an opencode event. */
export interface AcpTaskStatus {
  /** ACP task id (== A2A `params.taskId` if present, else sessionID). */
  taskId: string;
  /** sessionID this status update is for. */
  sessionID: string;
  /** Mirrored ACP task state. */
  state: A2ATaskState;
  /** Optional message — error text, completion summary, etc. */
  message?: string;
  /** Free-form payload (opencode event data). */
  data?: unknown;
  /** Epoch-ms when the update was synthesised. */
  timestamp: number;
}

/** Wire shape produced by `translateSend`. */
export interface AcpSendTranslation {
  /** Workspace / agent name to attach the session to. */
  agent: string;
  /** Optional title prefix; defaults to "acp-<taskId>". */
  title?: string;
  /** Text parts ready for `OpencodeSdk.sendPrompt`. */
  textParts: ReadonlyArray<{ type: "text"; text: string }>;
  /** Optional file parts lifted from ACP data parts. */
  fileParts: ReadonlyArray<{
    type: "file";
    mime: string;
    url: string;
    filename?: string;
  }>;
  /** Original A2A context id (used as parentID for sub-sessions). */
  contextId?: string;
  /** Original message id (forwarded for idempotency). */
  messageId?: string;
}

export interface OpencodeAcpAdapterOptions {
  /** Pre-built SDK client. Required. */
  client: OpencodeHttpClient;
  /** Event bus for emitting `task.status` events. Optional. */
  eventBus?: EventBus<AcpEvent>;
  /** Workspace id used for the opencode session's `x-opencode-directory`. */
  directory?: string;
  /**
   * When true, `runSend()` returns the SDK call's result without actually
   * waiting for an opencode server. Useful for unit tests that mock fetch.
   */
  dryRun?: boolean;
}

// ── Adapter ───────────────────────────────────────────────────────────────

/**
 * Adapter that turns ACP A2A `agent/send` envelopes into opencode SDK calls
 * and re-projects opencode session-status events back into ACP-shaped
 * `task.status` updates.
 */
export class OpencodeAcpAdapter {
  private readonly client: OpencodeHttpClient;
  private readonly eventBus?: EventBus<AcpEvent>;
  private readonly directory?: string;
  private readonly dryRun: boolean;

  /** sessionID ↔ taskId mapping for status lookups. */
  private readonly sessionTaskMap = new Map<string, string>();
  /** taskId ↔ sessionID mapping (reverse index). */
  private readonly taskSessionMap = new Map<string, string>();
  /** Per-session latest known state. */
  private readonly latestState = new Map<string, A2ATaskState>();

  constructor(opts: OpencodeAcpAdapterOptions) {
    if (!opts.client) {
      throw new Error("OpencodeAcpAdapter: `client` is required");
    }
    this.client = opts.client;
    this.eventBus = opts.eventBus;
    this.directory = opts.directory;
    this.dryRun = opts.dryRun ?? false;
  }

  // ── ACP → opencode ───────────────────────────────────────────────────

  /**
   * Translate an ACP `agent/send` message into the input shape expected by
   * the opencode SDK. Pure function — does not touch the wire.
   *
   * @throws when the message is malformed (missing parts, no text/data).
   */
  translateSend(msg: AcpA2AMessage): AcpSendTranslation {
    if (msg.method !== "agent/send") {
      throw new Error(
        `OpencodeAcpAdapter: only agent/send is supported (got ${msg.method})`,
      );
    }
    if (!msg.params?.content?.parts || msg.params.content.parts.length === 0) {
      throw new Error("OpencodeAcpAdapter: agent/send requires content.parts");
    }
    const content: A2AContent = msg.params.content;
    const textParts: Array<{ type: "text"; text: string }> = [];
    const fileParts: Array<{
      type: "file";
      mime: string;
      url: string;
      filename?: string;
    }> = [];
    for (const part of content.parts) {
      if (part.kind === "text") {
        textParts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.kind === "data") {
        const v = part.value as Record<string, unknown> | undefined;
        if (
          v &&
          typeof v.uri === "string" &&
          typeof v.mime === "string"
        ) {
          // File-like data part → push as a file part only; don't echo
          // it back into the text section (otherwise the LLM would see
          // the file metadata twice).
          fileParts.push({
            type: "file",
            mime: v.mime,
            url: v.uri,
            ...(typeof v.name === "string" ? { filename: v.name } : {}),
          });
          continue;
        }
        // Non-file data parts are folded into the text section as JSON
        // so the opencode-side prompt still receives them.
        textParts.push({
          type: "text",
          text: `[data] ${JSON.stringify(v ?? {})}`,
        });
      }
    }
    if (textParts.length === 0 && fileParts.length === 0) {
      throw new Error("OpencodeAcpAdapter: agent/send produced no usable parts");
    }
    return {
      agent: msg.params.to,
      title: msg.params.taskId ? `acp-${msg.params.taskId}` : undefined,
      textParts,
      fileParts,
      ...(msg.params.contextId ? { contextId: msg.params.contextId } : {}),
      ...(msg.params.messageId ? { messageId: msg.params.messageId } : {}),
    };
  }

  /**
   * Run a translated `agent/send` through the opencode SDK. Creates a
   * session (or reuses one if `taskId` is already known), sends the prompt,
   * waits for completion, and returns the resulting assistant message.
   *
   * In `dryRun` mode the SDK calls are skipped — useful for unit tests
   * that mock fetch and want to verify only the translation path.
   */
  async runSend(
    msg: AcpA2AMessage,
  ): Promise<{ response: AcpA2AResponse; sessionID: string; assistant?: AssistantMessage }> {
    const translation = this.translateSend(msg);
    // H7-fix: previously we folded taskId → messageId → id → agent
    // in sequence, silently inventing a "taskId" from the agent role
    // when all explicit IDs were missing. That collapsed two
    // unrelated A2A requests from the same agent into a single
    // session, hiding bugs and corrupting routing. Now we reject
    // explicitly when no real ID is supplied.
    const taskId =
      msg.params.taskId ?? msg.params.messageId ?? msg.id ?? null;
    if (!taskId) {
      throw new Error(
        `OpencodeAcpAdapter.runSend: missing taskId (params.taskId=${String(
          msg.params.taskId,
        )}, params.messageId=${String(msg.params.messageId)}, id=${String(msg.id)})`,
      );
    }
    const existingSessionID = this.taskSessionMap.get(taskId);

    if (this.dryRun) {
      const stubSessionID = existingSessionID ?? `ses_dry_${taskId}`;
      this.sessionTaskMap.set(stubSessionID, taskId);
      this.taskSessionMap.set(taskId, stubSessionID);
      this.latestState.set(stubSessionID, "submitted");
      this.publishTaskStatus({
        taskId,
        sessionID: stubSessionID,
        state: "submitted",
        timestamp: Date.now(),
      });
      return {
        sessionID: stubSessionID,
        response: {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            delivered: true,
            status: "submitted",
            classified: "acp-send-dry-run",
          },
        },
      };
    }

    let sessionID = existingSessionID;
    if (!sessionID) {
      const session = await OpencodeSdk.createSession(this.client, {
        ...(translation.title ? { title: translation.title } : {}),
        agent: translation.agent,
      });
      sessionID = session.id;
      this.sessionTaskMap.set(sessionID, taskId);
      this.taskSessionMap.set(taskId, sessionID);
      this.latestState.set(sessionID, "working");
      this.publishTaskStatus({
        taskId,
        sessionID,
        state: "working",
        timestamp: Date.now(),
      });
    }

    try {
      const result = await OpencodeSdk.sendPrompt(this.client, sessionID, {
        parts: [...translation.textParts, ...translation.fileParts],
        agent: translation.agent,
        ...(translation.messageId ? { id: translation.messageId } : {}),
      });
      this.latestState.set(sessionID, "completed");
      this.publishTaskStatus({
        taskId,
        sessionID,
        state: "completed",
        message: extractFirstText(result.info) ?? undefined,
        data: result.info,
        timestamp: Date.now(),
      });
      return {
        sessionID,
        assistant: result.info,
        response: {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            delivered: true,
            status: "completed",
            data: result.info,
            classified: "acp-send-success",
          },
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.latestState.set(sessionID, "failed");
      this.publishTaskStatus({
        taskId,
        sessionID,
        state: "failed",
        message,
        timestamp: Date.now(),
      });
      return {
        sessionID,
        response: {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            delivered: false,
            status: "failed",
            message,
            classified: "acp-send-failed",
          },
        },
      };
    }
  }

  // ── opencode → ACP ───────────────────────────────────────────────────

  /**
   * Map an opencode SSE event envelope (anything flowing through
   * `subscribeEvents`) to an ACP `task.status` payload, when applicable.
   * Returns `null` for events that have no ACP counterpart — callers can
   * safely drop these.
   */
  mapSessionStatus(
    event: {
      type?: string;
      sessionID?: string;
      data?: unknown;
      timestamp?: number;
    },
  ): AcpTaskStatus | null {
    if (!event?.type) return null;
    const sessionID = readString(event.sessionID);
    if (!sessionID) return null;
    const taskId = this.sessionTaskMap.get(sessionID) ?? sessionID;
    const ts =
      typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
        ? event.timestamp
        : Date.now();

    switch (event.type) {
      case "session.idle":
      case "session.status": {
        const status = extractStatus(event.data);
        const state = idleStatusToState(status);
        this.latestState.set(sessionID, state);
        return {
          taskId,
          sessionID,
          state,
          message: status?.message,
          data: event.data,
          timestamp: ts,
        };
      }
      case "session.error": {
        const message = extractErrorMessage(event.data);
        this.latestState.set(sessionID, "failed");
        return {
          taskId,
          sessionID,
          state: "failed",
          message,
          data: event.data,
          timestamp: ts,
        };
      }
      case "session.updated":
      case "session.created": {
        // The session lifecycle itself is not an ACP state change but it
        // is useful for clients that subscribe to status.
        return {
          taskId,
          sessionID,
          state: this.latestState.get(sessionID) ?? "working",
          message: "session updated",
          data: event.data,
          timestamp: ts,
        };
      }
      case "session.compacted":
        return {
          taskId,
          sessionID,
          state: this.latestState.get(sessionID) ?? "working",
          message: "session compacted",
          data: event.data,
          timestamp: ts,
        };
      default:
        return null;
    }
  }

  /**
   * Convenience: translate a list of `SessionMessage`s (assistant /
   * user messages) into a stream of `task.status` updates for the A2A
   * handler to publish. Mostly used by the EventBridge when reconciling
   * session history.
   */
  mapMessagesToStatuses(
    sessionID: string,
    messages: ReadonlyArray<SessionMessage>,
  ): AcpTaskStatus[] {
    const taskId = this.sessionTaskMap.get(sessionID) ?? sessionID;
    const out: AcpTaskStatus[] = [];
    let lastState: A2ATaskState = this.latestState.get(sessionID) ?? "working";
    for (const m of messages) {
      if (m.role === "assistant") {
        lastState = "completed";
        out.push({
          taskId,
          sessionID,
          state: "completed",
          message: extractAssistantText(m.parts),
          data: m,
          timestamp: m.time.completed ?? Date.now(),
        });
      }
    }
    this.latestState.set(sessionID, lastState);
    return out;
  }

  // ── Introspection ────────────────────────────────────────────────────

  /** Latest known state for a session (read-only view). */
  latestStateFor(sessionID: string): A2ATaskState | undefined {
    return this.latestState.get(sessionID);
  }

  /** taskId ↔ sessionID mapping (frozen copy). */
  bindings(): Array<{ taskId: string; sessionID: string }> {
    const out: Array<{ taskId: string; sessionID: string }> = [];
    for (const [taskId, sessionID] of this.taskSessionMap) {
      out.push({ taskId, sessionID });
    }
    return out;
  }

  /** Forget all session/task bindings (test isolation helper). */
  reset(): void {
    this.sessionTaskMap.clear();
    this.taskSessionMap.clear();
    this.latestState.clear();
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private publishTaskStatus(status: AcpTaskStatus): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.publish({
        type: "agent/status",
        payload: status,
        sessionId: status.sessionID,
        timestamp: status.timestamp,
      });
    } catch {
      /* event-bus isolates */
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function readString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function extractStatus(data: unknown): { message?: string } | undefined {
  const obj = readObject(data);
  if (!obj) return undefined;
  const status = readObject(obj.status);
  if (!status) return { message: undefined };
  return { message: readString(status.message) };
}

function extractErrorMessage(data: unknown): string | undefined {
  const obj = readObject(data);
  if (!obj) return undefined;
  const err = readObject(obj.error);
  return readString(err?.message) ?? readString(obj.message);
}

function idleStatusToState(
  status: { message?: string } | undefined,
): A2ATaskState {
  // opencode currently only emits "idle" here, but reserve headroom for
  // future `retry` / `busy` variants surfaced via `session.status`.
  return "completed";
}

function extractFirstText(msg: AssistantMessage | undefined): string | undefined {
  if (!msg?.parts) return undefined;
  for (const part of msg.parts) {
    if (part.type === "text") {
      const t = part.text;
      if (typeof t === "string" && t.length > 0) return t;
    }
  }
  return undefined;
}

function extractAssistantText(parts: ReadonlyArray<Part> | undefined): string | undefined {
  if (!parts) return undefined;
  for (const part of parts) {
    if (part.type === "text") {
      const t = part.text;
      if (typeof t === "string" && t.length > 0) return t;
    }
  }
  return undefined;
}