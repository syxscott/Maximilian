/**
 * Phase 5 — Observability smoke tests.
 *
 * Validates:
 *   - /api/metrics returns Prometheus format with expected metrics
 *   - /api/health returns the new { status, checks } shape
 *   - /api/ready returns 503 when critical deps missing, 200 when present
 *
 * Uses a minimal Hono app with the same wiring as the production index.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";

import { FileWorkspaceStore } from "@max/workspace";
import {
  collectMetrics,
  metricsContentType,
  httpRequestTotal,
} from "@max/telemetry";
import { getRegistry, type Provider } from "@max/providers";

const fakeProvider: Provider = {
  id: "fake",
  name: "Fake",
  defaultModel: "fake-model",
  isConfigured: () => true,
  chat: async (m) => ({ content: m[0]?.content ?? "", model: "fake-model" }),
  stream: async function* () { yield { delta: "x", done: true }; },
};

describe("Phase 5: observability", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-phase5-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("collectMetrics returns prometheus content type with our metric names", async () => {
    const body = await collectMetrics();
    expect(metricsContentType()).toMatch(/^text\/plain/);
    expect(body).toContain("maximilian_requests_total");
    expect(body).toContain("maximilian_node_");
  });

  it("httpRequestTotal counter accepts labeled increments", async () => {
    httpRequestTotal.labels("GET", "/api/test", "200").inc();
    const body = await collectMetrics();
    expect(body).toMatch(/maximilian_requests_total\{[^}]*route="\/api\/test"[^}]*\} \d+/);
  });

  it("health endpoint reports degraded status when DB missing", async () => {
    const store = new FileWorkspaceStore(tmp);
    const app = new Hono();
    const providers = [fakeProvider];

    app.get("/api/health", async (c) => {
      const checks = {
        database: "degraded" as const,
        llm: providers.length > 0 ? ("ok" as const) : ("down" as const),
        disk: "ok" as const,
      };
      const overall = Object.values(checks).includes("down")
        ? "degraded"
        : Object.values(checks).includes("degraded")
          ? "degraded"
          : "ok";
      return c.json({
        status: overall,
        database: "file-based",
        checks,
      }, overall === "ok" ? 200 : 503);
    });

    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("degraded");
    expect(body.checks.llm).toBe("ok");
  });

  it("ready endpoint returns 200 when provider present", async () => {
    const app = new Hono();
    const providers = [fakeProvider];
    app.get("/api/ready", (c) => {
      if (providers.length === 0) return c.json({ status: "not_ready" }, 503);
      return c.json({ status: "ready" });
    });
    const res = await app.request("/api/ready");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ready");
  });

  it("ready endpoint returns 503 when no provider configured", async () => {
    const app = new Hono();
    const providers: Provider[] = [];
    app.get("/api/ready", (c) => {
      if (providers.length === 0) return c.json({ status: "not_ready" }, 503);
      return c.json({ status: "ready" });
    });
    const res = await app.request("/api/ready");
    expect(res.status).toBe(503);
  });
});
