/**
 * Regression tests for tenant isolation in the FileWorkspaceStore.
 *
 * These guard against the C3 family of bugs where a workspace saved with
 * a tenant could be read by:
 *   1. An unauthenticated/dev caller (no tenantId argument)
 *   2. A caller with a different tenantId
 *
 * The fix writes a tenant key for every save (empty string for dev) and
 * enforces matching on load — both directions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileWorkspaceStore } from "@max/workspace";
import type { Workspace } from "@max/core";

function makeWorkspace(id: string): Workspace {
  return {
    id,
    userRequest: "test",
    status: "planning",
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}

describe("FileWorkspaceStore tenant isolation", () => {
  let tmpDir: string;
  let store: FileWorkspaceStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "max-tenant-"));
    store = new FileWorkspaceStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves a tenant key for every workspace, including dev (empty string)", async () => {
    await store.saveWorkspace(makeWorkspace("ws-dev"), undefined);
    const tenantFile = path.join(tmpDir, "tenant", "ws-dev");
    const raw = await fs.readFile(tenantFile, "utf-8");
    expect(raw).toBe("");
  });

  it("refuses to return a tenant-owned workspace to a dev caller", async () => {
    await store.saveWorkspace(makeWorkspace("ws-A"), "tenant-A");
    const ws = await store.loadWorkspace("ws-A");
    expect(ws).toBeUndefined();
  });

  it("refuses to return a tenant-owned workspace to a different tenant", async () => {
    await store.saveWorkspace(makeWorkspace("ws-A"), "tenant-A");
    const ws = await store.loadWorkspace("ws-A", "tenant-B");
    expect(ws).toBeUndefined();
  });

  it("returns a tenant-owned workspace to the owning tenant", async () => {
    await store.saveWorkspace(makeWorkspace("ws-A"), "tenant-A");
    const ws = await store.loadWorkspace("ws-A", "tenant-A");
    expect(ws?.id).toBe("ws-A");
  });

  it("returns a dev workspace to a dev caller", async () => {
    await store.saveWorkspace(makeWorkspace("ws-dev"), undefined);
    const ws = await store.loadWorkspace("ws-dev");
    expect(ws?.id).toBe("ws-dev");
  });

  it("legacy workspaces without a tenant file remain readable to dev callers", async () => {
    // Simulate data predating the always-write fix: only ws/, no tenant/.
    await fs.mkdir(path.join(tmpDir, "ws"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "ws", "ws-legacy"),
      JSON.stringify(makeWorkspace("ws-legacy")),
      "utf-8",
    );
    const devLoad = await store.loadWorkspace("ws-legacy");
    expect(devLoad?.id).toBe("ws-legacy");
    // ...but a tenanted caller must NOT see it (no tenant key means
    // "no tenant" in our model, not "anyone's tenant").
    const tenantLoad = await store.loadWorkspace("ws-legacy", "tenant-A");
    expect(tenantLoad).toBeUndefined();
  });

  it("listWorkspaces filters by tenant — dev caller only sees dev rows", async () => {
    await store.saveWorkspace(makeWorkspace("ws-dev-1"), undefined);
    await store.saveWorkspace(makeWorkspace("ws-dev-2"), undefined);
    await store.saveWorkspace(makeWorkspace("ws-A"), "tenant-A");
    await store.saveWorkspace(makeWorkspace("ws-B"), "tenant-B");

    const devList = await store.listWorkspaces();
    expect(devList.sort()).toEqual(["ws-dev-1", "ws-dev-2"]);

    const aList = await store.listWorkspaces("tenant-A");
    expect(aList).toEqual(["ws-A"]);

    const bList = await store.listWorkspaces("tenant-B");
    expect(bList).toEqual(["ws-B"]);
  });
});
