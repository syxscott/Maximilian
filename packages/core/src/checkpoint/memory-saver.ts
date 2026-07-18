// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * In-memory CheckpointSaver implementation.
 * Thread-safe via a Map + mutex lock.
 * Suitable for single-process CLI mode and unit tests.
 */

import { randomUUID } from "node:crypto";
import type {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointTuple,
} from "./saver.js";
import type { ConfigurableDict } from "../types.js";

interface StoredTuple {
  checkpoint: Checkpoint;
  metadata?: Record<string, unknown>;
  pendingWrites: Array<[string, unknown, unknown]>;
}

/**
 * In-memory, thread-safe checkpoint saver.
 * Uses a Map keyed by thread_id, with each thread's checkpoints
 * stored as a sorted-by-id array (newest first).
 */
export class MemoryCheckpointSaver implements BaseCheckpointSaver {
  // Map<threadId, Map<checkpointId, StoredTuple>>
  private store = new Map<string, Map<string, StoredTuple>>();
  // Map<threadId, Map<checkpointId, parentId>>
  private parentIndex = new Map<string, Map<string, string | null>>();
  // Simple mutex for thread safety
  private locks = new Map<string, Promise<void>>();

  private withLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    // Acquire lock synchronously, then chain fn() after it.
    // If lock is already held, the returned promise will resolve only after
    // the current holder releases (via the spin-wait below).
    // 修复 Bug7: capture release function before async gap so each call only deletes its own entry
    const release = () => this.locks.delete(threadId);
    const lock = new Promise<void>((resolve) => { resolve(); });

    const prev = this.locks.get(threadId);
    this.locks.set(threadId, lock);

