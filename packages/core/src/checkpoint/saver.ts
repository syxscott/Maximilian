// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Checkpoint persistence abstraction (借鉴 LangGraph checkpoint).
 * @see https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/checkpoint/base/__init__.py
 *
 * A checkpoint captures the full state of a workspace at a point in time,
 * forming a version chain via parentId. This enables time-travel debugging,
 * fork/branch execution, and replay from any point.
 */

import type { ChannelValues, ConfigurableDict } from '../types.js';

/**
 * A single checkpoint snapshot — the atomic unit of workspace history.
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint (similar to langgraph checkpoint_id). */
  id: string;
  /** Parent checkpoint id — null for the root checkpoint. */
  parentId: string | null;
  /** Snapshot of all channel values at this point. */
  channelValues: ChannelValues;
  /** Per-channel version numbers (monotonically increasing integers). */
  channelVersions: Record<string, number>;
  /** List of channel names updated since the parent checkpoint. */
  updatedChannels: string[];
  /** Metadata about how this checkpoint was created. */
  metadata: {
    source: 'input' | 'loop' | 'update';
    step: number;
    /** Parent channel versions at time of creation (for conflict resolution). */
    parents?: Record<string, string>;
  };
}

/**
 * A checkpoint plus the config/query used to retrieve it.
 * Returned by list/get operations so callers can re-query or navigate
 * the version chain.
 */
export interface CheckpointTuple {
  /** Config used to retrieve this checkpoint (contains thread_id etc.). */
  config: ConfigurableDict;
  /** The checkpoint itself. */
  checkpoint: Checkpoint;
  /** Optional arbitrary metadata stored alongside the checkpoint. */
  metadata?: Record<string, unknown>;
  /** Config for the parent checkpoint (null if this is a root). */
  parentConfig: ConfigurableDict | null;
  /**
   * Writes that have been applied to the store but not yet committed
   * as a full checkpoint (similar to langgraph's pending_writes).
   * Each entry is [channel, value, type].
   */
  pendingWrites: Array<[string, unknown, unknown]>;
}

/**
 * Core checkpoint saver interface.
 * Implementations provide storage backends (memory, PostgreSQL, etc.).
 */
export interface BaseCheckpointSaver {
  /**
   * Retrieve a checkpoint by its config.
   * Returns undefined if not found.
   */
  get(config: ConfigurableDict): Promise<CheckpointTuple | undefined>;

  /**
   * Persist a checkpoint under the given config.
   * The config typically contains thread_id and optionally checkpoint_id.
   */
  put(
    config: ConfigurableDict,
    checkpoint: Checkpoint,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /**
   * List all checkpoints for a thread, ordered newest-first.
   * @param config - must contain thread_id
   * @param limit - maximum number to return (default: all)
   */
  list(config: ConfigurableDict, limit?: number): Promise<CheckpointTuple[]>;

  /**
   * Batch-write pending writes (applied but not yet committed).
   * @param config - thread config
   * @param writes - array of [channel, value, type]
   * @param force - if true, flush even if channel version hasn't changed
   */
  putWrites(
    config: ConfigurableDict,
    writes: Array<[string, unknown]>,
    force?: boolean,
  ): Promise<void>;

  /**
   * Copy an entire thread to a new thread id (fork operation).
   */
  copyThread(srcConfig: ConfigurableDict, dstConfig: ConfigurableDict): Promise<void>;

  /**
   * Prune old checkpoints, keeping only those before the given id.
   * Used to reclaim storage without losing recent history.
   */
  prune(config: ConfigurableDict, beforeId?: string): Promise<void>;
}
