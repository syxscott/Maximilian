// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Profile + ProfileRegistry tests (借鉴 Open Interpreter Profile).
 */
import { describe, it, expect } from "vitest"
import { ProfileRegistry, BUILT_IN_PROFILES, type RoleRegistry, type ToolRegistry } from "../src/profile.js"

/** Minimal mock implementations of the registry interfaces. */
const mockRoleRegistry: RoleRegistry = {
  get: () => undefined,
  list: () => [],
}

const mockToolRegistry: ToolRegistry = {
  listTools: () => [],
}

describe("ProfileRegistry", () => {
  it("seeds with BUILT_IN_PROFILES", () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    const profile = registry.get("default")
    expect(profile?.id).toBe("default")
    expect(profile?.name).toBe("Default")
  })

  it("register() adds a profile", () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    registry.register({
      id: "custom",
      name: "Custom",
      systemPrompt: "You are custom.",
    })
    expect(registry.get("custom")?.name).toBe("Custom")
  })

  it("register() throws if id is missing", () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    expect(() => registry.register({ id: "", name: "Bad", systemPrompt: "" })).toThrow(
      "Profile id is required",
    )
  })

  it("list() returns all profiles", () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    const profiles = registry.list()
    expect(profiles.length).toBeGreaterThanOrEqual(BUILT_IN_PROFILES.length)
    expect(profiles.find((p) => p.id === "default")).toBeDefined()
    expect(profiles.find((p) => p.id === "security")).toBeDefined()
  })

  it("loadFromDir() skips non-existent directory", async () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    await registry.loadFromDir("/nonexistent/path/xyz")
    // Should not throw.
    expect(registry.list().length).toBeGreaterThanOrEqual(0)
  })

  it("get() returns undefined for unknown id", () => {
    const registry = new ProfileRegistry(mockRoleRegistry, mockToolRegistry)
    expect(registry.get("nonexistent")).toBeUndefined()
  })
})

describe("BUILT_IN_PROFILES", () => {
  it("default profile has sandboxBackend=local", () => {
    const defaultProfile = BUILT_IN_PROFILES.find((p) => p.id === "default")
    expect(defaultProfile?.sandboxBackend).toBe("local")
  })

  it("security profile has sandboxBackend=docker and limited tools", () => {
    const securityProfile = BUILT_IN_PROFILES.find((p) => p.id === "security")
    expect(securityProfile?.sandboxBackend).toBe("docker")
    expect(securityProfile?.enabledTools).toEqual(["read", "bash"])
  })
})
