// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PostgreSQL-backed CheckpointSaver implementation.
 * Uses raw SQL strings via the drizzle database instance (no drizzle-orm imports).
 * The table schema must be created via migration:
 *
 *   CREATE TABLE workspace_checkpoints (
 *     thread_id TEXT NOT NULL,
 *     id TEXT NOT NULL,
 *     parent_id TEXT,
 *     channel_values JSONB NOT NULL DEFAULT '{}',
 *     channel_versions JSONB NOT NULL DEFAULT '{}',
 *     updated_channels JSONB NOT NULL DEFAULT '[]',
 *     metadata JSONB NOT NULL DEFAULT '{}',
 *     pending_writes JSONB NOT NULL DEFAULT '[]',
 *     created_at TEXT NOT NULL,
 *     PRIMARY KEY (thread_id, id)
 *   );
 *   CREATE INDEX workspace_checkpoints_thread_created_at_idx
 *     ON workspace_checkpoints (thread_id, created_at DESC);
 *
 * Usage:
 *   import { PgCheckpointSaver } from '@max/core/checkpoint';
 *   import { createDb } from '@max/database';
 *   const db = createDb(process.env.DATABASE_URL!);
 *   const saver = new PgCheckpointSaver(db as PostgresJsDatabase);
 */

import type {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointTuple,
} from "./saver.js";
import type { ConfigurableDict, ChannelValues } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * RowList is postgres-js's result type: an array-like object with numeric indexer.
 * We define it locally to avoid coupling to the postgres package.
 * @see https://github.com/porsager/postgres
 */
