import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import type { Context } from "hono";
import type { FileWorkspaceStore } from "@max/workspace";
import type { EventLogRegistry } from "../event-log.js";
import {
  IdParamsSchema,
  ErrorSchema,
  WorkspaceSchema,
  WorkspaceListResponseSchema,
  WorkspaceListQuerySchema,
  ArtifactListResponseSchema,
} from "../schemas.js";

type AppEnv = { Variables: { requestId: string; userId?: string; userRole?: string; tenantId?: string } };

// ── Route definitions (for OpenAPI spec generation) ───────────────────────

export const listWorkspacesRoute = createRoute({
  method: "get",
  path: "/workspaces",
  tags: ["workspaces"],
  request: { query: WorkspaceListQuerySchema },
  responses: {
    200: { content: { "application/json": { schema: WorkspaceListResponseSchema } }, description: "Workspace list" },
  },
});

export const getWorkspaceRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}",
  tags: ["workspaces"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: WorkspaceSchema } }, description: "Workspace" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

export const listArtifactsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/artifacts",
  tags: ["workspaces"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: ArtifactListResponseSchema } }, description: "Artifact list" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

export const getArtifactRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/artifacts/{name}",
  tags: ["workspaces"],
  request: { params: z.object({ id: z.string(), name: z.string().regex(/^[^/\\]+$/, "Name must not contain path separators") }) },
  responses: {
    200: { content: { "text/plain": { schema: z.string() } }, description: "Artifact content" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

export const getWorkspaceEventsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/events",
  tags: ["workspaces"],
  request: { params: IdParamsSchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            workspaceId: z.string(),
            events: z.array(z.record(z.unknown())),
          }),
        },
      },
      description: "Full event log for the workspace",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

export const streamWorkspaceRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/stream",
  tags: ["workspaces"],
  request: { params: IdParamsSchema },
  responses: {
    200: {
      content: { "text/event-stream": { schema: z.string() } },
      description: "SSE stream of workspace events (replay from ?cursor= onward)",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
});

// ── Handlers ──────────────────────────────────────────────────────────────

export function listWorkspaces(store: FileWorkspaceStore) {
  return async (c: any) => {
    const tenantId = c.get("tenantId");
    const { cursor, limit } = c.req.valid("query");
    const ids = await store.listWorkspaces(tenantId);

    let startIdx = 0;
    if (cursor) {
      const cursorIdx = ids.indexOf(cursor);
      if (cursorIdx < 0) {
        return c.json({ error: "invalid_cursor", message: "Cursor not found" }, 400);
      }
      startIdx = cursorIdx + 1;
    }

    const items = ids.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < ids.length ? items[items.length - 1] : undefined;

    return c.json({ items, nextCursor, total: ids.length });
  };
}

export function getWorkspace(store: FileWorkspaceStore) {
  return async (c: any) => {
    const { id } = c.req.valid("param");
    const tenantId = c.get("tenantId");
    const ws = await store.loadWorkspace(id, tenantId);
    if (!ws) {
      return c.json({ error: "Workspace not found" }, 404);
    }
    return c.json(ws);
  };
}

export function listArtifacts(store: FileWorkspaceStore) {
  return async (c: any) => {
    const { id } = c.req.valid("param");
    const tenantId = c.get("tenantId");
    const ws = await store.loadWorkspace(id, tenantId);
    if (!ws) return c.json({ error: "Workspace not found" }, 404);
    const files = await store.listArtifacts(id);
    return c.json({ workspaceId: id, artifacts: files });
  };
}

export function getArtifact(store: FileWorkspaceStore) {
  return async (c: any) => {
    const { id, name } = c.req.valid("param");
    const tenantId = c.get("tenantId");
    const ws = await store.loadWorkspace(id, tenantId);
    if (!ws) return c.json({ error: "Workspace not found" }, 404);
    // Verify artifact belongs to this workspace (defense in depth)
    const artifacts = await store.listArtifacts(id);
    if (!artifacts.includes(name)) {
      return c.json({ error: "Artifact not found" }, 404);
    }
    const content = await store.readArtifact(id, name);
    if (content === undefined) {
      return c.json({ error: "Artifact not found" }, 404);
    }
    return c.text(content);
  };
}

/**
 * Returns the durable JSONL event log for a workspace.
 *
 * The previous implementation read from a per-process `Map`, which meant
 * every API restart erased the history. The `EventLogRegistry` writes a
 * `<eventsRootDir>/<workspaceId>.jsonl` file via `appendLocked`, so
 * the events survive restarts and `Last-Event-ID`-based SSE replay can
 * pick up where it left off. We unwrap the {seq, type, payload, ts}
 * envelope into the wire shape the runtime already produces
 * (`{ type, workspaceId, ...payload }`) so callers see the same field
 * order whether they hit this endpoint or the SSE stream.
 */
export function getWorkspaceEvents(
  store: FileWorkspaceStore,
  registry: EventLogRegistry,
) {
  return async (c: any) => {
    const { id } = c.req.valid("param");
    const tenantId = c.get("tenantId") as string | undefined;
    const ws = await store.loadWorkspace(id, tenantId);
    if (!ws) return c.json({ error: "Workspace not found" }, 404);
    const log = registry.for(id);
    const logged = await log.readAfter(0);
    // `logged.payload` is the original runtime event the publisher wrote;
    // splice seq/ts back in so the response shape stays self-describing.
    const events = logged.map((e) => ({
      ...(e.payload as Record<string, unknown>),
      seq: e.seq,
      ts: e.ts,
    }));
    return c.json({ workspaceId: id, events });
  };
}
