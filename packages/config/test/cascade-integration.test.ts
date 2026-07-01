/**
 * Regression test for the P1-A integration: `getConfig()` must honor any
 * session / project / user override layers registered before the first call.
 * Overrides win over env-derived values; missing layers are skipped.
 */
import { describe, it, expect, beforeEach } from "vitest"
import path from "node:path"
import {
  getConfig,
  resetConfig,
  registerSessionOverride,
  registerProjectOverride,
  registerUserOverride,
} from "../src/index.js"

// Provide the bare-minimum env vars so ConfigSchema.safeParse passes in
// any test environment. Each test resets the config and overrides before
// exercising the cascade.
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3001",
  WORKSPACE_DIR: "./workspaces",
  JWT_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  ADMIN_TOKEN: "secret",
  ROLLOUT_MODE: "shadow",
  TELEMETRY_ENABLED: "false",
  TASK_QUEUE_ENABLED: "false",
  MULTI_TENANT_ENABLED: "false",
  FEATURE_FLAGS: "{}",
}

beforeEach(() => {
  resetConfig()
  for (const [k, v] of Object.entries(BASE_ENV)) {
    process.env[k] = v
  }
})

describe("getConfig() cascade", () => {
  it("returns env-derived config when no overrides are registered", () => {
    const cfg = getConfig()
    expect(cfg.PORT).toBe(3001)
    // WORKSPACE_DIR is normalized to an absolute path at parse time so
    // every consumer (file stores, blueprint store, etc.) sees the same
    // resolved location — critical on Windows where CWD-relative paths
    // can land in different drives after a chdir.
    expect(cfg.WORKSPACE_DIR).toMatch(/workspaces$/)
    expect(path.isAbsolute(cfg.WORKSPACE_DIR)).toBe(true)
  })

  it("session override wins over env", () => {
    registerSessionOverride({ PORT: 4000 })
    const cfg = getConfig()
    expect(cfg.PORT).toBe(4000)
  })

  it("project override wins over env, session wins over project", () => {
    registerProjectOverride({ PORT: 4000 })
    registerSessionOverride({ PORT: 5000 })
    expect(getConfig().PORT).toBe(5000)
  })

  it("user override wins over env but loses to project and session", () => {
    registerUserOverride({ PORT: 4000 })
    registerProjectOverride({ PORT: 5000 })
    expect(getConfig().PORT).toBe(5000)
  })

  it("non-overridden keys keep their env values", () => {
    registerSessionOverride({ PORT: 4000 })
    const cfg = getConfig()
    expect(cfg.WORKSPACE_DIR).toMatch(/workspaces$/)
    expect(path.isAbsolute(cfg.WORKSPACE_DIR)).toBe(true)
    expect(cfg.NODE_ENV).toBe("test")
  })

  it("caches the merged config — later override calls have no effect", () => {
    registerSessionOverride({ PORT: 4000 })
    const first = getConfig()
    // Try to override AFTER caching — should have no effect.
    registerSessionOverride({ PORT: 9999 })
    const second = getConfig()
    expect(second).toBe(first)
    expect(second.PORT).toBe(4000)
  })

  it("resetConfig clears the override layers", () => {
    registerSessionOverride({ PORT: 4000 })
    getConfig()
    resetConfig()
    // After reset, env wins again.
    expect(getConfig().PORT).toBe(3001)
  })
})