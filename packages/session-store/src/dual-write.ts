/**
 * Dual-write adapter — the "write to both sides" half of the migration
 * pattern. A runtime listener holds one `SessionRecorder` per workspace
 * and mirrors what it already emits (runtime events, token usage) into
 * the SQLite side store, while the legacy JSONL log keeps operating
 * unchanged. Reads may come from either side during the transition
 * (see `legacy.ts` for the legacy-compatible read).
 *
 * Deliberately THIN: no buffering, no batching, no retry logic. If the
 * SQLite write throws, the error propagates — the JSONL log (the
 * authoritative side for events during migration) is written by the
 * caller independently, so a recorder failure must not be swallowed
 * silently.
 */

import type { SessionStore } from "./index.js"

/**
 * Loose structural shape of a provider result that carries token usage.
 * Compatible with `@max/llm`'s `Usage` ({@see recordUsageFromResult}),
 * which reports `inputTokens`/`outputTokens`; flat fallbacks are
 * accepted so callers can pass whatever they already have on hand.
 */
export interface UsageResultLike {
  provider?: string
  model?: string
  /** Conversation role the usage is attributed to (e.g. "assistant"). */
  role?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  /** Flat fallbacks when the result has no nested `usage` object. */
  inputTokens?: number
  outputTokens?: number
}

/** Minimal runtime event shape accepted by {@link SessionRecorder.recordRuntimeEvent}. */
export interface RuntimeEventLike {
  type: string
  payload?: unknown
  at?: string
}

/**
 * Per-workspace recorder that mirrors runtime events and usage into the
 * session store. All timestamps default to "now" (ISO strings) exactly
 * like the store's own append methods.
 */
export class SessionRecorder {
  private readonly store: SessionStore
  readonly workspaceId: string

  constructor(store: SessionStore, workspaceId: string) {
    this.store = store
    this.workspaceId = workspaceId
  }

  /**
   * Mirror a runtime event into the `events` table. The event type and
   * payload are stored as-is (payload JSON-encoded by the store); the
   * legacy JSONL log keeps its own `seq` numbering — this side store
   * uses its autoincrement id instead.
   *
   * Returns the inserted `events` row id.
   */
  recordRuntimeEvent(event: RuntimeEventLike): number {
    return this.store.appendEvent({
      workspaceId: this.workspaceId,
      type: event.type,
      payload: event.payload,
      at: event.at,
    })
  }

  /**
   * Extract token usage from a provider result and record it in the
   * `usage` table. Missing fields are stored as NULL.
   *
   * Returns the inserted `usage` row id, or null when the result
   * carries no usage information at all (nothing worth a row).
   */
  recordUsageFromResult(result: UsageResultLike): number | null {
    const tokensIn = result.usage?.inputTokens ?? result.inputTokens
    const tokensOut = result.usage?.outputTokens ?? result.outputTokens
    if (tokensIn === undefined && tokensOut === undefined) return null
    return this.store.recordUsage({
      workspaceId: this.workspaceId,
      role: result.role,
      provider: result.provider,
      model: result.model,
      tokensIn,
      tokensOut,
    })
  }
}
