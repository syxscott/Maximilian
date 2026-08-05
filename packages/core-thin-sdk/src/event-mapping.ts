/**
 * event-mapping.ts — typed mapping table from opencode SSE event types to
 * Maximilian `StoredEvent` shapes.
 *
 * 借鉴 opencode: source-of-truth envelope schema lives in
 * `packages/sdk/js/src/v2/gen/types.gen.ts` and `docs/opencode-sdk-spec.md`
 * §5.3 — every event from the `/api/event` SSE stream is wrapped in an
 * envelope `{ id, type, data, metadata?, durable?, location? }`.
 *
 * Goal: lift the 25 most operationally-significant opencode events into a
 * normalized `StoredEvent` shape so downstream reducers / projections
 * (`workspaceStatusReducer` etc.) can consume a single, stable vocabulary.
 * Anything unmapped falls through to `unknown:{type}` rather than being
 * silently dropped — that way an unmapped event is observable in the log
 * without halting the bridge.
 */

import type { StoredEvent } from "@max/core";

/**
 * A subset of the opencode event envelope that mappers consume.
 * Narrower than `EventEnvelope<unknown>` so we don't pin ourselves to
 * opencode's full schema inside the bridge.
 */
export interface OpencodeEvent {
  /** "evt_<ascending>"; empty string if the server omits it. */
  id?: string;
  /** Discriminator, e.g. "session.next.text.delta". */
  type: string;
  /** Payload; shape is type-specific. */
  data?: unknown;
  /** Optional metadata key/value bag. */
  metadata?: Record<string, unknown>;
  /** Optional durable-hint (aggregate / seq / version). */
  durable?: { aggregateID: string; seq: number; version: number };
  /** Optional location hint (directory / workspaceID). */
  location?: { directory?: string; workspaceID?: string };
}

/**
 * The shape a mapper must produce. The bridge fills in `id`, `timestamp`,
 * and `seq` via `EventStore.append`; the mapper only chooses `type`,
 * `aggregateId`, and `data`.
 */
export interface MappedEventDraft {
  type: string;
  aggregateId: string;
  data: unknown;
}

/**
 * A single row in the opencode → Maximilian mapping table.
 */
export interface OpencodeEventMapping {
  opencodeType: string;
  /** Maximilian event type (becomes `StoredEvent.type`). */
  maxType: string;
  mapper: (event: OpencodeEvent) => MappedEventDraft;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Resolve the `aggregateId` from an opencode event:
 *   1. `location.workspaceID` if set on the envelope,
 *   2. `data.sessionID` if set on the payload,
 *   3. the `workspaceIdHint` fallback provided by the bridge.
 */
function resolveAggregateId(
  event: OpencodeEvent,
  payload: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const fromLocation = event.location?.workspaceID;
  if (fromLocation) return fromLocation;
  const fromSession = payload ? readString(payload.sessionID) : undefined;
  if (fromSession) return fromSession;
  return fallback;
}

/**
 * Strip the v1/v2 noise and pull out the payload we want the mapper
 * to operate on. Always returns an object (empty if `data` was missing).
 */
function payloadOf(event: OpencodeEvent): Record<string, unknown> {
  return readObject(event.data) ?? {};
}

// ── per-event mappers ───────────────────────────────────────────────────────

function mapMessageDelta(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "message:delta",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.assistantMessageID) ?? readString(data.messageID),
      textID: readString(data.textID),
      delta: readString(data.delta),
    },
  };
}

function mapMessagePart(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "message:part",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.messageID),
      partID: readString(data.partID) ?? readString(data.textID),
      part: data.part ?? data,
    },
  };
}

function mapToolCalled(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "tool:called",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.assistantMessageID) ?? readString(data.messageID),
      callID: readString(data.callID),
      tool: readString(data.tool),
      input: data.input,
      provider: readObject(data.provider),
    },
  };
}

function mapToolProgress(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "tool:progress",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.assistantMessageID) ?? readString(data.messageID),
      callID: readString(data.callID),
      structured: data.structured,
      content: data.content,
    },
  };
}

function mapToolSuccess(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "tool:success",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.assistantMessageID) ?? readString(data.messageID),
      callID: readString(data.callID),
      structured: data.structured,
      content: data.content,
      outputPaths: data.outputPaths,
      result: data.result,
      provider: readObject(data.provider),
    },
  };
}

