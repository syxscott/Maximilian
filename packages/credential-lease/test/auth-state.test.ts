import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { AuthStateStore, parseAuthState, type AuthState } from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function baseState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    schemaVersion: 1,
    status: "anonymous",
    generation: 0,
    updatedAtMs: 0,
    ...overrides,
  }
}

function expectInvalid(value: unknown): void {
  expect(() => parseAuthState(value)).toThrow(TypeError)
  expect(() => parseAuthState(value)).toThrow("Invalid credential lease state.")
}

describe("parseAuthState", () => {
  it("accepts the minimal anonymous state", () => {
    expect(
      parseAuthState({ schemaVersion: 1, status: "anonymous", generation: 0, updatedAtMs: 0 }),
    ).toEqual({ schemaVersion: 1, status: "anonymous", generation: 0, updatedAtMs: 0 })
  })

  it("accepts every legal lifecycle status", () => {
    for (const status of [
      "anonymous",
      "authorizing",
      "authenticated",
      "refreshing",
      "scope_upgrade_required",
      "logging_out",
      "expired",
      "error",
    ] as const) {
      expect(parseAuthState(baseState({ status })).status).toBe(status)
    }
  })

  it("accepts an authenticated state carrying expiry metadata", () => {
    expect(
      parseAuthState(
        baseState({ status: "authenticated", generation: 4, expiresAtMs: 1234, updatedAtMs: 9 }),
      ),
    ).toEqual({
      schemaVersion: 1,
      status: "authenticated",
      generation: 4,
      expiresAtMs: 1234,
      updatedAtMs: 9,
    })
  })

  it("rejects non-object payloads", () => {
    expectInvalid(null)
    expectInvalid(undefined)
    expectInvalid("anonymous")
    expectInvalid(42)
    expectInvalid([])
  })

  it("rejects unknown statuses and wrong schema versions", () => {
    expectInvalid(baseState({ status: "detached" as AuthState["status"] }))
    expectInvalid(baseState({ status: 1 as unknown as AuthState["status"] }))
    expectInvalid(baseState({ schemaVersion: 2 }))
  })

  it("rejects missing or extra keys", () => {
    expectInvalid({ schemaVersion: 1, status: "anonymous", generation: 0 })
    expectInvalid({ ...baseState(), extra: true })
  })

  it("rejects invalid generation counters", () => {
    expectInvalid(baseState({ generation: -1 }))
    expectInvalid(baseState({ generation: 1.5 }))
    expectInvalid(baseState({ generation: Number.NaN }))
    expectInvalid(baseState({ generation: "0" as unknown as number }))
  })

  it("rejects non-finite timestamps", () => {
    expectInvalid(baseState({ updatedAtMs: Number.NaN }))
    expectInvalid(baseState({ updatedAtMs: Number.POSITIVE_INFINITY }))
    expectInvalid(baseState({ updatedAtMs: "0" as unknown as number }))
    expectInvalid(baseState({ expiresAtMs: Number.NaN }))
    expectInvalid(baseState({ expiresAtMs: "soon" as unknown as number }))
  })

  it("rejects credential-shaped fields with a TypeError", () => {
    // The exact-allowed-keys check rejects these before the dedicated
    // sensitive-field message can fire; the invariant under test is that such
    // state can never be parsed or persisted.
    expect(() => parseAuthState({ ...baseState(), accessToken: "secret" })).toThrow(TypeError)
    expect(() => parseAuthState({ ...baseState(), "refresh-token": "secret" })).toThrow(TypeError)
    expect(() => parseAuthState({ ...baseState(), deviceCode: "secret" })).toThrow(TypeError)
  })
})

describe("AuthStateStore", () => {
  it("reads null when the state file does not exist yet", async () => {
    const dir = await makeTempDir("credential-lease-state-")
    const store = new AuthStateStore(path.join(dir, "auth-state.json"))
    expect(await store.read()).toBeNull()
  })

  it("round-trips state through an atomic private write", async () => {
    const dir = await makeTempDir("credential-lease-state-")
    const statePath = path.join(dir, "auth-state.json")
    const store = new AuthStateStore(statePath)
    const state = baseState({
      status: "authenticated",
      generation: 2,
      expiresAtMs: 99,
      updatedAtMs: 5,
    })
    await store.write(state)
    expect(await store.read()).toEqual(state)
    expect((await stat(statePath)).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  it("persists a state file that never contains secrets", async () => {
    const dir = await makeTempDir("credential-lease-state-")
    const statePath = path.join(dir, "auth-state.json")
    const store = new AuthStateStore(statePath)
    await store.write(baseState({ status: "authenticated", generation: 1, updatedAtMs: 5 }))
    const raw = await readFile(statePath, "utf8")
    expect(raw).not.toMatch(/token/iu)
  })

  it("rejects writes of invalid or secret-bearing state", async () => {
    const dir = await makeTempDir("credential-lease-state-")
    const statePath = path.join(dir, "auth-state.json")
    const store = new AuthStateStore(statePath)
    await expect(store.write({ ...baseState(), generation: -3 })).rejects.toBeInstanceOf(TypeError)
    await expect(store.write({ ...baseState(), refreshToken: "x" })).rejects.toBeInstanceOf(
      TypeError,
    )
    await expect(stat(statePath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("throws a TypeError for corrupted state files instead of crashing reads", async () => {
    const dir = await makeTempDir("credential-lease-state-")
    const statePath = path.join(dir, "auth-state.json")
    const store = new AuthStateStore(statePath)
    const { writeFile } = await import("node:fs/promises")
    await writeFile(statePath, "{not json", "utf8")
    await expect(store.read()).rejects.toBeInstanceOf(TypeError)
    await writeFile(statePath, '{"totally":"different"}', "utf8")
    await expect(store.read()).rejects.toThrow("Invalid credential lease state.")
  })
})
