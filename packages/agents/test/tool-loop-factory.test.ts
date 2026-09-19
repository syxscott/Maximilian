// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tool-loop factory tests (minimax-code borrowing): createDefaultAgentFactory
 * attaches a permission-gated ToolEnabledProvider to every agent, scoped by
 * the role manifest's allowedTools.
 */
import { describe, it, expect } from "vitest"
import type { Provider } from "@max/providers"
import { createDefaultAgentFactory, defaultAgentFactory } from "../src/index.js"

const stubProvider: Provider = {
  id: "stub",
  name: "Stub",
  defaultModel: "stub-1",
  isConfigured: () => true,
  async chat() {
    return { content: "ok", model: "stub-1" }
  },
  // eslint-disable-next-line require-yield
  async *stream() {
    throw new Error("not used")
  },
}

describe("createDefaultAgentFactory", () => {
  it("attaches a tool provider to execution agents", async () => {
    const factory = await createDefaultAgentFactory(() => stubProvider)
    const backend = factory("backend")
    expect(backend).toBeDefined()
    const tp = backend!.getToolProvider()
    expect(tp).toBeDefined()
    const names = tp!.getToolDefinitions().map((d) => d.name)
    expect(names).toContain("bash")
    expect(names).toContain("read")
  })

  it("review agent is read-only (manifest.allowedTools applied)", async () => {
    const factory = await createDefaultAgentFactory(() => stubProvider)
    const review = factory("review")
    expect(review).toBeDefined()
    // The runtime applies manifest.allowedTools via setToolAllowlist —
    // mirror that here to verify the gate.
    const tp = review!.getToolProvider()!
    tp.setToolAllowlist(review!.manifest.allowedTools)
    const names = tp.getToolDefinitions().map((d) => d.name)
    expect(names).toContain("read")
    expect(names).not.toContain("bash")
    expect(names).not.toContain("write")
    expect(names).not.toContain("edit")
  })

  it("tool provider uses the same provider instance as the agent", async () => {
    const factory = await createDefaultAgentFactory(() => stubProvider)
    const backend = factory("backend")!
    expect(backend.getToolProvider()!.id).toBe(stubProvider.id)
  })

  it("legacy defaultAgentFactory stays tool-free (back-compat)", () => {
    const factory = defaultAgentFactory(() => stubProvider)
    const backend = factory("backend")!
    expect(backend.getToolProvider()).toBeUndefined()
  })

  it("unknown roles return undefined in both factories", async () => {
    const factory = await createDefaultAgentFactory(() => stubProvider)
    expect(factory("nonexistent" as never)).toBeUndefined()
    expect(defaultAgentFactory(() => stubProvider)("nonexistent" as never)).toBeUndefined()
  })
})
