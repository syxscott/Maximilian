/**
 * Phase 5 — Agent Memory.
 *
 * Per-role buckets of:
 *   - userFeedback        explicit "I don't like X" notes
 *   - reviewSuggestions   structured advice from the Review Agent
 *   - commonErrors        error strings seen on this role
 *   - goodExamples        snippets of high-scoring outputs
 *
 * Each entry carries a `mime` field so consumers can route by content type
 * (mirrors autogen's `MemoryContent` protocol). For now the most common
 * entries are `text/plain`; structured advice can be stored as
 * `application/json` so a downstream summarizer can parse it without
 * pre-processing.
 *
 * Grows unbounded by default. When any bucket exceeds COMPRESSION_THRESHOLD,
 * the oldest half is folded into a single `text/digest` entry and dropped.
 * An optional LLM summarizer can produce a higher-quality digest; without it
 * we fall back to a deterministic joiner so the engine still functions.
 */

import type { AgentMemory, MemoryEntry, MetricRecord } from "./types.js";
import { emptyMemory, MemoryMime, toMemoryEntry } from "./types.js";

export const COMPRESSION_THRESHOLD = 20;

export interface MemorySummarizer {
  summarize(bucket: string, items: string[]): Promise<string>;
}

export class AgentMemoryStore {
  /**
   * Build the "memory prelude" text that gets prepended to a role's system
   * prompt at execution time.
   */
  static toPrelude(mem: AgentMemory): string {
    const sections: string[] = [];
    const joinTail = (entries: MemoryEntry[], n: number) =>
      entries
        .slice(-n)
        .map((e) => e.content)
        .join("\n- ");
    if (mem.userFeedback.length > 0) {
      sections.push(`User feedback to honor:\n- ${joinTail(mem.userFeedback, 5)}`);
    }
    if (mem.reviewSuggestions.length > 0) {
      sections.push(`Reviewer suggestions:\n- ${joinTail(mem.reviewSuggestions, 5)}`);
    }
    if (mem.commonErrors.length > 0) {
      sections.push(`Common errors to avoid:\n- ${joinTail(mem.commonErrors, 5)}`);
    }
    if (mem.goodExamples.length > 0) {
      sections.push(`Patterns that worked well:\n- ${joinTail(mem.goodExamples, 3)}`);
    }
    if (sections.length === 0) return "";
    return `\n\n# Lessons learned from past runs (auto-injected)\n${sections.join("\n\n")}\n`;
  }

  static recordSuccess(mem: AgentMemory, record: MetricRecord, snippet: string | undefined): AgentMemory {
    const next: AgentMemory = {
      ...mem,
      goodExamples: snippet
        ? appendCapped(mem.goodExamples, toMemoryEntry(snippet, MemoryMime.TextPlain), 50)
        : mem.goodExamples,
      totalEntries: mem.totalEntries + 1,
    };
    return next;
  }

  static recordFailure(mem: AgentMemory, record: MetricRecord): AgentMemory {
    const errLine = record.error ?? `Score ${record.reviewScore}/10 below threshold`;
    return {
      ...mem,
      commonErrors: appendCapped(mem.commonErrors, toMemoryEntry(errLine, MemoryMime.TextPlain), 50),
      totalEntries: mem.totalEntries + 1,
    };
  }

  static recordFeedback(mem: AgentMemory, text: string): AgentMemory {
    if (!text.trim()) return mem;
    return {
      ...mem,
      userFeedback: appendCapped(mem.userFeedback, toMemoryEntry(text.trim(), MemoryMime.TextPlain), 50),
      totalEntries: mem.totalEntries + 1,
    };
  }

  static recordReviewSuggestions(mem: AgentMemory, suggestions: string[]): AgentMemory {
    if (suggestions.length === 0) return mem;
    return {
      ...mem,
      reviewSuggestions: appendCapped(
        mem.reviewSuggestions,
        toMemoryEntry(suggestions.join(" | "), MemoryMime.TextPlain),
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    };
  }

  /**
   * Append a structured JSON payload to a bucket. Useful for richer
   * reviewer feedback (e.g. `{ issues: [...], score: 7 }`).
   */
  static recordStructured<T extends Record<string, unknown>>(
    mem: AgentMemory,
    bucket: "userFeedback" | "reviewSuggestions" | "commonErrors" | "goodExamples",
    payload: T,
    metadata?: Record<string, unknown>,
  ): AgentMemory {
    return {
      ...mem,
      [bucket]: appendCapped(
        mem[bucket],
        {
          mime: MemoryMime.ApplicationJson,
          content: JSON.stringify(payload),
          metadata,
        },
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    };
  }

  /**
   * Compress any bucket that has grown past the threshold.
   * Returns a new memory object; does not mutate in place.
   */
  static async maybeCompress(
    mem: AgentMemory,
    summarizer?: MemorySummarizer
  ): Promise<AgentMemory> {
    const buckets: Array<keyof Omit<AgentMemory, "totalEntries" | "compressedAt">> = [
      "userFeedback",
      "reviewSuggestions",
      "commonErrors",
      "goodExamples",
    ];

    let next: AgentMemory = { ...mem };
    let changed = false;
    for (const b of buckets) {
      if (next[b].length <= COMPRESSION_THRESHOLD) continue;
      const half = Math.floor(next[b].length / 2);
      const head = next[b].slice(0, half);
      const tail = next[b].slice(half);
      const headStrings = head.map((e) => e.content);
      const digest = summarizer
        ? await summarizer.summarize(b, headStrings)
        : defaultDigest(b, headStrings);
      next = {
        ...next,
        [b]: [{ mime: MemoryMime.TextDigest, content: digest }, ...tail],
      };
      changed = true;
    }
    if (changed) {
      next = { ...next, compressedAt: new Date().toISOString() };
    }
    return next;
  }
}

function appendCapped(arr: MemoryEntry[], value: MemoryEntry, cap: number): MemoryEntry[] {
  const next = [...arr, value];
  if (next.length > cap) next.splice(0, next.length - cap);
  return next;
}

function defaultDigest(bucket: string, items: string[]): string {
  return `[digest of ${items.length} past ${bucket}] ${items.slice(0, 3).join(" / ")}`;
}

export function freshMemory(): AgentMemory {
  return emptyMemory();
}