/**
 * OpenAPI exposure — verify the 6 permission routes + workspaces routes +
 * providers route show up in the spec, with correct method/path mapping
 * and request body schemas.
 *
 * The production `apps/api/src/index.ts` uses `OpenAPIHono` to register
 * every route and serves `/api/openapi.json` from it. Here we replicate
 * the same wiring against a temp `rootDir` so the test never touches
 * `~/.maximilian`.
 */

import { describe, it, expect } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  permissionsRoutes,
  getPermissionsRoute,
  putPermissionsRoute,
  resolvePermissionRoute,
  testPermissionRoute,
  resetPermissionsRoute,
  answerPermissionRoute,
} from "../src/routes/permissions";
import {
  listWorkspacesRoute,
  getWorkspaceRoute,
  getWorkspaceEventsRoute,
  listArtifactsRoute,
  getArtifactRoute,
  streamWorkspaceRoute,
} from "../src/routes/workspace";
import { listProvidersRoute } from "../src/routes/system";

describe("OpenAPI exposure of permission routes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "max-perms-openapi-"));

  const app = new OpenAPIHono();
  const r = permissionsRoutes({ rootDir: tmp });
  app.openapi(getPermissionsRoute, r.get);
  app.openapi(putPermissionsRoute, r.put);
  app.openapi(resolvePermissionRoute, r.resolve);
  app.openapi(testPermissionRoute, r.test);
  app.openapi(resetPermissionsRoute, r.reset);
  app.openapi(answerPermissionRoute, r.answer);
  app.openapi(listProvidersRoute, (c) => c.json({ providers: [] }));
  app.openapi(listWorkspacesRoute, (c) => c.json({ items: [], total: 0 }));
  app.openapi(getWorkspaceRoute, (c) => c.json({}));
  app.openapi(getWorkspaceEventsRoute, (c) => c.json({ workspaceId: "x", events: [] }));
  app.openapi(listArtifactsRoute, (c) => c.json({ workspaceId: "x", artifacts: [] }));
  app.openapi(getArtifactRoute, (c) => c.text(""));
  app.openapi(streamWorkspaceRoute, (c) =>
    c.body("data: {}\n\n", 200, { "Content-Type": "text/event-stream" }),
  );
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Test API", version: "0.0.0" },
  });

  rmSync(tmp, { recursive: true, force: true });

  it("registers all 6 permission paths in the OpenAPI document", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };

    const expected = {
      "/permissions": ["get", "put"],
      "/permissions/resolve": ["post"],
      "/permissions/test": ["post"],
      "/permissions/reset": ["post"],
      "/permissions/answer": ["post"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      expect(doc.paths[path], `path ${path} should exist`).toBeDefined();
      for (const m of methods) {
        expect(doc.paths[path][m], `${m.toUpperCase()} ${path} should be registered`).toBeDefined();
      }
    }
  });

  it("documents the request body schema for PUT /permissions", async () => {
    const res = await app.request("/openapi.json");
    const doc = (await res.json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content?: Record<string, { schema?: { properties?: Record<string, unknown> } }>;
            };
          }
        >
      >;
    };
    const put = doc.paths["/permissions"]["put"];
    expect(put?.requestBody?.content?.["application/json"]?.schema?.properties).toBeDefined();
  });

  it("registers workspace + system routes", async () => {
    const res = await app.request("/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths["/workspaces"]).toBeDefined();
    expect(doc.paths["/workspaces/{id}"]).toBeDefined();
    expect(doc.paths["/workspaces/{id}/events"]).toBeDefined();
    expect(doc.paths["/workspaces/{id}/stream"]).toBeDefined();
    expect(doc.paths["/workspaces/{id}/artifacts"]).toBeDefined();
    expect(doc.paths["/workspaces/{id}/artifacts/{name}"]).toBeDefined();
    expect(doc.paths["/providers"]).toBeDefined();
  });
});
