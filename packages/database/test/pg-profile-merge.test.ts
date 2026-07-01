/**
 * Tests for the merge helpers used by PgProfileStore.save() to combine
 * a freshly-read profile snapshot with an existing row under concurrent
 * writes.
 *
 * These are pure-function tests — no Postgres needed — and they pin
 * down the merge contract that fixes the "concurrent saves drop each
 * other's memory entries" bug. The actual transactional FOR UPDATE
 * wrapper around these helpers is exercised by the real save() flow.
 */

import { describe, it, expect } from "vitest";
import {
  mergeMemory,
  unionByContent,
  mergeVersions,
} from "../src/stores/pg-profile-store.js";

describe("unionByContent", () => {
  it("returns the union of two arrays, de-duplicated by JSON content", () => {
    const a = [{ id: 1, text: "a" }, { id: 2, text: "b" }];
    const b = [{ id: 2, text: "b" }, { id: 3, text: "c" }];
    expect(unionByContent(a, b)).toEqual([
      { id: 1, text: "a" },
      { id: 2, text: "b" },
      { id: 3, text: "c" },
    ]);
  });

  it("preserves the first occurrence's identity on duplicates", () => {
    // We don't want a key collision to silently swap a stored entry
    // for a duplicate from a different caller.
    const a = [{ tag: "x", value: 1 }];
    const b = [{ tag: "x", value: 1 }]; // byte-identical to first
    const out = unionByContent(a, b);
    expect(out).toEqual([{ tag: "x", value: 1 }]);
    expect(out).toHaveLength(1);
  });

  it("preserves insertion order (existing first, then new)", () => {
    const a = ["alpha", "beta"];
    const b = ["gamma", "delta"];
    expect(unionByContent(a, b)).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("handles empty inputs", () => {
    expect(unionByContent([], [])).toEqual([]);
    expect(unionByContent([{ a: 1 }], [])).toEqual([{ a: 1 }]);
    expect(unionByContent([], [{ b: 2 }])).toEqual([{ b: 2 }]);
  });

  it("treats objects with different key order as distinct", () => {
    // Documents the current dedup behavior: equality is by JSON
    // serialization, which preserves key insertion order. Two objects
    // with the same key/value pairs but different construction order
    // are NOT deduped. This is acceptable for our use case because
    // writers construct entries from typed shapes (not arbitrary
    // user JSON), so the key order is deterministic per source. If
    // we ever need semantic equality, swap to a stable-key serializer
    // or deep-equal.
    const a = [{ x: 1, y: 2 }];
    const b = [{ y: 2, x: 1 }];
    const out = unionByContent(a, b);
    expect(out).toHaveLength(2);
  });
});

describe("mergeVersions", () => {
  it("preserves existing order, appends new ones", () => {
    expect(mergeVersions(["v1", "v2"], ["v3"])).toEqual(["v1", "v2", "v3"]);
  });

  it("dedupes by string equality", () => {
    expect(mergeVersions(["v1", "v2"], ["v2", "v3"])).toEqual(["v1", "v2", "v3"]);
  });

  it("handles empty existing", () => {
    expect(mergeVersions([], ["v1", "v2"])).toEqual(["v1", "v2"]);
  });

  it("handles empty incoming", () => {
    expect(mergeVersions(["v1"], [])).toEqual(["v1"]);
  });
});

describe("mergeMemory", () => {
  const empty = () => ({
    userFeedback: [] as unknown[],
    reviewSuggestions: [] as unknown[],
    commonErrors: [] as unknown[],
    goodExamples: [] as unknown[],
    totalEntries: 0,
  });

  it("unions all four feedback arrays independently", () => {
    const existing = {
      ...empty(),
      userFeedback: [{ id: 1 }],
      reviewSuggestions: [{ id: "a" }],
      commonErrors: [{ msg: "boom" }],
      goodExamples: [{ kind: "good" }],
    };
    const incoming = {
      ...empty(),
      userFeedback: [{ id: 2 }],
      reviewSuggestions: [{ id: "b" }],
      commonErrors: [{ msg: "crash" }],
      goodExamples: [{ kind: "great" }],
    };
    const out = mergeMemory(existing, incoming);
    expect(out.userFeedback).toEqual([{ id: 1 }, { id: 2 }]);
    expect(out.reviewSuggestions).toEqual([{ id: "a" }, { id: "b" }]);
    expect(out.commonErrors).toEqual([{ msg: "boom" }, { msg: "crash" }]);
    expect(out.goodExamples).toEqual([{ kind: "good" }, { kind: "great" }]);
  });

  it("takes the max of totalEntries", () => {
    const a = { ...empty(), totalEntries: 5 };
    const b = { ...empty(), totalEntries: 3 };
    expect(mergeMemory(a, b).totalEntries).toBe(5);
    expect(mergeMemory(b, a).totalEntries).toBe(5);
  });

  it("keeps the existing compressedAt if incoming has none", () => {
    const a = { ...empty(), compressedAt: "2026-01-01T00:00:00Z" };
    const b = { ...empty() };
    expect(mergeMemory(a, b).compressedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("uses incoming compressedAt when both are set", () => {
    // Incoming represents a more recent compression, so it wins.
    const a = { ...empty(), compressedAt: "2026-01-01T00:00:00Z" };
    const b = { ...empty(), compressedAt: "2026-06-01T00:00:00Z" };
    expect(mergeMemory(a, b).compressedAt).toBe("2026-06-01T00:00:00Z");
  });

  it("doesn't lose entries from one side when the other is empty", () => {
    // Regression: before the merge fix, save() with an empty memory
    // snapshot would overwrite the existing row's arrays entirely.
    const a = {
      ...empty(),
      userFeedback: [{ id: 1 }, { id: 2 }, { id: 3 }],
    };
    const b = empty();
    const out = mergeMemory(a, b);
    expect(out.userFeedback).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("doesn't lose entries when both sides have overlapping content", () => {
    // Two callers concurrently append distinct feedback — neither
    // should disappear after merge.
    const a = {
      ...empty(),
      userFeedback: [{ from: "A", text: "be terser" }],
    };
    const b = {
      ...empty(),
      userFeedback: [{ from: "B", text: "add citations" }],
    };
    const out = mergeMemory(a, b);
    expect(out.userFeedback).toContainEqual({ from: "A", text: "be terser" });
    expect(out.userFeedback).toContainEqual({ from: "B", text: "add citations" });
  });
});