/**
 * Phase 10 — TelemetryCollector.
 *
 * Centralized telemetry collector with in-memory ring-buffer storage
 * and optional JSONL file persistence. Persistence is fire-and-forget:
 * callers are never blocked by disk I/O. A disk failure is logged and
 * swallowed — it never propagates to the caller or poisons the queue.
 *
 * No external dependencies beyond node:fs, node:crypto, and zod.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ExecutionTraceSchema,
  EvolutionTraceSchema,
  TelemetryConfigSchema,
  type ExecutionTrace,
  type EvolutionTrace,
  type TelemetryConfig,
} from "./types.js";

/** Optional persistence store interface (satisfied by PgTelemetryStore). */
export interface TelemetryPersistStore {
  saveExecutionTrace(trace: unknown): Promise<void>;
  saveEvolutionTrace(trace: unknown): Promise<void>;
}

export class TelemetryCollector {
  private executionBuffer: ExecutionTrace[] = [];
  private evolutionBuffer: EvolutionTrace[] = [];
  private config: TelemetryConfig;
  private dbStore?: TelemetryPersistStore;
  /** 串行化并发 JSONL 写入，防止行交错。错误被 catch 吞掉，不会污染后续写入。 */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: Partial<TelemetryConfig> = {}, dbStore?: TelemetryPersistStore) {
    this.config = TelemetryConfigSchema.parse(config);
    this.dbStore = dbStore;
  }

  // ------------------------------------------------------------------
  // 记录
  // ------------------------------------------------------------------

  async recordExecution(
    input: Omit<ExecutionTrace, "id" | "startedAt"> & { startedAt?: string }
  ): Promise<ExecutionTrace> {
    const trace = ExecutionTraceSchema.parse({
      id: `ex-${randomUUID().slice(0, 8)}`,
      startedAt: input.startedAt ?? new Date().toISOString(),
      ...input,
    });

    this.pushToRing(this.executionBuffer, trace);
    // Fire-and-forget: persistence never blocks the caller.
    this.maybePersist("execution", trace);
    return trace;
  }

  async recordEvolution(
    input: Omit<EvolutionTrace, "id" | "recordedAt"> & { recordedAt?: string }
  ): Promise<EvolutionTrace> {
    const trace = EvolutionTraceSchema.parse({
      id: `evo-${randomUUID().slice(0, 8)}`,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      ...input,
    });

    this.pushToRing(this.evolutionBuffer, trace);
    // Fire-and-forget: persistence never blocks the caller.
    this.maybePersist("evolution", trace);
    return trace;
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  listExecutions(): ExecutionTrace[] {
    return [...this.executionBuffer];
  }

  listEvolutions(): EvolutionTrace[] {
    return [...this.evolutionBuffer];
  }

  /** Await all pending JSONL writes. Useful in tests and graceful shutdown. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  /** 获取特定 agent role 的进化历史（按 subject 过滤） */
  lineageByRole(role: string): EvolutionTrace[] {
    return this.evolutionBuffer.filter((t) => t.subject === role);
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private pushToRing<T>(buffer: T[], item: T): void {
    buffer.push(item);
    if (buffer.length > this.config.maxBufferSize) {
      buffer.splice(0, buffer.length - this.config.maxBufferSize);
    }
  }

  /**
   * Fire-and-forget JSONL persistence.
   * Errors are caught and logged — a disk failure must never propagate
   * to the caller or poison the write queue.
   */
  private maybePersist(
    kind: "execution" | "evolution",
    trace: ExecutionTrace | EvolutionTrace
  ): void {
    if (!this.config.persistPath) return;

    // Chain onto the write queue; catch prevents queue poisoning.
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const filePath = join(this.config.persistPath!, `${kind}s.jsonl`);
        await fs.mkdir(dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, JSON.stringify(trace) + "\n", "utf-8");
      } catch (err) {
        console.error(`[TelemetryCollector] persist ${kind} failed:`, err);
      }
    });
  }
}
