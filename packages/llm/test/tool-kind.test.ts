// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for tool-kind.ts
 * Validates ToolKind enum, CapabilityMode lattice, and exhaustiveness helpers.
 */

import { describe, it, expect } from "vitest"
import {
  ToolKind,
  ALL_TOOL_KINDS,
  isValidToolKind,
  isCapabilitySubset,
  getRequiredCapability,
  kindAllowsCapability,
  getPresentationName,
  isReadOnlyKind,
  writesFiles,
  executesCommands,
  accessesNetwork,
  exhaustiveCheck,
} from "../src/tool-kind.js"

describe("ToolKind enum", () => {
  it("should have all expected kind values", () => {
    expect(ToolKind.Read).toBe("read")
    expect(ToolKind.Edit).toBe("edit")
    expect(ToolKind.Search).toBe("search")
    expect(ToolKind.Execute).toBe("execute")
    expect(ToolKind.Network).toBe("network")
    expect(ToolKind.Process).toBe("process")
    expect(ToolKind.Orchestration).toBe("orchestration")
    expect(ToolKind.Misc).toBe("misc")
  })

  it("ALL_TOOL_KINDS should contain exactly 8 kinds", () => {
    expect(ALL_TOOL_KINDS).toHaveLength(8)
  })

  it("isValidToolKind should validate known kinds", () => {
    for (const kind of ALL_TOOL_KINDS) {
      expect(isValidToolKind(kind)).toBe(true)
    }
  })

  it("isValidToolKind should reject unknown kinds", () => {
    expect(isValidToolKind("unknown")).toBe(false)
    expect(isValidToolKind("")).toBe(false)
    expect(isValidToolKind("READ")).toBe(false) // case-sensitive
  })
})

describe("CapabilityMode lattice", () => {
  it("read-only ⊆ read-only", () => {
    expect(isCapabilitySubset("read-only", "read-only")).toBe(true)
  })

  it("read-only ⊆ read-write", () => {
    expect(isCapabilitySubset("read-only", "read-write")).toBe(true)
  })

  it("read-only ⊆ execute", () => {
    expect(isCapabilitySubset("read-only", "execute")).toBe(true)
  })

  it("read-only ⊆ all", () => {
    expect(isCapabilitySubset("read-only", "all")).toBe(true)
  })

  it("read-write ⊆ read-write", () => {
    expect(isCapabilitySubset("read-write", "read-write")).toBe(true)
  })

  it("read-write ⊆ execute", () => {
    expect(isCapabilitySubset("read-write", "execute")).toBe(true)
  })

  it("read-write ⊆ all", () => {
    expect(isCapabilitySubset("read-write", "all")).toBe(true)
  })

  it("execute ⊆ execute", () => {
    expect(isCapabilitySubset("execute", "execute")).toBe(true)
  })

  it("execute ⊆ all", () => {
    expect(isCapabilitySubset("execute", "all")).toBe(true)
  })

  it("all ⊆ all", () => {
    expect(isCapabilitySubset("all", "all")).toBe(true)
  })

  it("read-write ⊈ read-only (anti-symmetric)", () => {
    expect(isCapabilitySubset("read-write", "read-only")).toBe(false)
  })

  it("execute ⊈ read-write (anti-symmetric)", () => {
    expect(isCapabilitySubset("execute", "read-write")).toBe(false)
  })

  it("all ⊈ read-only (anti-symmetric)", () => {
    expect(isCapabilitySubset("all", "read-only")).toBe(false)
  })
})

describe("getRequiredCapability", () => {
  it("Read → read-only", () => {
    expect(getRequiredCapability(ToolKind.Read)).toBe("read-only")
  })

  it("Edit → read-write", () => {
    expect(getRequiredCapability(ToolKind.Edit)).toBe("read-write")
  })

  it("Search → read-only", () => {
    expect(getRequiredCapability(ToolKind.Search)).toBe("read-only")
  })

  it("Execute → execute", () => {
    expect(getRequiredCapability(ToolKind.Execute)).toBe("execute")
  })

  it("Network → read-only", () => {
    expect(getRequiredCapability(ToolKind.Network)).toBe("read-only")
  })

  it("Process → execute", () => {
    expect(getRequiredCapability(ToolKind.Process)).toBe("execute")
  })

  it("Orchestration → read-write", () => {
    expect(getRequiredCapability(ToolKind.Orchestration)).toBe("read-write")
  })

  it("Misc → read-only", () => {
    expect(getRequiredCapability(ToolKind.Misc)).toBe("read-only")
  })
})

