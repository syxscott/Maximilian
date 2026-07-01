/**
 * Readiness probe tests — verifies each individual probe in
 * `lib/readiness.ts` plus the aggregate helper.
 *
 * These run in isolation against mocked dependencies so we don't have
 * to spin up Postgres or the full Hono app to verify the wire-up.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  probePostgres,
  probeLlm,
  probeWorkspaceDir,
  runReadinessChecks,
} from "../src/lib/readiness";

describe("probePostgres", () => {
  it("reports ok when DATABASE_URL is unset (file storage mode)", async () => {
    const r = await probePostgres({ db: null, databaseUrl: undefined });
    expect(r.ok).toBe(true);
    expect(r.error).toContain("file storage");
  });

  it("reports failure when DATABASE_URL is set but db client is missing", async () => {
    const r = await probePostgres({ db: null, databaseUrl: "postgres://x" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("db client missing");
  });

  it("reports ok when query succeeds", async () => {
    const r = await probePostgres({
      db: { execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
      databaseUrl: "postgres://x",
      runQuery: () => Promise.resolve([{ "?column?": 1 }]),
    });
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports failure when query throws", async () => {
    const r = await probePostgres({
      db: { execute: vi.fn() },
      databaseUrl: "postgres://x",
      runQuery: () => Promise.reject(new Error("connection refused")),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("connection refused");
  });

  it("reports timeout when query hangs past 2s", async () => {
    const r = await probePostgres({
      db: { execute: vi.fn() },
      databaseUrl: "postgres://x",
      runQuery: () => new Promise(() => {}), // never resolves
    });
    // We race against a 2s timer; the test should resolve within ~2s
    // (the probe itself wraps the query in setTimeout(...,2000)).
    const start = Date.now();
    const result = await r;
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    expect(elapsed).toBeLessThan(2500); // generous bound
  });
});

describe("probeLlm", () => {
  it("reports failure when no providers configured", () => {
    const r = probeLlm(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no providers");
  });

  it("reports ok with provider count when at least one configured", () => {
    const r = probeLlm(3);
    expect(r.ok).toBe(true);
    expect(r.error).toContain("3 provider");
  });
});

describe("probeWorkspaceDir", () => {
  it("reports ok when directory is writable", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "max-ready-"));
    try {
      const r = await probeWorkspaceDir(tmp);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports failure for non-existent directory", async () => {
    const r = await probeWorkspaceDir("/nonexistent/max-ready-path-xyz");
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe("runReadinessChecks (aggregate)", () => {
  it("returns ok:true when every probe passes", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "max-ready-agg-"));
    try {
      const { ok, checks } = await runReadinessChecks({
        db: null,
        databaseUrl: undefined, // file storage mode → postgres ok
        providerCount: 2,
        workspaceDir: tmp,
      });
      expect(ok).toBe(true);
      expect(checks).toHaveLength(3);
      expect(checks.every((c) => c.ok)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns ok:false when any probe fails", async () => {
    const { ok, checks } = await runReadinessChecks({
      db: { execute: vi.fn() },
      databaseUrl: "postgres://x", // present but db.execute throws
      providerCount: 0, // no providers
      workspaceDir: "/nonexistent/path",
      runQuery: () => Promise.reject(new Error("down")),
    });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "postgres")?.ok).toBe(false);
    expect(checks.find((c) => c.name === "llm")?.ok).toBe(false);
    expect(checks.find((c) => c.name === "workspace_dir")?.ok).toBe(false);
  });
});