/**
 * Permissions route tests — exercise GET / PUT / resolve / test / reset via a
 * minimal Hono app. The route is parameterised by a `rootDir` so the tests
 * can write into a temp directory instead of polluting `~/.maximilian`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import {
  permissionsRoutes,
  getPermissionsRoute,
  putPermissionsRoute,
  resolvePermissionRoute,
  testPermissionRoute,
  resetPermissionsRoute,
  answerPermissionRoute,
  auditPermissionsRoute,
} from "../src/routes/permissions";

function buildApp(rootDir: string) {
  const app = new Hono();
  const r = permissionsRoutes({ rootDir });
  app.get("/permissions", r.get);
  app.put("/permissions", r.put);
  app.post("/permissions/resolve", r.resolve);
  app.post("/permissions/test", r.test);
  app.post("/permissions/reset", r.reset);
  return app;
}

/**
 * OpenAPI-flavoured app for the audit endpoint — `c.req.valid("query")`
 * only works when the route is registered through `app.openapi()`.
 */
function buildOpenApiApp(rootDir: string, runtime?: {
  resolvePermission?: (id: string, d: "allow" | "deny") => boolean;
  getPermissionAudit?: (q?: { since?: string; limit?: number; tool?: string; workspaceId?: string }) => Array<Record<string, unknown>>;
}) {
  const app = new OpenAPIHono();
  const r = permissionsRoutes({ rootDir, runtime });
  app.openapi(getPermissionsRoute, r.get);
  app.openapi(putPermissionsRoute, r.put);
  app.openapi(resolvePermissionRoute, r.resolve);
  app.openapi(testPermissionRoute, r.test);
  app.openapi(resetPermissionsRoute, r.reset);
  app.openapi(answerPermissionRoute, r.answer);
  app.openapi(auditPermissionsRoute, r.audit);
  return app;
}

describe("permissions routes", () => {
  let tmp: string;
  let app: Hono;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "max-perms-"));
    app = buildApp(tmp);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("GET returns defaults when no file is persisted", async () => {
    const res = await app.request("/permissions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaults).toBeDefined();
    expect(body.defaults.bash).toBe("ask");
    expect(body.defaults.read).toBe("allow");
    expect(body.patterns).toEqual({});
  });

  it("PUT persists the config and GET returns the updated version", async () => {
    const put = await app.request("/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaults: {
          bash: "deny",
          write: "ask",
          edit: "ask",
          read: "allow",
          glob: "allow",
          grep: "allow",
        },
        patterns: { write: { "/tmp/**": "allow" } },
      }),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.defaults.bash).toBe("deny");
    expect(putBody.patterns.write).toEqual({ "/tmp/**": "allow" });

    // New app instance to verify persistence is on disk
    const fresh = buildApp(tmp);
    const get = await fresh.request("/permissions");
    const getBody = await get.json();
    expect(getBody.defaults.bash).toBe("deny");
    expect(getBody.patterns.write).toEqual({ "/tmp/**": "allow" });
  });

  it("PUT tolerates invalid actions and unknown tools (drops them)", async () => {
    const res = await app.request("/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaults: { bash: "always", read: "allow", bogus: "allow" },
        patterns: { write: { "/tmp/*": "allow", "**/.env": "deny" } },
      }),
    });
    const body = await res.json();
    expect(body.defaults.bash).toBe("ask"); // fell back
    expect(body.defaults.read).toBe("allow");
    expect(body.defaults.bogus).toBeUndefined();
    expect(body.patterns.write).toEqual({ "/tmp/*": "allow", "**/.env": "deny" });
  });

  it("POST /resolve returns the decision for a sample input", async () => {
    // Configure: bash → deny by default, /tmp/** write → allow
    await app.request("/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaults: { bash: "deny", write: "ask", edit: "ask", read: "ask", glob: "ask", grep: "ask" },
        patterns: { write: { "/tmp/**": "allow" } },
      }),
    });
    const res = await app.request("/permissions/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "write", input: { path: "/tmp/foo", content: "x" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool).toBe("write");
    expect(body.decision).toBe("allow");
  });

  it("POST /resolve rejects unknown tools with 400", async () => {
    const res = await app.request("/permissions/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "hypothetical", input: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_tool");
  });

  it("POST /test is pure — does not touch persisted config", async () => {
    const res = await app.request("/permissions/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "/tmp/**", value: "/tmp/foo/bar" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches).toBe(true);

    // confirm persisted config is still defaults
    const after = await app.request("/permissions");
    const afterBody = await after.json();
    expect(afterBody.defaults.bash).toBe("ask");
  });

  it("POST /reset restores DEFAULT_PERMISSIONS", async () => {
    // First, poison the config
    await app.request("/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaults: { bash: "deny", write: "deny", edit: "deny", read: "deny", glob: "deny", grep: "deny" },
        patterns: {},
      }),
    });
    const res = await app.request("/permissions/reset", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaults.bash).toBe("ask");
    expect(body.defaults.read).toBe("allow");
  });
});

describe("permissions audit endpoint", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "max-perms-audit-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 503 when runtime is not wired up", async () => {
    const app = buildOpenApiApp(tmp);
    const res = await app.request("/permissions/audit");
    expect(res.status).toBe(503);
  });

  it("returns audit entries from the runtime with optional filters", async () => {
    const entries = [
      {
        at: "2026-01-01T00:00:00Z",
        requestId: "r1",
        workspaceId: "ws-1",
        taskId: "t-1",
        tool: "bash",
        target: "/tmp/x",
        decision: "ask" as const,
      },
      {
        at: "2026-01-01T00:00:01Z",
        requestId: "r1",
        workspaceId: "ws-1",
        taskId: "t-1",
        tool: "bash",
        target: "/tmp/x",
        decision: "allow" as const,
        promptedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const app = buildOpenApiApp(tmp, {
      getPermissionAudit: (q) =>
        entries.filter((e) => (q?.tool ? e.tool === q.tool : true)),
      countPermissionAudit: (opts) =>
        entries.filter((e) => (opts?.tool ? e.tool === opts.tool : true)).length,
    });

    const res = await app.request("/permissions/audit?tool=bash&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.items[0].decision).toBe("ask");
  });

  it("total reflects full filtered count, not page size", async () => {
    // Regression: the old endpoint returned `items.length` as `total`,
    // so a request with limit=1 reported total=1 even when more rows
    // matched. Pin the fix: total = countMatching(filter).
    const entries = Array.from({ length: 5 }, (_, i) => ({
      at: `2026-01-01T00:00:0${i}Z`,
      requestId: `r${i}`,
      workspaceId: "ws-1",
      taskId: "t-1",
      tool: "bash",
      target: "/tmp/x",
      decision: "ask" as const,
    }));
    const app = buildOpenApiApp(tmp, {
      getPermissionAudit: (q) => {
        const filtered = entries.filter((e) =>
          q?.tool ? e.tool === q.tool : true,
        );
        return filtered.slice(0, q?.limit ?? 100);
      },
      countPermissionAudit: (opts) =>
        entries.filter((e) => (opts?.tool ? e.tool === opts.tool : true)).length,
    });

    const res = await app.request("/permissions/audit?limit=2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(5);
  });

  it("returns 400 when the limit is out of range", async () => {
    const app = buildOpenApiApp(tmp, {
      getPermissionAudit: () => [],
    });
    const res = await app.request("/permissions/audit?limit=99999");
    expect(res.status).toBe(400);
  });
});