function mapToolFailed(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "tool:failed",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.assistantMessageID) ?? readString(data.messageID),
      callID: readString(data.callID),
      error: data.error,
      result: data.result,
      provider: readObject(data.provider),
    },
  };
}

function mapMessageUser(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "message:user",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.messageID),
      prompt: data.prompt,
      delivery: readString(data.delivery),
    },
  };
}

function mapCompactionStart(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "compaction:start",
    aggregateId: resolveAggregateId(event, data, "global"),
    data: {
      sessionID: readString(data.sessionID),
      messageID: readString(data.messageID),
      reason: readString(data.reason),
    },
  };
}

function mapCompactionDone(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "compaction:done",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      sessionID: readString(data.sessionID),
    },
  };
}

function mapSessionError(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "session:error",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      sessionID: readString(data.sessionID),
      error: data.error,
    },
  };
}

function mapSessionIdle(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  const sessionID = readString(data.sessionID) ?? "global";
  return {
    type: "session:idle",
    aggregateId: resolveAggregateId(event, data, sessionID),
    data: { sessionID },
  };
}

function mapSessionStatus(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  const status = readObject(data.status) ?? {};
  return {
    type: "session:status",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      sessionID: readString(data.sessionID),
      statusType: readString(status.type),
      attempt: readNumber(status.attempt),
      message: readString(status.message),
    },
  };
}

function mapPermissionAsked(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "permission:asked",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      requestID: readString(data.id) ?? readString(data.requestID),
      sessionID: readString(data.sessionID),
      action: readString(data.action),
      permission: readString(data.permission),
      patterns: data.patterns,
      resources: data.resources,
      save: data.save,
      metadata: readObject(data.metadata),
      source: readObject(data.source),
      always: data.always,
      tool: readObject(data.tool),
    },
  };
}

function mapPermissionReplied(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "permission:replied",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      requestID: readString(data.requestID),
      sessionID: readString(data.sessionID),
      reply: readString(data.reply),
    },
  };
}

function mapQuestion(event: OpencodeEvent, type: string): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type,
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      requestID: readString(data.id) ?? readString(data.requestID),
      sessionID: readString(data.sessionID),
      questions: data.questions,
      answers: data.answers,
      tool: readObject(data.tool),
    },
  };
}

function mapTodoUpdated(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "todo:updated",
    aggregateId: resolveAggregateId(event, data, readString(data.sessionID) ?? "global"),
    data: {
      sessionID: readString(data.sessionID),
      todos: data.todos,
    },
  };
}

function mapLspUpdated(event: OpencodeEvent): MappedEventDraft {
  return {
    type: "lsp:updated",
    aggregateId: event.location?.workspaceID ?? "global",
    data: { metadata: readObject(event.metadata) ?? {} },
  };
}

function mapMcpToolsChanged(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "mcp:tools:changed",
    aggregateId: event.location?.workspaceID ?? "global",
    data: { server: readString(data.server), raw: data },
  };
}

function mapPtyCreated(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  const info = readObject(data.info) ?? {};
  return {
    type: "pty:created",
    aggregateId: event.location?.workspaceID ?? "global",
    data: {
      id: readString(info.id),
      title: readString(info.title),
      command: readString(info.command),
      pid: readNumber(info.pid),
    },
  };
}

function mapPtyExited(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "pty:exited",
    aggregateId: event.location?.workspaceID ?? "global",
    data: {
      id: readString(data.id),
      exitCode: readNumber(data.exitCode),
    },
  };
}

function mapWorkspaceReady(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "workspace:ready",
    aggregateId: event.location?.workspaceID ?? "global",
    data: { name: readString(data.name), raw: data },
  };
}

function mapWorkspaceFailed(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "workspace:failed",
    aggregateId: event.location?.workspaceID ?? "global",
    data: { message: readString(data.message), raw: data },
  };
}

function mapWorkspaceStatus(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: "workspace:status",
    aggregateId: readString(data.workspaceID) ?? event.location?.workspaceID ?? "global",
    data: {
      workspaceID: readString(data.workspaceID),
      status: readString(data.status),
    },
  };
}

function mapServerConnected(event: OpencodeEvent): MappedEventDraft {
  return {
    type: "server:connected",
    aggregateId: event.location?.workspaceID ?? "global",
    data: { id: readString(event.id), metadata: readObject(event.metadata) ?? {} },
  };
}