describe("kindAllowsCapability", () => {
  it("Read allows read-only", () => {
    expect(kindAllowsCapability(ToolKind.Read, "read-only")).toBe(true)
  })

  it("Read does NOT allow read-write", () => {
    expect(kindAllowsCapability(ToolKind.Read, "read-write")).toBe(false)
  })

  it("Edit allows read-only", () => {
    expect(kindAllowsCapability(ToolKind.Edit, "read-only")).toBe(true)
  })

  it("Edit allows read-write", () => {
    expect(kindAllowsCapability(ToolKind.Edit, "read-write")).toBe(true)
  })

  it("Edit does NOT allow execute", () => {
    expect(kindAllowsCapability(ToolKind.Edit, "execute")).toBe(false)
  })

  it("Execute allows execute", () => {
    expect(kindAllowsCapability(ToolKind.Execute, "execute")).toBe(true)
  })

  it("Execute does NOT allow all", () => {
    // Execute has defaultCapability=execute, and execute ⊈ all (execute < all in the lattice)
    expect(kindAllowsCapability(ToolKind.Execute, "all")).toBe(false)
  })

  it("Network does NOT allow execute", () => {
    expect(kindAllowsCapability(ToolKind.Network, "execute")).toBe(false)
  })
})

describe("convenience functions", () => {
  describe("getPresentationName", () => {
    it("returns emoji prefix for each kind", () => {
      expect(getPresentationName(ToolKind.Read)).toContain("📖")
      expect(getPresentationName(ToolKind.Edit)).toContain("✏️")
      expect(getPresentationName(ToolKind.Search)).toContain("🔍")
      expect(getPresentationName(ToolKind.Execute)).toContain("⚡")
      expect(getPresentationName(ToolKind.Network)).toContain("🌐")
      expect(getPresentationName(ToolKind.Process)).toContain("🔧")
      expect(getPresentationName(ToolKind.Orchestration)).toContain("🎭")
      expect(getPresentationName(ToolKind.Misc)).toContain("📦")
    })
  })

  describe("isReadOnlyKind", () => {
    it("Read is read-only", () => {
      expect(isReadOnlyKind(ToolKind.Read)).toBe(true)
    })

    it("Edit is NOT read-only", () => {
      expect(isReadOnlyKind(ToolKind.Edit)).toBe(false)
    })

    it("Search is read-only", () => {
      expect(isReadOnlyKind(ToolKind.Search)).toBe(true)
    })

    it("Execute is NOT read-only", () => {
      expect(isReadOnlyKind(ToolKind.Execute)).toBe(false)
    })
  })

  describe("writesFiles", () => {
    it("Edit writes files", () => {
      expect(writesFiles(ToolKind.Edit)).toBe(true)
    })

    it("Read does NOT write files", () => {
      expect(writesFiles(ToolKind.Read)).toBe(false)
    })

    it("Execute does NOT write files", () => {
      expect(writesFiles(ToolKind.Execute)).toBe(false)
    })
  })

  describe("executesCommands", () => {
    it("Execute executes commands", () => {
      expect(executesCommands(ToolKind.Execute)).toBe(true)
    })

    it("Process executes commands", () => {
      expect(executesCommands(ToolKind.Process)).toBe(true)
    })

    it("Read does NOT execute commands", () => {
      expect(executesCommands(ToolKind.Read)).toBe(false)
    })
  })

  describe("accessesNetwork", () => {
    it("Network accesses network", () => {
      expect(accessesNetwork(ToolKind.Network)).toBe(true)
    })

    it("Read does NOT access network", () => {
      expect(accessesNetwork(ToolKind.Read)).toBe(false)
    })

    it("Execute does NOT access network", () => {
      expect(accessesNetwork(ToolKind.Execute)).toBe(false)
    })
  })
})

describe("exhaustiveCheck", () => {
  it("throws when called with a value (used in switch default)", () => {
    // This test verifies the function exists and throws appropriately
    // In real TypeScript, the exhaustiveness check works at compile time
    expect(() => exhaustiveCheck("anything" as never)).toThrow()
  })
})
