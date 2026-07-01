/**
 * API-layer PostgreSQL integration smoke test.
 *
 * Skipped when DATABASE_URL is unset (CI w/o PG, local dev) so the suite
 * stays green. When run with DATABASE_URL pointing at a real Postgres
 * (CI service container or local docker-compose), this proves the
 * `db ? new PgWorkspaceStore(db) : new FileWorkspaceStore(...)` switch in
 * `apps/api/src/index.ts` actually persists through to SQL.
 *
 * Why a slim Hono app instead of importing apps/api/src/index.ts:
 *   - `index.ts` is a 1500-line entry point that boots a real server
 *     and the full feature-flag machinery. Pulling that into a test
 *     would create side-effect regressions every time someone tweaks
 *     startup. A 50-line `app.request()` harness covers the actual
 *     regression: does PgWorkspaceStore work the way `index.ts` uses it?
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { createDb, closeDb, runMigrations, PgWorkspaceStore } from "@max/database";
import { probePostgres, probeWorkspaceDir } from "../src/lib/readiness.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.DATABASE_URL;
const forceSkip = process.env.MAX_DB_SKIP_PG === "1";
const skipPg = !url || forceSkip;
const d = skipPg ? describe.skip : describe;

d("API + PostgreSQL smoke (DATABASE_URL required)", () => {
  let db: ReturnType<typeof createDb>;
  let store: InstanceType<typeof PgWorkspaceStore>;
  let tmpDir: string;

  beforeAll(async () => {
    if (skipPg) return;
    db = createDb(url!);
    await runMigrations({ databaseUrl: url!, folder: "../../packages/database/drizzle" });
    store = new PgWorkspaceStore(db);
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "max-pg-api-"));
    // Clean any prior state so the test is hermetic against reruns.
    await db.execute({ sql: "DELETE FROM workspaces", params: [] } as never);
  });

  afterAll(async () => {
    if (skipPg) return;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    await closeDb();
  });

  it("probePostgres reports the live DB as healthy", async () => {
    const result = await probePostgres({ db, databaseUrl: url! });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("postgres");
    expect(result.latencyMs).toBeDefined();
    expect(result.latencyMs!).toBeGreaterThanOrEqual(0);
  });

  it("probeWorkspaceDir reports the directory as writable", async () => {
    const result = await probeWorkspaceDir(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("a Hono app wired to PgWorkspaceStore persists via /api/test/*", async () => {
    // This mirrors the wiring in apps/api/src/index.ts:
    //   const store = db ? new PgWorkspaceStore(db) : new FileWorkspaceStore(workspaceDir);
    // By mounting onto a fresh Hono app we avoid the side effects of
    // importing the 1500-line entry point, while still exercising the
    // store + the express-style request pipeline.
    const app = new Hono();
    app.post("/api/test/workspace", async (c) => {
      const body = (await c.req.json().catch(() => null)) as { id?: string; req?: string } | null;
      if (!body?.id || !body.req) return c.json({ error: "invalid" }, 400);
      await store.saveWorkspace({
        id: body.id,
        userRequest: body.req,
        status: "pending",
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      });
      return c.json({ ok: true, id: body.id });
    });
    app.get("/api/test/workspace/:id", async (c) => {
      const id = c.req.param("id");
      const ws = await store.loadWorkspace(id);
      return ws ? c.json({ ok: true, id, request: ws.userRequest }) : c.json({ error: "not_found" }, 404);
    });

    // Write through the API surface.
    const writeRes = await app.request("/api/test/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ws-pg-smoke", req: "hello pg" }),
    });
    expect(writeRes.status).toBe(200);
    const writeBody = (await writeRes.json()) as { ok: boolean; id: string };
    expect(writeBody).toEqual({ ok: true, id: "ws-pg-smoke" });

    // Read it back through the same surface — proves the row actually landed in PG,
    // not in some in-memory cache masquerading as the store.
    const readRes = await app.request("/api/test/workspace/ws-pg-smoke");
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as { ok: boolean; id: string; request: string };
    expect(readBody).toEqual({ ok: true, id: "ws-pg-smoke", request: "hello pg" });

    // Read of an unknown id returns 404, not a row leak.
    const missing = await app.request("/api/test/workspace/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("rows are visible via direct SQL — not just through the store", async () => {
    // Save via the store...
    await store.saveWorkspace({
      id: "ws-pg-direct",
      userRequest: "direct sql",
      status: "pending",
      results: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });
    // ...and read via raw SQL, bypassing the store abstraction entirely.
    // Catches regressions where the store silently writes to an
    // in-memory shadow instead of the table.
    const rows = (await db.execute({
      sql: 'SELECT id, user_request FROM workspaces WHERE id = $1',
      params: ["ws-pg-direct"],
    } as never)) as { rows?: Array<{ id: string; user_request: string }> };
    expect(rows.rows?.[0]?.user_request).toBe("direct sql");
  });
});
