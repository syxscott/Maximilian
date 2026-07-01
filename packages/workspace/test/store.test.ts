/**
 * Tests for the FileWorkspaceStore in @max/workspace.
 *
 * Covers the round-trip and tenant-isolation behavior:
 *   - save/load round-trips a Workspace, JSON shape preserved
 *   - saveWorkspace also writes a `tenant/{id}` key
 *   - loadWorkspace with mismatched tenant returns undefined
 *   - loadWorkspace with no tenant claim (dev mode) refuses tenant-owned data
 *   - listWorkspaces filters by tenant (no cross-tenant enumeration)
 *   - save/read/listArtifacts round-trips file content with sanitized names
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Workspace } from "@max/core";
import { FileWorkspaceStore } from "../src/index.js";

let rootDir: string;
let store: FileWorkspaceStore;

function makeWorkspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    userRequest: `request for ${id}`,
    status: "planning",
    results: [],
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-store-"));
  store = new FileWorkspaceStore({ rootDir });
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe("FileWorkspaceStore — workspaces", () => {
  it("round-trips a workspace via saveWorkspace + loadWorkspace", async () => {
    const ws = makeWorkspace("ws-1", { status: "executing" });
    await store.saveWorkspace(ws);
    const loaded = await store.loadWorkspace("ws-1");
    expect(loaded).toEqual(ws);
  });

  it("writes a tenant key when tenantId is provided", async () => {
    await store.saveWorkspace(makeWorkspace("ws-2"), "tenant-A");
    const tenantPath = path.join(rootDir, "tenant", "ws-2");
    const raw = await fs.readFile(tenantPath, "utf-8");
    expect(raw).toBe("tenant-A");
  });

  it("loadWorkspace returns undefined for unknown id", async () => {
    const loaded = await store.loadWorkspace("does-not-exist");
    expect(loaded).toBeUndefined();
  });

  it("loadWorkspace with mismatched tenant returns undefined", async () => {
    await store.saveWorkspace(makeWorkspace("ws-3"), "tenant-A");
    const loaded = await store.loadWorkspace("ws-3", "tenant-B");
    expect(loaded).toBeUndefined();
  });

  it("loadWorkspace in dev mode (no tenant claim) refuses tenant-owned data", async () => {
    await store.saveWorkspace(makeWorkspace("ws-4"), "tenant-A");
    const loaded = await store.loadWorkspace("ws-4");
    expect(loaded).toBeUndefined();
  });

  it("listWorkspaces filters by tenantId when provided", async () => {
    await store.saveWorkspace(makeWorkspace("a"), "tenant-A");
    await store.saveWorkspace(makeWorkspace("b"), "tenant-A");
    await store.saveWorkspace(makeWorkspace("c"), "tenant-B");
    await store.saveWorkspace(makeWorkspace("d")); // dev / no tenant

    const aIds = await store.listWorkspaces("tenant-A");
    const bIds = await store.listWorkspaces("tenant-B");
    const devIds = await store.listWorkspaces();

    expect(aIds.sort()).toEqual(["a", "b"]);
    expect(bIds).toEqual(["c"]);
    expect(devIds).toEqual(["d"]);
  });
});

describe("FileWorkspaceStore — artifacts", () => {
  it("save/read/list artifacts round-trips content with sanitized names", async () => {
    // Filename with spaces and slashes gets sanitized to underscores.
    const stored = await store.saveArtifact("ws-5", "report v2/final.md", "abc123");
    expect(stored).toBe("report_v2_final.md");

    const content = await store.readArtifact("ws-5", stored);
    expect(content).toBe("abc123");

    const all = await store.listArtifacts("ws-5");
    expect(all).toEqual(["report_v2_final.md"]);
  });

  it("readArtifact returns undefined for missing artifact", async () => {
    const content = await store.readArtifact("ws-5", "missing.md");
    expect(content).toBeUndefined();
  });
});