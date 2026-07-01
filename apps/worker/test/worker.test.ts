/**
 * Tests for apps/worker.
 *
 * Covers the static surface that's reachable without spawning the real
 * BullMQ consumer (which would require a live Redis + PostgreSQL):
 *   - The worker's heartbeat-key constant is the same one the queue uses
 *     (no drift between producer/consumer/observer)
 *   - The worker package exposes the expected npm scripts and dependencies
 *     so it's runnable via `pnpm --filter @max/worker start`
 *   - The bootstrap source registers SIGTERM + SIGINT handlers (graceful
 *     shutdown wiring) and references the env vars that the deploy
 *     runbook mandates (REDIS_URL, DATABASE_URL)
 *
 * Live integration is covered by the load-test workflow (.github/workflows/load.yml),
 * which boots the worker against the test DB + Redis service containers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HEARTBEAT_KEY } from "@max/queue";

describe("worker ↔ queue constants", () => {
  it("HEARTBEAT_KEY is the canonical maximilian:worker:heartbeat", () => {
    expect(HEARTBEAT_KEY).toBe("maximilian:worker:heartbeat");
  });
});

describe("worker package metadata", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

  it("has start / build / test scripts", () => {
    expect(pkg.scripts.start).toMatch(/node dist\/index\.js/);
    expect(pkg.scripts.build).toBe("tsc");
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("depends on @max/queue (producer/consumer contract)", () => {
    expect(pkg.dependencies["@max/queue"]).toBe("workspace:*");
  });

  it("depends on bullmq + ioredis directly", () => {
    expect(pkg.dependencies.bullmq).toBeTruthy();
    expect(pkg.dependencies.ioredis).toBeTruthy();
  });
});

describe("worker bootstrap source", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");

  it("registers SIGTERM + SIGINT handlers for graceful shutdown", () => {
    expect(src).toMatch(/process\.on\(\s*["']SIGTERM["']/);
    expect(src).toMatch(/process\.on\(\s*["']SIGINT["']/);
  });

  it("requires REDIS_URL and DATABASE_URL via config", () => {
    expect(src).toContain("REDIS_URL");
    expect(src).toContain("DATABASE_URL");
    // Both must be treated as fatal-if-missing.
    expect(src).toMatch(/REDIS_URL.*required/is);
    expect(src).toMatch(/DATABASE_URL.*required/is);
  });

  it("imports HEARTBEAT_KEY from @max/queue (no string drift)", () => {
    // The healthcheck script is the one that reads the heartbeat key.
    // If both files used different literals, the API's liveness check
    // would never see the worker's writes.
    const healthcheck = readFileSync(
      new URL("../src/healthcheck.ts", import.meta.url),
      "utf-8",
    );
    expect(healthcheck).toMatch(/import\s+\{[^}]*HEARTBEAT_KEY[^}]*\}\s+from\s+["']@max\/queue["']/);
  });
});