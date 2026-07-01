/**
 * Tests for FileMemoryStore — verifies the AgentMemoryStorePort implementation
 * that backs long-term memory when EvolutionFacade is disabled.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMemoryStore } from "../src/file-memory-store.js";

describe("FileMemoryStore", () => {
  let dir: string;
  let store: FileMemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "file-mem-"));
    store = new FileMemoryStore({ rootDir: dir });
    await store.init();
  });

  it("returns empty prelude for unknown roles", () => {
    expect(store.toPrelude("backend")).toBe("");
  });

  it("records successes as good examples and emits a prelude", async () => {
    await store.recordSuccess("backend", { taskId: "t1", reviewScore: 9 }, "Use composition over inheritance");
    const prelude = store.toPrelude("backend");
    expect(prelude).toContain("Patterns that worked well");
    expect(prelude).toContain("composition over inheritance");
  });

  it("records failures as common errors", async () => {
    await store.recordFailure("backend", { taskId: "t1", error: "TypeError: foo is undefined" });
    const prelude = store.toPrelude("backend");
    expect(prelude).toContain("Common errors to avoid");
    expect(prelude).toContain("TypeError");
  });

  it("isolates memory per role", async () => {
    await store.recordSuccess("backend", { taskId: "t1" }, "Backend pattern");
    await store.recordSuccess("frontend", { taskId: "t2" }, "Frontend pattern");
    expect(store.toPrelude("backend")).toContain("Backend pattern");
    expect(store.toPrelude("backend")).not.toContain("Frontend pattern");
    expect(store.toPrelude("frontend")).toContain("Frontend pattern");
  });

  it("caps bucket size and compresses when threshold exceeded", async () => {
    for (let i = 0; i < 25; i++) {
      await store.recordSuccess("backend", { taskId: `t${i}` }, `Snippet ${i}`);
    }
    const mem = store.getMemory("backend");
    // 25 items inserted. Compression triggers when bucket > 20 (at item 21):
    // floor(21/2)=10, slice(10,21)=11 → bucket = [digest, ...11] = 12.
    // Then 4 more items added without re-triggering. Final length = 16.
    expect(mem.goodExamples.length).toBeLessThanOrEqual(16);
    expect(mem.goodExamples[0]).toMatch(/digest/);
  });

  it("persists memory across instances", async () => {
    await store.recordSuccess("backend", { taskId: "t1" }, "Persistent pattern");
    const store2 = new FileMemoryStore({ rootDir: dir });
    await store2.init();
    expect(store2.toPrelude("backend")).toContain("Persistent pattern");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
});