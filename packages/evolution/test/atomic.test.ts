/**
 * Tests for the atomic file write helpers used by EvolutionEngine to
 * record decisions and version files. The helpers were extracted so a
 * crash mid-write can't leave a JSON file half-written (which on next
 * read either fails JSON.parse or yields corrupted state).
 *
 * The mtime-based retry in readModifyWriteAtomic is best-effort CAS —
 * not a true lock — but it's enough to eliminate the lost-update window
 * for low-contention single-process writes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeFileAtomic,
  readModifyWriteAtomic,
} from "../src/atomic.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-atomic-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes content that survives re-read", async () => {
    const target = path.join(tmpRoot, "subdir", "file.json");
    await writeFileAtomic(target, '{"hello":"world"}');
    const got = await fs.readFile(target, "utf-8");
    expect(got).toBe('{"hello":"world"}');
  });

  it("creates parent directories recursively", async () => {
    const target = path.join(tmpRoot, "a", "b", "c", "file.json");
    await writeFileAtomic(target, "x");
    const stat = await fs.stat(target);
    expect(stat.isFile()).toBe(true);
  });

  it("overwrites an existing file", async () => {
    const target = path.join(tmpRoot, "file.json");
    await writeFileAtomic(target, "first");
    await writeFileAtomic(target, "second");
    expect(await fs.readFile(target, "utf-8")).toBe("second");
  });

  it("does not leave temp files behind on success", async () => {
    const target = path.join(tmpRoot, "file.json");
    await writeFileAtomic(target, "ok");
    const entries = await fs.readdir(tmpRoot);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up the temp file on write failure", async () => {
    // Pass a content type that fs.writeFile rejects (a circular ref
    // serialized via JSON.stringify would silently produce "{}" but
    // passing an unsupported option isn't easy either — instead, force
    // a failure by writing to a path under a file that exists as a
    // regular file, so the mkdir fails).
    const blocker = path.join(tmpRoot, "blocker");
    await fs.writeFile(blocker, "i am a file, not a dir");
    const target = path.join(blocker, "child", "file.json");
    await expect(writeFileAtomic(target, "x")).rejects.toThrow();

    // No stray .tmp files anywhere under blocker (it isn't a directory
    // so readdir will throw — just check tmpRoot).
    const entries = await fs.readdir(tmpRoot);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});

describe("readModifyWriteAtomic", () => {
  it("creates the file with default value when missing", async () => {
    const target = path.join(tmpRoot, "decisions.json");
    const out = await readModifyWriteAtomic<number[]>(target, [], (cur) => [...cur, 1]);
    expect(out).toEqual([1]);
    const raw = await fs.readFile(target, "utf-8");
    expect(JSON.parse(raw)).toEqual([1]);
  });

  it("appends to the existing array on a second call", async () => {
    const target = path.join(tmpRoot, "decisions.json");
    await readModifyWriteAtomic<number[]>(target, [], (cur) => [...cur, 1]);
    const out = await readModifyWriteAtomic<number[]>(target, [], (cur) => [...cur, 2]);
    expect(out).toEqual([1, 2]);
    const raw = await fs.readFile(target, "utf-8");
    expect(JSON.parse(raw)).toEqual([1, 2]);
  });

  it("serial format is human-readable JSON", async () => {
    // Other code paths (e.g. operator debugging) rely on the file being
    // pretty-printed. Don't switch to compact JSON without updating them.
    const target = path.join(tmpRoot, "decisions.json");
    await readModifyWriteAtomic<{ a: number }>(target, { a: 0 }, (cur) => ({ a: cur.a + 1 }));
    const raw = await fs.readFile(target, "utf-8");
    expect(raw).toContain("\n"); // pretty-printed
    expect(JSON.parse(raw)).toEqual({ a: 1 });
  });

  it("concurrent writers: with mtime CAS, both writes land or one retries cleanly", async () => {
    // We can't deterministically force a mtime-mismatch retry in a unit
    // test without faking timers, but we can verify that two real
    // concurrent writers don't produce a torn write: the final file is
    // parseable, and the array contains at least the elements each
    // writer appended (possibly with one of them re-applying under
    // contention — that's fine, the data isn't lost).
    const target = path.join(tmpRoot, "decisions.json");
    await fs.writeFile(target, "[]", "utf-8");

    const writers: Promise<number[]>[] = [];
    for (let i = 0; i < 8; i++) {
      writers.push(
        readModifyWriteAtomic<number[]>(target, [], (cur) => [...cur, i]),
      );
    }
    const results = await Promise.all(writers);

    // Every writer's local view should have included its own i.
    for (let i = 0; i < 8; i++) {
      expect(results[i]).toContain(i);
    }

    // The final file must be parseable JSON (no torn write).
    const finalRaw = await fs.readFile(target, "utf-8");
    const finalArr = JSON.parse(finalRaw) as number[];
    expect(Array.isArray(finalArr)).toBe(true);
    // All 8 indices must be present — the mtime CAS retry ensures no
    // writer's contribution is silently dropped.
    for (let i = 0; i < 8; i++) {
      expect(finalArr).toContain(i);
    }
  });
});