/**
 * Fallback mapper: emit an `unknown:*` event so we never silently drop.
 */
function mapUnknown(event: OpencodeEvent): MappedEventDraft {
  const data = payloadOf(event);
  return {
    type: `unknown:${event.type}`,
    aggregateId: resolveAggregateId(
      event,
      data,
      event.location?.workspaceID ?? "global",
    ),
    data: { opencodeType: event.type, payload: data },
  };
}

// ── the mapping table ───────────────────────────────────────────────────────

/**
 * Top-25 opencode events → Maximilian `StoredEvent` shapes.
 *
 * The order of entries matters: the first matching `opencodeType` wins.
 * For events with multiple variants (e.g. `permission.asked` v1 vs v2),
 * we keep one canonical entry each — variants are aliased via the bridge's
 * `mapperFor()` resolver.
 */
export const OPENCODE_EVENT_MAP: ReadonlyArray<OpencodeEventMapping> = Object.freeze([
  // ── session lifecycle (live + durable) ──
  {
    opencodeType: "session.next.text.delta",
    maxType: "message:delta",
    mapper: mapMessageDelta,
  },
  {
    opencodeType: "session.next.text.part",
    maxType: "message:part",
    mapper: mapMessagePart,
  },
  {
    opencodeType: "message.part.delta",
    maxType: "message:part",
    mapper: mapMessagePart,
  },
  {
    opencodeType: "message.part.updated",
    maxType: "message:part",
    mapper: mapMessagePart,
  },
  {
    opencodeType: "message.updated",
    maxType: "message:part",
    mapper: mapMessagePart,
  },
  {
    opencodeType: "session.next.user.message",
    maxType: "message:user",
    mapper: mapMessageUser,
  },
  {
    opencodeType: "session.next.prompted",
    maxType: "message:user",
    mapper: mapMessageUser,
  },
  {
    opencodeType: "session.next.prompt.admitted",
    maxType: "message:user",
    mapper: mapMessageUser,
  },

  // ── tool calls ──
  {
    opencodeType: "session.next.tool.called",
    maxType: "tool:called",
    mapper: mapToolCalled,
  },
  {
    opencodeType: "session.next.tool.input.started",
    maxType: "tool:called",
    mapper: mapToolCalled,
  },
  {
    opencodeType: "session.next.tool.progress",
    maxType: "tool:progress",
    mapper: mapToolProgress,
  },
  {
    opencodeType: "session.next.tool.success",
    maxType: "tool:success",
    mapper: mapToolSuccess,
  },
  {
    opencodeType: "session.next.tool.failed",
    maxType: "tool:failed",
    mapper: mapToolFailed,
  },

  // ── compaction ──
  {
    opencodeType: "session.next.compaction.started",
    maxType: "compaction:start",
    mapper: mapCompactionStart,
  },
  {
    opencodeType: "session.next.compaction.start",
    maxType: "compaction:start",
    mapper: mapCompactionStart,
  },
  {
    opencodeType: "session.compacted",
    maxType: "compaction:done",
    mapper: mapCompactionDone,
  },

  // ── session status / errors ──
  {
    opencodeType: "session.error",
    maxType: "session:error",
    mapper: mapSessionError,
  },
  {
    opencodeType: "session.idle",
    maxType: "session:idle",
    mapper: mapSessionIdle,
  },
  {
    opencodeType: "session.status",
    maxType: "session:status",
    mapper: mapSessionStatus,
  },

  // ── permission (v1 + v2) ──
  {
    opencodeType: "permission.v2.asked",
    maxType: "permission:asked",
    mapper: mapPermissionAsked,
  },
  {
    opencodeType: "permission.asked",
    maxType: "permission:asked",
    mapper: mapPermissionAsked,
  },
  {
    opencodeType: "permission.v2.replied",
    maxType: "permission:replied",
    mapper: mapPermissionReplied,
  },
  {
    opencodeType: "permission.replied",
    maxType: "permission:replied",
    mapper: mapPermissionReplied,
  },

  // ── questions (v1 + v2) ──
  {
    opencodeType: "question.v2.asked",
    maxType: "question:asked",
    mapper: (e) => mapQuestion(e, "question:asked"),
  },
  {
    opencodeType: "question.asked",
    maxType: "question:asked",
    mapper: (e) => mapQuestion(e, "question:asked"),
  },
  {
    opencodeType: "question.v2.replied",
    maxType: "question:replied",
    mapper: (e) => mapQuestion(e, "question:replied"),
  },
  {
    opencodeType: "question.replied",
    maxType: "question:replied",
    mapper: (e) => mapQuestion(e, "question:replied"),
  },
  {
    opencodeType: "question.v2.rejected",
    maxType: "question:rejected",
    mapper: (e) => mapQuestion(e, "question:rejected"),
  },
  {
    opencodeType: "question.rejected",
    maxType: "question:rejected",
    mapper: (e) => mapQuestion(e, "question:rejected"),
  },

  // ── workspace lifecycle ──
  {
    opencodeType: "workspace.ready",
    maxType: "workspace:ready",
    mapper: mapWorkspaceReady,
  },
  {
    opencodeType: "workspace.failed",
    maxType: "workspace:failed",
    mapper: mapWorkspaceFailed,
  },
  {
    opencodeType: "workspace.status",
    maxType: "workspace:status",
    mapper: mapWorkspaceStatus,
  },

  // ── pty / lsp / mcp / todos ──
  {
    opencodeType: "pty.created",
    maxType: "pty:created",
    mapper: mapPtyCreated,
  },
  {
    opencodeType: "pty.exited",
    maxType: "pty:exited",
    mapper: mapPtyExited,
  },
  {
    opencodeType: "lsp.updated",
    maxType: "lsp:updated",
    mapper: mapLspUpdated,
  },
  {
    opencodeType: "mcp.tools.changed",
    maxType: "mcp:tools:changed",
    mapper: mapMcpToolsChanged,
  },
  {
    opencodeType: "todo.updated",
    maxType: "todo:updated",
    mapper: mapTodoUpdated,
  },

  // ── server / connect ──
  {
    opencodeType: "server.connected",
    maxType: "server:connected",
    mapper: mapServerConnected,
  },
]);

