/**
 * Session Log — single source of truth for model-visible events (借鉴 DeepSeek Harness).
 *
 * Principle: "Model-visible means logged."
 * Anything that reaches a model request must be reconstructable from the log.
 * A new model-visible input requires a new session event.
 *
 * This module provides:
 *   - append(event): add to the append-only log
 *   - events: readonly log
 *   - deriveMessages(): project model-visible messages from the log
 *   - replay(): replay all events from the beginning
 */

import type { AgentEvent } from "./types.js"

/**
 * A session event with timestamp.
 * All events are append-only — never modify or delete.
 */
export interface SessionEvent<T = unknown> {
  id: string
  type: string
  payload: T
  timestamp: number
}

/**
 * Session log — append-only event log that serves as the single source of truth
 * for everything the model sees (借鉴 DeepSeek Harness session log pattern).
 *
 * Invariant: "Model-visible means logged."
 * Any event that could influence a model request MUST be appended here.
 */
export class SessionLog {
  private _events: SessionEvent[] = []
  private _nextId = 1

  /**
   * Append an event to the log.
   * All events are append-only — no modification or deletion.
   */
  append<T>(type: string, payload: T): SessionEvent<T> {
    const event: SessionEvent<T> = {
      id: `evt-${this._nextId++}`,
      type,
      payload,
      timestamp: Date.now(),
    }
    this._events.push(event)
    return event
  }

  /** Readonly view of all events. */
  get events(): ReadonlyArray<SessionEvent> {
    return this._events
  }

  /** Number of events in the log. */
  get length(): number {
    return this._events.length
  }

  /**
   * Project model-visible messages from the log.
   * Only returns events that should be sent to the LLM.
   *
   * Events that are model-visible:
   *   - user messages
   *   - assistant messages
   *   - tool result messages
   *
   * Internal events (e.g. tool_execution_start, turn_start) are NOT included.
   */
  deriveMessages(): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []
    for (const evt of this._events) {
      const p = evt.payload as Record<string, unknown>
      if (evt.type === "message_start" || evt.type === "message_end") {
        const msg = p["message"] as Record<string, unknown> | undefined
        if (msg && typeof msg["role"] === "string" && typeof msg["content"] === "string") {
          messages.push({ role: msg["role"] as string, content: msg["content"] as string })
        }
      }
    }
    return messages
  }

  /**
   * Replay all events from the log.
   * Useful for restoring state or re-processing.
   */
  replay(): Iterable<SessionEvent> {
    return this._events
  }

  /**
   * Find the last event of a given type.
   */
  lastOfType<T>(type: string): SessionEvent<T> | undefined {
    for (let i = this._events.length - 1; i >= 0; i--) {
      if (this._events[i]!.type === type) {
        return this._events[i] as SessionEvent<T>
      }
    }
    return undefined
  }

  /**
   * Clear the log (for test isolation or session reset).
   * Prefer creating a new SessionLog for isolated sessions.
   */
  clear(): void {
    this._events = []
    this._nextId = 1
  }
}
