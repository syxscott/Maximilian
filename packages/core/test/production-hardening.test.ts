// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CircuitBreaker,
  CircuitOpenError,
  maskHeaders,
  maskBody,
  maskString,
  HotReloadConfig,
  BatchedPersister,
} from "../src/index.js";

describe("Borrowed — CircuitBreaker", () => {
  let breaker: CircuitBreaker;
  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, coolDownMs: 50, label: "test" });
  });

  it("starts closed and lets traffic through", async () => {
    expect(breaker.getState()).toBe("closed");
    const out = await breaker.execute(async () => 42);
    expect(out).toBe(42);
    expect(breaker.getStats().totalSuccesses).toBe(1);
  });

  it("opens after failureThreshold failures", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe("open");
    expect(breaker.getStats().totalFailures).toBe(3);
  });

  it("short-circuits with CircuitOpenError while open", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // expected
      }
    }
    let caught: unknown = null;
    try {
      await breaker.execute(async () => "should not run");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CircuitOpenError);
    expect(breaker.getStats().totalShortCircuited).toBe(1);
  });

  it("half-opens after coolDownMs and closes on success", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(breaker.getState()).toBe("half-open");
    const out = await breaker.execute(async () => "ok");
    expect(out).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens if half-open probe fails", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    try {
      await breaker.execute(async () => {
        throw new Error("still bad");
      });
    } catch {
      // expected
    }
    expect(breaker.getState()).toBe("open");
  });
});

describe("Borrowed — log masking", () => {
  it("masks common API key shapes in strings", () => {
    const text = "key=sk-proj-abc123def456ghi789jkl012mno345pqr678 end";
    const out = maskString(text);
    expect(out).not.toContain("sk-proj-abc123def456ghi789jkl012mno345pqr678");
    expect(out).toContain("[REDACTED]");
  });

  it("masks Bearer tokens", () => {
    const out = maskString("Authorization: Bearer abc123def456ghi789jkl012mnop");
    expect(out).toContain("[REDACTED]");
  });

  it("masks Authorization header", () => {
    const out = maskHeaders({
      "content-type": "application/json",
      authorization: "Bearer abc123def456ghi789jkl012mnop",
    });
    expect(out["content-type"]).toBe("application/json");
    expect(out["authorization"]).toBe("***");
  });

  it("recursively masks JSON body fields", () => {
    const out = maskBody({
      username: "alice",
      password: "hunter2",
      nested: { api_key: "sk-proj-abc123def456ghi789jkl012mno345pqr678" },
      safe: "harmless",
    }) as Record<string, unknown>;
    expect(out["username"]).toBe("alice");
    expect(out["password"]).toBe("***REDACTED***");
    expect((out["nested"] as Record<string, unknown>)["api_key"]).toBe("***REDACTED***");
    expect(out["safe"]).toBe("harmless");
  });

  it("does not mutate the input", () => {
    const input = { password: "hunter2", safe: "ok" };
    const before = JSON.stringify(input);
    maskBody(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("Borrowed — HotReloadConfig", () => {
  let tmpDir: string;
  let cfgFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mx-hot-reload-"));
    cfgFile = path.join(tmpDir, "config.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts with an initial snapshot and surfaces current values", async () => {
    const cfg = new HotReloadConfig<{ threshold: number }>(cfgFile, {
      initial: { threshold: 5 },
      intervalMs: 50,
    });
    expect(cfg.current()).toEqual({ threshold: 5 });
    expect(cfg.get("threshold", 0)).toBe(5);
  });

  it("fires per-key callbacks when the file changes", async () => {
    const cfg = new HotReloadConfig<{ threshold: number; label: string }>(cfgFile, {
      initial: { threshold: 5, label: "a" },
      intervalMs: 50,
    });
    await cfg.start();
    const events: Array<{ key: string; newV: unknown; oldV: unknown }> = [];
    cfg.on("threshold", (key, newV, oldV) => {
      events.push({ key, newV, oldV });
    });

    await fs.writeFile(cfgFile, JSON.stringify({ threshold: 10, label: "a" }));
    await new Promise((r) => setTimeout(r, 200));

    cfg.stop();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.key).toBe("threshold");
    expect(events[0]?.newV).toBe(10);
    expect(events[0]?.oldV).toBe(5);
  });
});

describe("Borrowed — BatchedPersister", () => {
  it("batches up to batchSize items", async () => {
    const flushed: number[][] = [];
    const persister = new BatchedPersister<number>({
      batchSize: 3,
      flushIntervalMs: 60_000, // never auto-flush
      flush: async (items) => {
        flushed.push(items);
      },
      label: "test",
    });
    persister.start();
    persister.add(1);
    persister.add(2);
    expect(persister.stats().pending).toBe(2);
    persister.add(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(flushed).toEqual([[1, 2, 3]]);
    expect(persister.stats().totalFlushed).toBe(3);
    await persister.dispose();
  });

  it("counts dropped items on backpressure", async () => {
    const flushed: number[][] = [];
    const persister = new BatchedPersister<number>({
      batchSize: 2,
      maxBuffer: 2,
      flushIntervalMs: 60_000,
      flush: async (items) => {
        flushed.push(items);
      },
      label: "test",
    });
    persister.start();
    for (let i = 0; i < 10; i++) persister.add(i);
    await new Promise((r) => setTimeout(r, 50));
    const stats = persister.stats();
    expect(stats.totalAdded).toBe(10);
    expect(stats.totalDropped).toBeGreaterThan(0);
    await persister.dispose();
  });

  it("flushes pending items on dispose", async () => {
    const flushed: number[][] = [];
    const persister = new BatchedPersister<number>({
      batchSize: 100,
      flushIntervalMs: 60_000,
      flush: async (items) => {
        flushed.push(items);
      },
      label: "test",
    });
    persister.start();
    persister.add(1);
    persister.add(2);
    await persister.dispose();
    expect(flushed).toEqual([[1, 2]]);
  });

  it("counts flushed items even on flush failure", async () => {
    const persister = new BatchedPersister<number>({
      batchSize: 2,
      flushIntervalMs: 60_000,
      flush: async () => {
        throw new Error("db down");
      },
      label: "test",
    });
    persister.start();
    persister.add(1);
    persister.add(2);
    await new Promise((r) => setTimeout(r, 30));
    const stats = persister.stats();
    expect(stats.totalFlushCalls).toBe(1);
    expect(stats.totalDropped).toBe(2);
    await persister.dispose();
  });
});