    const chain = (prev ?? Promise.resolve()).then(() => fn());
    chain.then(release).catch(release);
    return chain;
  }

  private threadId(config: ConfigurableDict): string {
    const id = config["thread_id"];
    if (typeof id !== "string") throw new Error("config must contain thread_id");
    return id;
  }

  async get(config: ConfigurableDict): Promise<CheckpointTuple | undefined> {
    const tid = this.threadId(config);
    const checkpoints = this.store.get(tid);
    if (!checkpoints) return undefined;

    const cpId = config["checkpoint_id"] as string | undefined;
    if (!cpId) {
      // No checkpoint_id → find latest and call get again with that id
      const ids = Array.from(checkpoints.keys()).sort().reverse();
      if (ids.length === 0) return undefined;
      return this.get({ ...config, checkpoint_id: ids[0]! });
    }

    return this.withLock(tid, async () => {
      // Re-check after acquiring lock (state may have changed)
      const stored = (this.store.get(tid)?.get(cpId));
      if (!stored) return undefined;
      const parentConfig = stored.checkpoint.parentId
        ? { thread_id: tid, checkpoint_id: stored.checkpoint.parentId }
        : null;
      return {
        config: { ...config, checkpoint_id: cpId },
        checkpoint: stored.checkpoint,
        metadata: stored.metadata,
        parentConfig,
        pendingWrites: stored.pendingWrites,
      };
    });
  }

  async put(
    config: ConfigurableDict,
    checkpoint: Checkpoint,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.withLock(this.threadId(config), async () => {
      const tid = this.threadId(config);
      if (!this.store.has(tid)) {
        this.store.set(tid, new Map());
      }
      if (!this.parentIndex.has(tid)) {
        this.parentIndex.set(tid, new Map());
      }
      // 修复 Bug8: deep clone channelValues to avoid mutating historical checkpoints
      const clonedCheckpoint: Checkpoint = {
        ...checkpoint,
        channelValues: {
          results: JSON.parse(JSON.stringify(checkpoint.channelValues["results"])),
          tasks: JSON.parse(JSON.stringify(checkpoint.channelValues["tasks"])),
          plan: JSON.parse(JSON.stringify(checkpoint.channelValues["plan"])),
        },
      };
      this.store.get(tid)!.set(checkpoint.id, {
        checkpoint: clonedCheckpoint,
        metadata,
        pendingWrites: [],
      });
      this.parentIndex.get(tid)!.set(checkpoint.id, checkpoint.parentId);
    });
  }

  async list(config: ConfigurableDict, limit?: number): Promise<CheckpointTuple[]> {
    return this.withLock(this.threadId(config), async () => {
      const tid = this.threadId(config);
      const checkpoints = this.store.get(tid);
      if (!checkpoints) return [];

      // Sort newest first
      const sorted = Array.from(checkpoints.entries())
        .sort(([a], [b]) => b.localeCompare(a));

      const result: CheckpointTuple[] = [];
      for (const [cpId, stored] of sorted) {
        const parentConfig = stored.checkpoint.parentId
          ? { thread_id: tid, checkpoint_id: stored.checkpoint.parentId }
          : null;
        result.push({
          config: { thread_id: tid, checkpoint_id: cpId },
          checkpoint: stored.checkpoint,
          metadata: stored.metadata,
          parentConfig,
          pendingWrites: stored.pendingWrites,
        });
        if (limit !== undefined && result.length >= limit) break;
      }
      return result;
    });
  }

  async putWrites(
    config: ConfigurableDict,
    writes: Array<[string, unknown]>,
    _force?: boolean,
  ): Promise<void> {
    return this.withLock(this.threadId(config), async () => {
      const tid = this.threadId(config);
      const checkpoints = this.store.get(tid);
      if (!checkpoints) return;

      const cpId = config["checkpoint_id"] as string | undefined;
      if (!cpId) return;

      const stored = checkpoints.get(cpId);
      if (!stored) return;

      stored.pendingWrites.push(...writes.map(([ch, val]) => [ch, val, "write"] as [string, unknown, unknown]));
    });
  }

  async copyThread(srcConfig: ConfigurableDict, dstConfig: ConfigurableDict): Promise<void> {
    const srcId = this.threadId(srcConfig);
    const dstId = this.threadId(dstConfig);
    if (srcId === dstId) throw new Error("source and destination thread ids must differ");

    return this.withLock(dstId, async () => {
      const srcCheckpoints = this.store.get(srcId);
      if (!srcCheckpoints) return;

      if (!this.store.has(dstId)) {
        this.store.set(dstId, new Map());
        this.parentIndex.set(dstId, new Map());
      }
      const dstCheckpoints = this.store.get(dstId)!;
      const dstParents = this.parentIndex.get(dstId)!;

      // Generate a mapping from old id → new id (old id is the sort key, so we replicate the chain)
      const oldIds = Array.from(srcCheckpoints.keys()).sort();
      const newIds = oldIds.map(() => randomUUID().slice(0, 8));

      for (let i = 0; i < oldIds.length; i++) {
        const oldCp = srcCheckpoints.get(oldIds[i]!)!;
        const newParentId = i === 0 ? null : newIds[i - 1];
        const newCheckpoint: Checkpoint = {
          ...oldCp.checkpoint,
          id: newIds[i]!,
          parentId: newParentId,
        };
        dstCheckpoints.set(newIds[i]!, { ...oldCp, checkpoint: newCheckpoint });
        dstParents.set(newIds[i]!, newParentId);
      }
    });
  }

  async prune(config: ConfigurableDict, beforeId?: string): Promise<void> {
    return this.withLock(this.threadId(config), async () => {
      const tid = this.threadId(config);
      const checkpoints = this.store.get(tid);
      const parents = this.parentIndex.get(tid);
      if (!checkpoints || !parents) return;

      if (!beforeId) {
        // Prune all but the latest
        const ids = Array.from(checkpoints.keys()).sort().reverse();
        const toKeep = new Set(ids.slice(0, 1));
        for (const id of ids.slice(1)) {
          checkpoints.delete(id);
          parents.delete(id);
        }
        return;
      }

      // Keep only checkpoints before beforeId (older by sort order)
      // Lexicographic: id < beforeId means id is older
      const toDelete: string[] = [];
      for (const id of checkpoints.keys()) {
        if (id.localeCompare(beforeId) <= 0) {
          toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        checkpoints.delete(id);
        parents.delete(id);
      }
    });
  }
}
