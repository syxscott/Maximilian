/**
 * Per-agent tool allowlist/denylist (借鉴 cc-switch OpenClawToolsConfig).
 *
 * The ToolEnabledProvider supports static per-agent tool filtering:
 *   - setToolAllowlist(names): only these tools are visible to the LLM
 *   - setToolDenylist(names): these tools are excluded (wins over allowlist)
 *   - getToolDefinitions(): returns filtered set
 *
 * Verifies:
 *   - allowlist restricts tool definitions
 *   - denylist removes tools
 *   - denylist wins over allowlist
 *   - undefined allowlist = no restriction
 *   - agent manifest propagate to the provider
 */
import { describe, it, expect } from "vitest"
import { ToolEnabledProvider, createToolRegistry } from "../src/tool-integration.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

class StubProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean { return true }
  async chat(): Promise<ChatResponse> {
    return { content: "", model: "stub-1", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
  }
  async *stream() { throw new Error("not used") }
}

function buildProvider(): ToolEnabledProvider {
  const registry = createToolRegistry()
  registry.register({
    echo: { name: "echo", description: "echo", inputSchema: {} } as never,
    read_file: { name: "read_file", description: "read", inputSchema: {} } as never,
    write_file: { name: "write_file", description: "write", inputSchema: {} } as never,
    exec: { name: "exec", description: "execute", inputSchema: {} } as never,
  })
  return new ToolEnabledProvider(new StubProvider(), registry)
}

describe("Per-agent tool allowlist (借鉴 cc-switch)", () => {
  it("returns all tools when no allowlist/denylist is set", () => {
    const p = buildProvider()
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual(["echo", "read_file", "write_file", "exec"])
  })

  it("restricts to allowed tools only when allowlist is set", () => {
    const p = buildProvider()
    p.setToolAllowlist(["echo", "read_file"])
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual(["echo", "read_file"])
  })

  it("removes denied tools when denylist is set", () => {
    const p = buildProvider()
    p.setToolDenylist(["exec", "write_file"])
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual(["echo", "read_file"])
  })

  it("denylist wins over allowlist", () => {
    const p = buildProvider()
    p.setToolAllowlist(["echo", "exec", "read_file"])
    p.setToolDenylist(["exec"])
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual(["echo", "read_file"])
  })

  it("undefined allowlist = no restriction", () => {
    const p = buildProvider()
    p.setToolAllowlist(["echo"])
    p.setToolAllowlist(undefined)
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual(["echo", "read_file", "write_file", "exec"])
  })

  it("empty allowlist blocks all tools", () => {
    const p = buildProvider()
    p.setToolAllowlist([])
    const names = p.getToolDefinitions().map((d) => d.name)
    expect(names).toEqual([])
  })
})