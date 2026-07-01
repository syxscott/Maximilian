/**
 * Tests for the atomic write helpers in @max/workspace.
 *
 * Covers:
 *   - writeFileAtomic creates the target on first call and overwrites
 *     existing content (no truncation, no leftover temp files).
 *   - readModifyWriteAtomic applies the transform to existing JSON.
 *   - readModifyWriteAtomic uses `defaultValue` when the file is missing.
 *   - Two concurrent readModifyWriteAtomic callers on the same target
 *     serialize cleanly (mkdir-based file lock) — no clobber.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic, readModifyWriteAtomic } from "../src/atomic.js";

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-atomic-"));
});

afterEach(async () => {
  await fs.rm(scratchDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates the target file when missing", async () => {
    const target = path.join(scratchDir, "nested", "out.json");
    await writeFileAtomic(target, "hello");
    const actual = await fs.readFile(target, "utf-8");
    expect(actual).toBe("hello");
  });

  it("overwrites existing content atomically (no leftover tmp)", async () => {
    const target = path.join(scratchDir, "out.json");
    await writeFileAtomic(target, "first");
    await writeFileAtomic(target, "second");
    const actual = await fs.readFile(target, "utf-8");
    expect(actual).toBe("second");
    // No leftover temp files (basename.*.tmp) in the directory.
    const entries = await fs.readdir(scratchDir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up its tmp file when write fails", async () => {
    const target = path.join(scratchDir, "out.json");
    // Pre-create target as a *directory* so the rename() inside writeFileAtomic
    // throws ENOTDIR — this exercises the catch-and-cleanup branch.
    await fs.mkdir(target);
    await expect(writeFileAtomic(target, "boom")).rejects.toThrow();
    const entries = await fs.readdir(scratchDir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});

describe("readModifyWriteAtomic", () => {
  it("applies transform to existing JSON content", async () => {
    const target = path.join(scratchDir, "counter.json");
    await writeFileAtomic(target, JSON.stringify({ n: 1 }));
    const next = await readModifyWriteAtomic<{ n: number }>(
      target,
      { n: 0 },
      (current) => ({ n: current.n + 1 }),
    );
    expect(next).toEqual({ n: 2 });
    const onDisk = JSON.parse(await fs.readFile(target, "utf-8"));
    expect(onDisk).toEqual({ n: 2 });
  });

  it("uses defaultValue when the file is missing", async () => {
    const target = path.join(scratchDir, "absent.json");
    const next = await readModifyWriteAtomic<{ tag: string }>(
      target,
      { tag: "fresh" },
      (current) => ({ tag: `${current.tag}!` }),
    );
    expect(next).toEqual({ tag: "fresh!" });
    const onDisk = JSON.parse(await fs.readFile(target, "utf-8"));
    expect(onDisk).toEqual({ tag: "fresh!" });
  });

  it("serializes concurrent writers on the same target (no clobber)", async () => {
    // Each writer does a read-modify-write that increments a counter.
    // With proper locking the final value equals the number of writers;
    // without it, races drop increments and the final value is < N.
    const target = path.join(scratchDir, "shared.json");
    await writeFileAtomic(target, JSON.stringify({ n: 0 }));

    const N = 30;
    const ids = Array.from({ length: N }, () => randomUUID());
    await Promise.all(
      ids.map(() =>
        readModifyWriteAtomic<{ n: number }>(target, { n: 0 }, (cur) => ({ n: cur.n + 1 })),
      ),
    );

    const final = JSON.parse(await fs.readFile(target, "utf-8")) as { n: number };
    expect(final.n).toBe(N);
  });

  it("releases the lock when the transform throws", async () => {
    const target = path.join(scratchDir, "explode.json");
    await writeFileAtomic(target, JSON.stringify({ n: 0 }));
    await expect(
      readModifyWriteAtomic(target, { n: 0 }, () => {
        throw new Error("user transform failed");
      }),
    ).rejects.toThrow(/user transform failed/);

    // Lock must be released — a follow-up write should succeed promptly.
    const next = await readModifyWriteAtomic<{ n: number }>(
      target,
      { n: 0 },
      (cur) => ({ n: cur.n + 1 }),
    );
    expect(next.n).toBe(1);
  });
});