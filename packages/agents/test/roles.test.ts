// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RoleRegistry tests (借鉴 ChatDev RoleConfig.json).
 */
import { describe, it, expect } from "vitest"
import { DefaultRoleRegistry, BUILT_IN_ROLES } from "../src/roles.js"

describe("DefaultRoleRegistry", () => {
  it("seeds with BUILT_IN_ROLES", () => {
    const registry = new DefaultRoleRegistry()
    expect(registry.get("architect")).toBeDefined()
    expect(registry.get("backend")).toBeDefined()
    expect(registry.get("frontend")).toBeDefined()
    expect(registry.get("reviewer")).toBeDefined()
    expect(registry.get("data")).toBeDefined()
  })

  it("register() adds a new role", () => {
    const registry = new DefaultRoleRegistry()
    registry.register({
      id: "test-role",
      name: "Test Role",
      systemPrompt: "You are a test.",
      capabilities: ["testing"],
      allowedTools: ["read", "bash"],
    })
    expect(registry.get("test-role")?.name).toBe("Test Role")
  })

  it("register() throws if id is missing", () => {
    const registry = new DefaultRoleRegistry()
    expect(() =>
      registry.register({ id: "", name: "Bad", systemPrompt: "", capabilities: [] }),
    ).toThrow("Role id is required")
  })

  it("unregister() removes a user-registered role", () => {
    const registry = new DefaultRoleRegistry()
    registry.register({ id: "temp", name: "Temp", systemPrompt: "", capabilities: [] })
    registry.unregister("temp")
    expect(registry.get("temp")).toBeUndefined()
  })

  it("unregister() throws for built-in roles", () => {
    const registry = new DefaultRoleRegistry()
    expect(() => registry.unregister("backend")).toThrow("Cannot unregister built-in role")
  })

  it("list() returns all roles", () => {
    const registry = new DefaultRoleRegistry()
    const ids = registry.listIds()
    expect(ids).toContain("architect")
    expect(ids).toContain("backend")
  })

  it("getAllowedTools() respects allowedTools", () => {
    const registry = new DefaultRoleRegistry()
    const tools = registry.getAllowedTools("architect")
    expect(tools).toEqual(["read", "glob", "grep"])
  })

  it("getAllowedTools() returns allowed tools for reviewer", () => {
    const registry = new DefaultRoleRegistry()
    // reviewer has allowedTools: read, bash, grep, glob
    expect(registry.getAllowedTools("reviewer")).toEqual(["read", "bash", "grep", "glob"])
  })

  it("getAllowedTools() returns empty array for unknown role", () => {
    const registry = new DefaultRoleRegistry()
    expect(registry.getAllowedTools("nonexistent")).toEqual([])
  })

  it("override replaces a built-in role", () => {
    const registry = new DefaultRoleRegistry()
    registry.register({
      ...BUILT_IN_ROLES.backend,
      systemPrompt: "Custom backend prompt",
    })
    expect(registry.get("backend")?.systemPrompt).toBe("Custom backend prompt")
  })
})