// ── resolver ─────────────────────────────────────────────────────────────────

/**
 * Build a fast lookup `Map<opencodeType, mapping>` so per-event dispatch is O(1).
 * The bridge holds onto this once at construction time.
 */
export function buildMappingIndex(
  entries: ReadonlyArray<OpencodeEventMapping> = OPENCODE_EVENT_MAP,
): Map<string, OpencodeEventMapping> {
  const idx = new Map<string, OpencodeEventMapping>();
  for (const entry of entries) {
    // First-occurrence wins so an earlier alias takes precedence.
    if (!idx.has(entry.opencodeType)) {
      idx.set(entry.opencodeType, entry);
    }
  }
  return idx;
}

/**
 * Resolve a mapper for an opencode event type, falling back to a generic
 * `unknown:*` mapper when the type is not registered.
 */
export function mapperFor(
  type: string,
  index: Map<string, OpencodeEventMapping>,
): OpencodeEventMapping {
  const direct = index.get(type);
  if (direct) return direct;
  return {
    opencodeType: type,
    maxType: `unknown:${type}`,
    mapper: mapUnknown,
  };
}

/**
 * Apply a mapping to an envelope and hand back the inserted `StoredEvent`
 * (with `id`/`seq`/`timestamp` filled in). The bridge passes the result of
 * this function to `EventStore.append`.
 *
 * `workspaceIdHint` is used when neither `location.workspaceID` nor
 * `data.sessionID` resolve to a valid aggregate id — typically the bridge's
 * own configured workspace.
 */
export function mapOpencodeEvent(
  event: OpencodeEvent,
  index: Map<string, OpencodeEventMapping>,
  workspaceIdHint: string,
): MappedEventDraft {
  const { mapper } = mapperFor(event.type ?? "", index);
  const draft = mapper(event);
  if (!draft.aggregateId || draft.aggregateId === "global") {
    draft.aggregateId = workspaceIdHint;
  }
  return draft;
}

/**
 * Runtime type guard — returns true if `value` looks like an opencode
 * envelope. Cheaply rejects obvious non-envelopes so the bridge can drop
 * them rather than attempting to map garbage.
 */
export function isOpencodeEvent(value: unknown): value is OpencodeEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string";
}

/** Convenience re-export so callers can use `StoredEvent` from one place. */
export type { StoredEvent };