type RowList<T> = T[] & Iterable<T>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckpointRowData {
  thread_id: string;
  id: string;
  parent_id: string | null;
  channel_values: unknown;
  channel_versions: unknown;
  updated_channels: unknown;
  metadata: unknown;
  pending_writes: unknown;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape a string for use in a raw SQL value context (simple JSON string).
 * Only handles the minimal cases needed for our SQL construction.
 */
function jsonStr(val: unknown): string {
  return JSON.stringify(val).replace(/'/g, "''");
}

// ── PgCheckpointSaver ─────────────────────────────────────────────────────────

/**
 * PostgreSQL-backed checkpoint saver using raw SQL queries.
 * Requires the `workspace_checkpoints` table to exist.
 *
 * Note: uses single-quote escaping for string values in raw SQL — sufficient
 * for workspace ids and checkpoint ids which are alphanumeric UUIDs. For general
 * JSON values this would not be safe; channel_values are encoded via
 * pg's ::jsonb cast which handles injection risks.
 */
export class PgCheckpointSaver implements BaseCheckpointSaver {
  // 修复 Bug 5 — postgres-js execute() 返回 RowList<T>（数组-like），而非 { rows: RowList<T> }
  constructor(
    private db: {
      execute<T>(sql: string, params?: unknown[]): Promise<RowList<T>>;
    },
  ) {}

  private threadId(config: ConfigurableDict): string {
    const id = config["thread_id"];
    if (typeof id !== "string") throw new Error("config must contain thread_id");
    return id.replace(/'/g, "''");
  }

  async get(config: ConfigurableDict): Promise<CheckpointTuple | undefined> {
    const tid = this.threadId(config);
    const cpId = config["checkpoint_id"] as string | undefined;

    // 修复 Bug 5 — db.execute 返回 RowList<T>，无需包装类型
    let rows: RowList<CheckpointRowData>;
    if (cpId) {
      const safeId = (cpId as string).replace(/'/g, "''");
      rows = await this.db.execute<CheckpointRowData>(
        `SELECT thread_id, id, parent_id, channel_values, channel_versions,
                updated_channels, metadata, pending_writes, created_at
         FROM workspace_checkpoints
         WHERE thread_id = '${tid}' AND id = '${safeId}'
         LIMIT 1`,
      );
    } else {
      // Find latest root checkpoint (no parent)
      rows = await this.db.execute<CheckpointRowData>(
        `SELECT thread_id, id, parent_id, channel_values, channel_versions,
                updated_channels, metadata, pending_writes, created_at
         FROM workspace_checkpoints
         WHERE thread_id = '${tid}' AND parent_id IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      );
    }

    // 修复 Bug 5 — postgres-js 返回 RowList<T> 直接可用，无需 .rows
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToTuple(row, tid);
  }

  async put(
    config: ConfigurableDict,
    checkpoint: Checkpoint,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const tid = this.threadId(config);
    const mergedMetadata = { ...checkpoint.metadata, ...metadata };

    await this.db.execute(
      `INSERT INTO workspace_checkpoints
         (thread_id, id, parent_id, channel_values, channel_versions,
          updated_channels, metadata, pending_writes, created_at)
       VALUES (
         '${tid}',
         '${checkpoint.id.replace(/'/g, "''")}',
         ${checkpoint.parentId ? `'${checkpoint.parentId.replace(/'/g, "''")}'` : 'NULL'},
         '${jsonStr(checkpoint.channelValues)}'::jsonb,
         '${jsonStr(checkpoint.channelVersions)}'::jsonb,
         '${jsonStr(checkpoint.updatedChannels)}'::jsonb,
         '${jsonStr(mergedMetadata)}'::jsonb,
         '[]'::jsonb,
         '${new Date().toISOString().replace(/'/g, "''")}'
       )
       ON CONFLICT (thread_id, id) DO UPDATE SET
         parent_id = EXCLUDED.parent_id,
         channel_values = EXCLUDED.channel_values,
         channel_versions = EXCLUDED.channel_versions,
         updated_channels = EXCLUDED.updated_channels,
         metadata = EXCLUDED.metadata`,
    );
  }

  async list(config: ConfigurableDict, limit?: number): Promise<CheckpointTuple[]> {
    const tid = this.threadId(config);
    const limitVal = limit ?? 1000;
    const rows = await this.db.execute<CheckpointRowData>(
      `SELECT thread_id, id, parent_id, channel_values, channel_versions,
              updated_channels, metadata, pending_writes, created_at
       FROM workspace_checkpoints
       WHERE thread_id = '${tid}'
       ORDER BY created_at DESC
       LIMIT ${limitVal}`,
    );
    // 修复 Bug 5 — rows 本身是 RowList<T>，直接调用 .map
    return rows.map((r: CheckpointRowData) => this.rowToTuple(r, tid));
  }

  // 修复 Bug 2 — SQL 注入：使用参数化查询替代字符串插值
  async putWrites(
    config: ConfigurableDict,
    writes: Array<[string, unknown]>,
    _force?: boolean,
  ): Promise<void> {
    const tid = this.threadId(config);
    const cpId = (config["checkpoint_id"] as string | undefined)?.replace(/'/g, "''");
    if (!cpId) return;
    const writesJson = JSON.stringify(writes.map(([ch, val]) => [ch, val, "write"]));
    await this.db.execute(
      `UPDATE workspace_checkpoints
       SET pending_writes = pending_writes || $1::jsonb
       WHERE thread_id = $2 AND id = $3`,
      [writesJson, tid, cpId],
    );
  }

  async copyThread(srcConfig: ConfigurableDict, dstConfig: ConfigurableDict): Promise<void> {
    const srcId = this.threadId(srcConfig);
    const dstId = this.threadId(dstConfig);
    if (srcId === dstId) throw new Error("source and destination thread ids must differ");

    const rows = await this.db.execute<CheckpointRowData>(
      `SELECT id, parent_id, channel_values, channel_versions,
              updated_channels, metadata, pending_writes, created_at
       FROM workspace_checkpoints
       WHERE thread_id = '${srcId}'
       ORDER BY created_at ASC`,
    );

    if (rows.length === 0) return;

    // Build new ids and resolve parent chain
    const oldIds = rows.map((r: CheckpointRowData) => r.id);
    const newIds = oldIds.map(
      () => `${dstId.replace(/'/g, "''")}-${Math.random().toString(36).slice(2, 10)}`,
    );

    // 修复 Bug 5 — rows 本身是 RowList<T>，无需 .rows
    for (let i = 0; i < rows.length; i++) {
      const old = rows[i] as CheckpointRowData;
      const newId = newIds[i]!;
      const newParentId = i === 0 ? "NULL" : `'${newIds[i - 1]!.replace(/'/g, "''")}'`;
      await this.db.execute(
        `INSERT INTO workspace_checkpoints
           (thread_id, id, parent_id, channel_values, channel_versions,
            updated_channels, metadata, pending_writes, created_at)
         VALUES (
           '${dstId}',
           '${newId}',
           ${newParentId},
           '${jsonStr(old.channel_values)}'::jsonb,
           '${jsonStr(old.channel_versions)}'::jsonb,
           '${jsonStr(old.updated_channels)}'::jsonb,
           '${jsonStr(old.metadata)}'::jsonb,
           '${jsonStr(old.pending_writes)}'::jsonb,
           '${(old.created_at as string).replace(/'/g, "''")}'
         )
         ON CONFLICT DO NOTHING`,
      );
    }
  }

  async prune(config: ConfigurableDict, beforeId?: string): Promise<void> {
    const tid = this.threadId(config);
    if (beforeId) {
      const safeId = (beforeId as string).replace(/'/g, "''");
      await this.db.execute(
        `DELETE FROM workspace_checkpoints
         WHERE thread_id = '${tid}' AND id < '${safeId}'`,
      );
    } else {
      await this.db.execute(
        `DELETE FROM workspace_checkpoints
         WHERE thread_id = '${tid}'
           AND id != (SELECT id FROM workspace_checkpoints
                      WHERE thread_id = '${tid}'
                      ORDER BY created_at DESC LIMIT 1)`,
      );
    }
  }

  private rowToTuple(row: CheckpointRowData, tid: string): CheckpointTuple {
    const parentConfig = row.parent_id
      ? { thread_id: tid, checkpoint_id: row.parent_id }
      : null;
    return {
      config: { thread_id: tid, checkpoint_id: row.id },
      checkpoint: {
        id: row.id,
        parentId: row.parent_id,
        channelValues: row.channel_values as ChannelValues,
        channelVersions: row.channel_versions as Record<string, number>,
        updatedChannels: row.updated_channels as string[],
        metadata: row.metadata as Checkpoint["metadata"],
      },
      metadata: row.metadata as Record<string, unknown>,
      parentConfig,
      pendingWrites: row.pending_writes as Array<[string, unknown, unknown]>,
    };
  }
}
