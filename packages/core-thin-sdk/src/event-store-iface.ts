// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Structural interfaces for cross-package types.
 *
 * We deliberately re-declare these here (rather than re-export from
 * @max/core) to break the would-be dependency cycle:
 *   - @max/core depends on @max/core-thin-sdk (uses OpencodeSdk)
 *   - @max/core-thin-sdk previously imported types from @max/core
 *     (EventStore, StoredEvent) which would create a cycle.
 *
 * Anyone passing a real `EventStore` from @max/core satisfies these
 * structural types automatically — no adapter needed.
 */

export interface StoredEventLike<T = unknown> {
  /** Unique event id. */
  id: string
  /** Event type discriminator. */
  type: string
  /** Aggregate/workspace this event belongs to. */
  aggregateId: string
  /** Event payload. */
  data: T
  /** Timestamp (ISO 8601). */
  timestamp: string
  /** Monotonic sequence number within the aggregate. */
  seq: number
}

export interface EventStoreLike {
  /** Append a new event. Signature matches @max/core's EventStore.append. */
  append<T = unknown>(params: { type: string; aggregateId: string; data: T }): StoredEventLike<T>
  /** Read all events for an aggregate. Signature matches @max/core's EventStore.getEvents. */
  getEvents(aggregateId: string, fromSeq?: number): StoredEventLike[]
  /** Read the most recent N events for a workspace. */
  recentForWorkspace(workspaceId: string, limit?: number): StoredEventLike[]
  /** Optional: subscribe to future appends. */
  subscribe?(listener: (event: StoredEventLike) => void): () => void
}