/**
 * FileMemoryStore — lightweight long-term memory for the no-evolution path.
 *
 * Implements the `AgentMemoryStorePort` interface defined in runtime.ts so
 * the runtime can inject per-role memories into agents even when the full
 * EvolutionFacade is disabled.
 *
 * Layout: one JSON file per role under `<rootDir>/memory/<role>.json`.
 * The shape matches `AgentMemory` from `@max/evolution` so callers can swap
 * implementations without changing call sites.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole } from "./types.js";
import type { AgentMemoryStorePort } from "./runtime.js";
import { getLogger } from "@max/telemetry";

const log = getLogger("core:file-memory");

export interface FileMemoryStoreOptions {
  rootDir: string;
  /** Cap per-bucket size before compression kicks in. */
  cap?: number;
}

interface MemoryFile {
  userFeedback: string[];
  reviewSuggestions: string[];
  commonErrors: string[];
  goodExamples: string[];
  totalEntries: number;
  compressedAt?: string;
}

const EMPTY: MemoryFile = {
  userFeedback: [],
  reviewSuggestions: [],
  commonErrors: [],
  goodExamples: [],
  totalEntries: 0,
};

export class FileMemoryStore implements AgentMemoryStorePort {
  private readonly dir: string;
  private readonly cap: number;
  /** Per-process in-memory cache so we don't re-read on every task. */
  private readonly cache = new Map<AgentRole, MemoryFile>();

  constructor(opts: FileMemoryStoreOptions) {
    this.dir = join(opts.rootDir, "memory");
    this.cap = opts.cap ?? 50;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private filePath(role: AgentRole): string {
    return join(this.dir, `${role}.json`);
  }

  private async load(role: AgentRole): Promise<MemoryFile> {
    const cached = this.cache.get(role);
    if (cached) return cached;
    try {
      const raw = await readFile(this.filePath(role), "utf-8");
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      const mem: MemoryFile = { ...EMPTY, ...parsed };
      this.cache.set(role, mem);
      return mem;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const fresh = { ...EMPTY };
        this.cache.set(role, fresh);
        return fresh;
      }
      throw err;
    }
  }

  private async persist(role: AgentRole, mem: MemoryFile): Promise<void> {
    this.cache.set(role, mem);
    await writeFile(this.filePath(role), JSON.stringify(mem, null, 2), "utf-8");
  }

  getMemory(role: AgentRole): MemoryFile {
    const cached = this.cache.get(role);
    if (cached) return { ...cached };
    // Try to load from disk synchronously. Without this fallback,
    // `toPrelude()` returns empty after a process restart until a write happens.
    try {
      const raw = readFileSync(this.filePath(role), "utf-8");
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      const mem: MemoryFile = { ...EMPTY, ...parsed };
      this.cache.set(role, mem);
      return { ...mem };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn({ err }, "sync read failed");
      }
      return { ...EMPTY };
    }
  }

  async recordSuccess(
    role: AgentRole,
    _record: { taskId: string; reviewScore?: number },
    snippet?: string
  ): Promise<void> {
    if (!snippet) return;
    const mem = await this.load(role);
    const next: MemoryFile = {
      ...mem,
      goodExamples: appendCapped(mem.goodExamples, snippet, this.cap),
      totalEntries: mem.totalEntries + 1,
    };
    const compressed = await this.maybeCompress(next);
    await this.persist(role, compressed);
  }

  async recordFailure(
    role: AgentRole,
    record: { taskId: string; reviewScore?: number; error?: string }
  ): Promise<void> {
    const text = record.error ?? `Score ${record.reviewScore ?? "?"}/10 below threshold`;
    const mem = await this.load(role);
    const next: MemoryFile = {
      ...mem,
      commonErrors: appendCapped(mem.commonErrors, text, this.cap),
      totalEntries: mem.totalEntries + 1,
    };
    const compressed = await this.maybeCompress(next);
    await this.persist(role, compressed);
  }

  toPrelude(role: AgentRole): string {
    const mem = this.getMemory(role);
    const sections: string[] = [];
    if (mem.userFeedback.length > 0) {
      sections.push(`User feedback to honor:\n- ${mem.userFeedback.slice(-5).join("\n- ")}`);
    }
    if (mem.reviewSuggestions.length > 0) {
      sections.push(`Reviewer suggestions:\n- ${mem.reviewSuggestions.slice(-5).join("\n- ")}`);
    }
    if (mem.commonErrors.length > 0) {
      sections.push(`Common errors to avoid:\n- ${mem.commonErrors.slice(-5).join("\n- ")}`);
    }
    if (mem.goodExamples.length > 0) {
      sections.push(`Patterns that worked well:\n- ${mem.goodExamples.slice(-3).join("\n- ")}`);
    }
    if (sections.length === 0) return "";
    return `\n\n# Lessons learned from past runs (auto-injected)\n${sections.join("\n\n")}\n`;
  }

  private async maybeCompress(mem: MemoryFile): Promise<MemoryFile> {
    const threshold = 20;
    const buckets: Array<keyof Omit<MemoryFile, "totalEntries" | "compressedAt">> = [
      "userFeedback",
      "reviewSuggestions",
      "commonErrors",
      "goodExamples",
    ];
    let next: MemoryFile = { ...mem };
    let changed = false;
    for (const b of buckets) {
      if (next[b].length <= threshold) continue;
      const half = Math.floor(next[b].length / 2);
      const head = next[b].slice(0, half);
      const tail = next[b].slice(half);
      const digest = `[digest of ${head.length} past ${b}] ${head.slice(0, 3).join(" / ")}`;
      next = { ...next, [b]: [digest, ...tail] };
      changed = true;
    }
    if (changed) next.compressedAt = new Date().toISOString();
    return next;
  }
}

function appendCapped(arr: string[], value: string, cap: number): string[] {
  const next = [...arr, value];
  if (next.length > cap) next.splice(0, next.length - cap);
  return next;
}