/**
 * Toolkit + DefaultToolRegistry tests (借鉴 SuperAGI Toolkit).
 */
import { describe, it, expect } from "vitest"
import { DefaultToolRegistry, type Tool, type Toolkit } from "../src/toolkit.js"

function makeTool(name: string, risk: Tool["risk"] = "safe"): Tool {
  return {
    name,
    description: `A ${name} tool`,
    schema: {},
    risk,
    async execute(args) {
      return { result: name, args }
    },
  }
}

describe("DefaultToolRegistry", () => {
  it("register() adds a tool", () => {
    const registry = new DefaultToolRegistry()
    registry.register(makeTool("read"))
    expect(registry.get("read")).toBeDefined()
    expect(registry.listTools()).toHaveLength(1)
  })

  it("register() throws if tool has no name", () => {
    const registry = new DefaultToolRegistry()
    expect(() => registry.register({ ...makeTool("x"), name: "" })).toThrow("Tool name is required")
  })

  it("registerToolkit() flattens tools into global registry", () => {
    const registry = new DefaultToolRegistry()
    const toolkit: Toolkit = {
      id: "code-review",
      name: "Code Review",
      description: "Code analysis tools",
      tools: [makeTool("grep"), makeTool("glob")],
      allowedRoles: ["reviewer"],
    }
    registry.registerToolkit(toolkit)
    expect(registry.get("grep")).toBeDefined()
    expect(registry.get("glob")).toBeDefined()
    expect(registry.getToolkit("code-review")).toBeDefined()
    expect(registry.listToolkits()).toHaveLength(1)
  })

  it("getToolkit() returns toolkit metadata", () => {
    const registry = new DefaultToolRegistry()
    registry.registerToolkit({
      id: "fs",
      name: "File System",
      description: "FS tools",
      tools: [makeTool("read")],
    })
    const tk = registry.getToolkit("fs")
    expect(tk?.id).toBe("fs")
    expect(tk?.name).toBe("File System")
  })

  it("getToolsForRole() filters by toolkit allowedRoles", () => {
    const registry = new DefaultToolRegistry()
    registry.registerToolkit({
      id: "fs",
      name: "File System",
      description: "FS",
      tools: [makeTool("read"), makeTool("write")],
      allowedRoles: ["backend"],
    })
    const backendTools = registry.getToolsForRole("backend", {})
    expect(backendTools.find((t) => t.name === "read")).toBeDefined()
    expect(backendTools.find((t) => t.name === "write")).toBeDefined()

    const frontendTools = registry.getToolsForRole("frontend", {})
    expect(frontendTools.find((t) => t.name === "read")).toBeUndefined()
  })

  it("getToolsForRole() respects role-level denylist", () => {
    const registry = new DefaultToolRegistry()
    registry.register(makeTool("bash"))
    const tools = registry.getToolsForRole("backend", { deniedTools: ["bash"] })
    expect(tools.find((t) => t.name === "bash")).toBeUndefined()
  })

  it("getToolsForRole() blocks high/critical tools without explicit allow", () => {
    const registry = new DefaultToolRegistry()
    registry.register(makeTool("delete-everything", "critical"))
    const tools = registry.getToolsForRole("backend", { allowedTools: ["delete-everything"] })
    expect(tools.find((t) => t.name === "delete-everything")).toBeDefined()
  })

  it("listTools() returns all registered tools", () => {
    const registry = new DefaultToolRegistry()
    registry.register(makeTool("a"))
    registry.register(makeTool("b"))
    expect(registry.listTools()).toHaveLength(2)
  })

  it("listToolkits() returns all registered toolkits", () => {
    const registry = new DefaultToolRegistry()
    registry.registerToolkit({ id: "tk1", name: "TK1", description: "", tools: [] })
    registry.registerToolkit({ id: "tk2", name: "TK2", description: "", tools: [] })
    expect(registry.listToolkits()).toHaveLength(2)
  })

  it("discover() skips non-existent directories gracefully", async () => {
    const registry = new DefaultToolRegistry()
    await registry.discover("/nonexistent/path/xyz")
    // Should not throw.
    expect(registry.listToolkits()).toHaveLength(0)
  })
})
