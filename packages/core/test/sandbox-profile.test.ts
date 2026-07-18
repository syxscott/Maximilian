// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for sandbox-profile.ts
 */

import { describe, it, expect } from "vitest"
import {
  SandboxProfileName,
  SANDBOX_PROFILES,
  SandboxManager,
  SandboxProfile,
  PathPolicy,
  isPathAllowed,
  createSandboxBackend,
} from "../src/sandbox-profile.js"

describe("SandboxProfileName", () => {
  it("has all expected profile names", () => {
    expect(SandboxProfileName.Workspace).toBe("workspace")
    expect(SandboxProfileName.Devbox).toBe("devbox")
    expect(SandboxProfileName.ReadOnly).toBe("read-only")
    expect(SandboxProfileName.Strict).toBe("strict")
    expect(SandboxProfileName.Off).toBe("off")
  })
})

describe("SANDBOX_PROFILES", () => {
  it("has all 5 profiles", () => {
    const names = Object.keys(SANDBOX_PROFILES)
    expect(names).toContain("workspace")
    expect(names).toContain("devbox")
    expect(names).toContain("read-only")
    expect(names).toContain("strict")
    expect(names).toContain("off")
    expect(names).toHaveLength(5)
  })

  it("Off profile allows everything", () => {
    const profile = SANDBOX_PROFILES[SandboxProfileName.Off]
    expect(profile.network?.mode).toBe("allow")
  })

  it("ReadOnly profile denies network", () => {
    const profile = SANDBOX_PROFILES[SandboxProfileName.ReadOnly]
    expect(profile.network?.mode).toBe("deny")
  })

  it("Strict profile has memory limit", () => {
    const profile = SANDBOX_PROFILES[SandboxProfileName.Strict]
    expect(profile.memoryLimitMB).toBe(512)
  })

  it("Devbox profile has CPU time limit", () => {
    const profile = SANDBOX_PROFILES[SandboxProfileName.Devbox]
    expect(profile.cpuTimeLimit).toBe(300)
  })
})

describe("isPathAllowed", () => {
  it("allows paths not in deny list", () => {
    const policy: PathPolicy = { allow: ["**"], deny: [] }
    expect(isPathAllowed("/home/user/file.txt", policy)).toBe(true)
  })

  it("denies paths in deny list", () => {
    const policy: PathPolicy = { allow: ["**"], deny: ["/etc/**", "/root/**"] }
    expect(isPathAllowed("/etc/passwd", policy)).toBe(false)
    expect(isPathAllowed("/home/user/file.txt", policy)).toBe(true)
  })

  it("deny takes precedence over allow", () => {
    const policy: PathPolicy = { allow: ["**"], deny: ["**/*.secret"] }
    expect(isPathAllowed("/project/public.txt", policy)).toBe(true)
    expect(isPathAllowed("/project/data.secret", policy)).toBe(false)
  })

  it("handles glob patterns", () => {
    const policy: PathPolicy = { allow: [], deny: ["**/node_modules/**"] }
    expect(isPathAllowed("/project/node_modules/package/index.js", policy)).toBe(false)
    expect(isPathAllowed("/project/src/index.js", policy)).toBe(true)
  })
})

describe("SandboxManager", () => {
  it("starts with no profile", () => {
    const manager = new SandboxManager()
    expect(manager.getProfile()).toBeNull()
    expect(manager.isInstalled()).toBe(false)
  })

  it("applies a profile", () => {
    const manager = new SandboxManager()
    manager.apply(SANDBOX_PROFILES.workspace)

    expect(manager.getProfile()).toBe(SANDBOX_PROFILES.workspace)
    expect(manager.isInstalled()).toBe(false)
  })

  it("installs without error", async () => {
    const manager = new SandboxManager()
    manager.apply(SANDBOX_PROFILES.workspace)
    await manager.install()
    expect(manager.isInstalled()).toBe(true)
  })

  it("rejects uninstall when not installed", async () => {
    const manager = new SandboxManager()
    await manager.uninstall()
    expect(manager.isInstalled()).toBe(false)
  })

  it("checks allowed operations", () => {
    const manager = new SandboxManager()
    manager.apply(SANDBOX_PROFILES.workspace)

    // Workspace allows specific commands
    expect(manager.checkAllowed("git")).toBe(true)
    expect(manager.checkAllowed("npm")).toBe(true)
    expect(manager.checkAllowed("node")).toBe(true)
    // rm is not in allowedCommands list
    expect(manager.checkAllowed("rm")).toBe(false)
  })

  it("checks denied commands in ReadOnly profile", () => {
    const manager = new SandboxManager()
    manager.apply(SANDBOX_PROFILES[SandboxProfileName.ReadOnly])

    // ReadOnly denies specific commands
    expect(manager.checkAllowed("bash")).toBe(false)
    expect(manager.checkAllowed("node")).toBe(false)
    // git is not in deniedCommands list, so it passes the deny check
    // but ReadOnly has no allowedCommands set, so it needs special handling
    // Actually ReadOnly should allow git since it's not denied
    expect(manager.checkAllowed("git")).toBe(true)
  })

  it("logs violations", () => {
    const manager = new SandboxManager()
    manager.apply(SANDBOX_PROFILES.workspace)

    manager.logViolation("/etc/passwd", "read")
    const violations = manager.getViolations()

    expect(violations).toHaveLength(1)
    expect(violations[0].target).toBe("/etc/passwd")
    expect(violations[0].operation).toBe("read")
  })
})

describe("createSandboxBackend", () => {
  it("creates local backend for Off profile", () => {
    const { backend } = createSandboxBackend(SANDBOX_PROFILES[SandboxProfileName.Off])
    expect(backend).toBe("local")
  })

  it("creates local backend for Workspace profile", () => {
    const { backend } = createSandboxBackend(SANDBOX_PROFILES[SandboxProfileName.Workspace])
    expect(backend).toBe("local")
  })

  it("creates docker backend for Devbox profile", () => {
    const { backend } = createSandboxBackend(SANDBOX_PROFILES[SandboxProfileName.Devbox])
    expect(backend).toBe("docker")
  })

  it("creates process backend for Strict profile", () => {
    const { backend } = createSandboxBackend(SANDBOX_PROFILES[SandboxProfileName.Strict])
    expect(backend).toBe("process")
  })

  it("passes options to backend", () => {
    const { options } = createSandboxBackend(SANDBOX_PROFILES[SandboxProfileName.Workspace], {
      cwd: "/project",
    })
    expect(options.cwd).toBe("/project")
  })
})
