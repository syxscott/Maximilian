/**
 * LIVE smoke test for @max/core-thin-sdk.
 *
 * Spawns a real `opencode serve` subprocess (via bun run) and exercises the
 * core data path: Supervisor spawn + ready detection + SDK + SessionPool.
 *
 * Run with: `npx vitest run test/live-smoke.test.ts` from packages/core-thin-sdk.
 * Skipped automatically if `bun` is not on PATH.
 *
 * This is the WS7 PoC verification — must pass before Phase 2 begins.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpencodeHttpClient } from "../src/client.js"
import * as OpencodeSdk from "../src/sdk.js"
import { SessionPool } from "../src/session-pool.js"
import { Supervisor } from "../src/supervisor.js"

const HAS_BUN = (() => {
  try {
    execSync("which bun", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

const OPENCODE_PKG = "/home/user/shenyaxuan/Maximilian/opencode/packages/opencode"
const PORT = 14096 + Math.floor(Math.random() * 1000)
const TMPDIR = mkdtempSync(join(tmpdir(), "max-live-"))

describe.skipIf(!HAS_BUN)("live smoke: real opencode serve via bun", () => {
  let supervisor: Supervisor
  let baseUrl: string
  let client: OpencodeHttpClient
  let pool: SessionPool

  beforeAll(async () => {
    writeFileSync(
      join(TMPDIR, "opencode.json"),
      JSON.stringify({ theme: "system", provider: {} }),
    )

    supervisor = new Supervisor({
      command: ["bun"],
      args: ["run", "src/index.ts", "serve", "--port", String(PORT), "--hostname", "127.0.0.1"],
      cwd: OPENCODE_PKG,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.npm-global/bin:${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: TMPDIR,
        OPENCODE_CONFIG_DIR: TMPDIR,
      },
      port: PORT,
      healthCheckMs: 500,
      restartOnCrash: false,
      maxRestarts: 0,
    })

    await supervisor.start()
    baseUrl = await supervisor.baseUrl
    expect(supervisor.running).toBe(true)

    client = new OpencodeHttpClient({ baseUrl })
    pool = new SessionPool(client)
  }, 60_000)

  afterAll(async () => {
    if (supervisor) await supervisor.stop(3000)
    if (pool) await pool.shutdown()
    try {
      rmSync(TMPDIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }, 30_000)

  it("health endpoint returns healthy=true", async () => {
    const res = await OpencodeSdk.health(client)
    expect(res.healthy).toBe(true)
  })

  it("creates a session via SDK and pools the result", async () => {
    const entry = await pool.getOrCreate("ws-live")
    expect(entry.session.id).toMatch(/^ses/)
    expect(pool.size()).toBe(1)

    // Cache hit
    const entry2 = await pool.getOrCreate("ws-live")
    expect(entry2.session.id).toBe(entry.session.id)
    expect(pool.size()).toBe(1)
  })

  it("lists sessions", async () => {
    await pool.getOrCreate("ws-list")
    const sessions = await OpencodeSdk.listSessions(client)
    expect(sessions.length).toBeGreaterThan(0)
  })
})