import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  AuthRequiredError,
  AuthStateStore,
  CredentialAuthMachine,
  type AccessTokenLease,
  type AuthStatusSnapshot,
  type LoginGrant,
} from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

interface Harness {
  stateDir: string
  machine: CredentialAuthMachine
  snapshots: AuthStatusSnapshot[]
  clock: { nowMs: number }
}

async function makeHarness(
  options: { refresh?: () => Promise<LoginGrant>; stateDir?: string } = {},
): Promise<Harness> {
  const stateDir = options.stateDir ?? (await makeTempDir("credential-lease-machine-"))
  const clock = { nowMs: 1_000_000 }
  const snapshots: AuthStatusSnapshot[] = []
  const machine = new CredentialAuthMachine({
    stateDir,
    now: () => clock.nowMs,
    refresh: options.refresh,
  })
  const unsubscribe = machine.subscribe((snapshot) => snapshots.push(snapshot))
  void unsubscribe
  return { stateDir, machine, snapshots, clock }
}

function grantFor(harness: Harness, token: string, timeToLiveMs: number): LoginGrant {
  return { accessToken: token, expiresAtMs: harness.clock.nowMs + timeToLiveMs }
}

function loginOnce(
  harness: Harness,
  token = "tok-1",
  timeToLiveMs = 60_000,
): Promise<{ status: "authenticated"; generation: number }> {
  return harness.machine.login(async () => grantFor(harness, token, timeToLiveMs))
}

async function seedState(harness: Harness, state: Record<string, unknown>): Promise<void> {
  const store = new AuthStateStore(path.join(harness.stateDir, "auth-state.json"))
  await store.write(state as never)
}

describe("CredentialAuthMachine lifecycle", () => {
  it("starts anonymous at generation 0", async () => {
    const harness = await makeHarness()
    expect(await harness.machine.getStatus()).toEqual({
      status: "anonymous",
      generation: 0,
    })
  })

  it("adopts a persisted anonymous state with its generation", async () => {
    const harness = await makeHarness()
    await seedState(harness, {
      schemaVersion: 1,
      status: "anonymous",
      generation: 5,
      updatedAtMs: 1,
    })
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 5 })
  })

  it("runs anonymous -> authorizing -> authenticated and bumps generation to 1", async () => {
    const harness = await makeHarness()
    const result = await loginOnce(harness)
    expect(result).toEqual({ status: "authenticated", generation: 1 })
    expect(await harness.machine.getStatus()).toEqual({
      status: "authenticated",
      generation: 1,
      expiresAtMs: harness.clock.nowMs + 60_000,
    })
    expect(harness.snapshots).toEqual([
      { status: "authorizing", generation: 0 },
      {
        status: "authenticated",
        generation: 1,
        expiresAtMs: harness.clock.nowMs + 60_000,
      },
    ])
  })

  it("persists the state file without secrets and with mode 0600", async () => {
    const harness = await makeHarness()
    await loginOnce(harness, "secret-token-value")
    const statePath = path.join(harness.stateDir, "auth-state.json")
    expect((await stat(statePath)).mode & 0o777).toBe(0o600)
    const raw = await readFile(statePath, "utf8")
    expect(raw).not.toContain("secret-token-value")
    expect(JSON.parse(raw)).toMatchObject({ status: "authenticated", generation: 1 })
  })

  it("shares one in-flight login between concurrent callers (single-flight)", async () => {
    const harness = await makeHarness()
    let performCalls = 0
    const login = harness.machine.login(async () => {
      performCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return grantFor(harness, "tok-1", 60_000)
    })
    const [first, second] = await Promise.all([
      login,
      harness.machine.login(async () => {
        performCalls += 1
        return grantFor(harness, "tok-other", 60_000)
      }),
    ])
    expect(performCalls).toBe(1)
    expect(first).toEqual({ status: "authenticated", generation: 1 })
    expect(second).toEqual({ status: "authenticated", generation: 1 })
  })

  it("does not invoke perform again while a usable lease exists", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    let performCalls = 0
    const result = await harness.machine.login(async () => {
      performCalls += 1
      return grantFor(harness, "tok-2", 60_000)
    })
    expect(performCalls).toBe(0)
    expect(result).toEqual({ status: "authenticated", generation: 1 })
  })

  it("moves to error with the generation unchanged when login fails, then recovers", async () => {
    const harness = await makeHarness()
    await expect(
      harness.machine.login(async () => {
        throw new Error("provider down")
      }),
    ).rejects.toThrow("provider down")
    expect(await harness.machine.getStatus()).toEqual({ status: "error", generation: 0 })
    expect(await loginOnce(harness, "tok-1")).toEqual({ status: "authenticated", generation: 1 })
  })

  it("logs out: anonymous at generation + 1 with the token dropped", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    expect(await harness.machine.logout()).toEqual({ status: "anonymous", generation: 2 })
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 2 })
    await expect(harness.machine.getAccessToken(0)).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it("does not bump the generation when logging out of an anonymous session", async () => {
    const harness = await makeHarness()
    expect(await harness.machine.logout()).toEqual({ status: "anonymous", generation: 0 })
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 0 })
    expect(harness.snapshots).toEqual([])
  })
})

describe("CredentialAuthMachine getAccessToken", () => {
  it("returns the lease while it keeps at least minValidityMs of validity", async () => {
    const harness = await makeHarness()
    await loginOnce(harness, "tok-1", 10_000)
    const lease = await harness.machine.getAccessToken(10_000)
    expect(lease).toMatchObject({
      accessToken: "tok-1",
      generation: 1,
      scopes: ["provider.default"],
      audience: "maximilian-provider",
    })
    await expect(harness.machine.getAccessToken(10_001)).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it("rejects invalid minValidityMs arguments", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    for (const invalid of [-1, 1.5, 5 * 60 * 1000 + 1]) {
      await expect(harness.machine.getAccessToken(invalid)).rejects.toBeInstanceOf(TypeError)
    }
    await expect(harness.machine.getAccessToken(0)).resolves.toBeDefined()
  })

  it("throws AuthRequiredError on an expired token without a refresh hook", async () => {
    const harness = await makeHarness()
    await loginOnce(harness, "tok-1", 1000)
    harness.clock.nowMs += 2000
    await expect(harness.machine.getAccessToken(0)).rejects.toBeInstanceOf(AuthRequiredError)
    expect(await harness.machine.getStatus()).toEqual({
      status: "expired",
      generation: 1,
      expiresAtMs: harness.clock.nowMs - 2000 + 1000,
    })
  })

  it("refreshes through the hook when validity falls short: refreshing -> authenticated, generation + 1", async () => {
    let refreshCalls = 0
    const harness = await makeHarness({
      refresh: async () => {
        refreshCalls += 1
        return { accessToken: `tok-r${refreshCalls}`, expiresAtMs: harness.clock.nowMs + 60_000 }
      },
    })
    await loginOnce(harness, "tok-1", 60_000)
    harness.clock.nowMs += 50_000
    const lease = await harness.machine.getAccessToken(30_000)
    expect(refreshCalls).toBe(1)
    expect(lease).toMatchObject({ accessToken: "tok-r1", generation: 2 })
    expect(await harness.machine.getStatus()).toEqual({
      status: "authenticated",
      generation: 2,
      expiresAtMs: harness.clock.nowMs + 60_000,
    })
    expect(harness.snapshots.map((snapshot) => snapshot.status)).toEqual([
      "authorizing",
      "authenticated",
      "refreshing",
      "authenticated",
    ])
  })

  it("deduplicates concurrent refreshes into one hook call", async () => {
    let refreshCalls = 0
    const harness = await makeHarness({
      refresh: async () => {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { accessToken: `tok-r${refreshCalls}`, expiresAtMs: harness.clock.nowMs + 60_000 }
      },
    })
    await loginOnce(harness, "tok-1", 1000)
    harness.clock.nowMs += 2000
    const [first, second] = await Promise.all([
      harness.machine.getAccessToken(0),
      harness.machine.getAccessToken(0),
    ])
    expect(refreshCalls).toBe(1)
    expect((first as AccessTokenLease).accessToken).toBe("tok-r1")
    expect((second as AccessTokenLease).accessToken).toBe("tok-r1")
  })

  it("moves to expired with the generation unchanged when the refresh fails", async () => {
    const harness = await makeHarness({
      refresh: async () => {
        throw new Error("refresh rejected")
      },
    })
    await loginOnce(harness)
    harness.clock.nowMs += 61_000
    const failure = await harness.machine.getAccessToken(0).catch((error) => error)
    expect(failure).toBeInstanceOf(AuthRequiredError)
    expect((failure as AuthRequiredError).cause).toMatchObject({ message: "refresh rejected" })
    expect(await harness.machine.getStatus()).toEqual({ status: "expired", generation: 1 })
  })

  it("reports a persisted authenticated session as expired until a token exists", async () => {
    const harness = await makeHarness()
    await seedState(harness, {
      schemaVersion: 1,
      status: "authenticated",
      generation: 3,
      expiresAtMs: harness.clock.nowMs + 60_000,
      updatedAtMs: harness.clock.nowMs,
    })
    expect(await harness.machine.getStatus()).toEqual({
      status: "expired",
      generation: 3,
      expiresAtMs: harness.clock.nowMs + 60_000,
    })
    await expect(harness.machine.getAccessToken(0)).rejects.toBeInstanceOf(AuthRequiredError)
  })
})

describe("CredentialAuthMachine.handleUnauthorized", () => {
  it("tears the session down (logout) for the current epoch without a refresh hook", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    expect(await harness.machine.handleUnauthorized()).toBe("logout")
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 2 })
  })

  it("refreshes and reports retry for the current epoch when the hook succeeds", async () => {
    const harness = await makeHarness({
      refresh: async () => ({ accessToken: "tok-r1", expiresAtMs: harness.clock.nowMs + 60_000 }),
    })
    await loginOnce(harness, "tok-1")
    expect(await harness.machine.handleUnauthorized()).toBe("retry")
    expect(await harness.machine.getStatus()).toEqual({
      status: "authenticated",
      generation: 2,
      expiresAtMs: harness.clock.nowMs + 60_000,
    })
    const lease = await harness.machine.getAccessToken(0)
    expect(lease.accessToken).toBe("tok-r1")
    expect(lease.generation).toBe(2)
  })

  it("logs out when the refresh hook fails for the current epoch", async () => {
    const harness = await makeHarness({
      refresh: async () => {
        throw new Error("refresh rejected")
      },
    })
    await loginOnce(harness)
    expect(await harness.machine.handleUnauthorized()).toBe("logout")
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 2 })
  })

  it("keeps the session untouched for a stale generation and reports retry", async () => {
    const harness = await makeHarness()
    await loginOnce(harness, "tok-1")
    expect(await harness.machine.handleUnauthorized(0)).toBe("retry")
    expect(await harness.machine.getStatus()).toMatchObject({
      status: "authenticated",
      generation: 1,
    })
    expect((await harness.machine.getAccessToken(0)).accessToken).toBe("tok-1")
  })

  it("forces a logout when the caller reports a newer generation (divergence)", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    expect(await harness.machine.handleUnauthorized(5)).toBe("logout")
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 2 })
  })

  it("adopts a newer generation persisted by another machine and then retries stale reports", async () => {
    const stateDir = await makeTempDir("credential-lease-machine-")
    const first = await makeHarness({ stateDir })
    await loginOnce(first, "tok-1")
    const second = await makeHarness({ stateDir })
    await loginOnce(second, "tok-2")
    // `first` still holds its stale epoch until it re-reads the shared state file.
    expect(await first.machine.loadState()).toMatchObject({ generation: 2 })
    expect(await first.machine.handleUnauthorized(1)).toBe("retry")
    expect(await first.machine.getStatus()).toMatchObject({ generation: 2 })
  })

  it("a second login's authorizing epoch adopts the committed generation (no regression)", async () => {
    // Deterministic regression for the CI race: machine B's authorizing
    // write used to land OUTSIDE the lock, clobbering machine A's
    // just-committed authenticated generation back down. The authorizing
    // write now runs under the lock after a reload, so it must carry
    // A's generation, and B's commit must be the next one.
    const stateDir = await makeTempDir("credential-lease-machine-")
    const first = await makeHarness({ stateDir })
    await loginOnce(first, "tok-a")

    const stateFile = path.join(stateDir, "auth-state.json")
    let generationDuringAuthorizing: number | undefined
    const second = await makeHarness({ stateDir })
    await second.machine.login(async () => {
      const persisted = JSON.parse(await readFile(stateFile, "utf8")) as {
        generation?: number
      }
      generationDuringAuthorizing = persisted.generation
      return grantFor(second, "tok-b", 60_000)
    })

    expect(generationDuringAuthorizing).toBe(1)
    expect(await second.machine.getStatus()).toMatchObject({
      status: "authenticated",
      generation: 2,
    })
  })

  it("serializes concurrent logins across machines sharing one state directory", async () => {
    const stateDir = await makeTempDir("credential-lease-machine-")
    const first = await makeHarness({ stateDir })
    const second = await makeHarness({ stateDir })
    const [a, b] = await Promise.all([loginOnce(first, "tok-a"), loginOnce(second, "tok-b")])
    expect([a.generation, b.generation].sort()).toEqual([1, 2])
    // A third machine adopts the persisted epoch, but without the in-memory
    // token an adopted authenticated session reads as expired.
    const reader = await makeHarness({ stateDir })
    expect(await reader.machine.getStatus()).toMatchObject({ status: "expired", generation: 2 })
  })
})

describe("CredentialAuthMachine scope upgrade and subscriptions", () => {
  it("marks scope upgrades from authenticated or expired sessions", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    await harness.machine.markScopeUpgradeRequired()
    expect(await harness.machine.getStatus()).toMatchObject({
      status: "scope_upgrade_required",
      generation: 1,
    })
  })

  it("ignores scope upgrade requests from anonymous sessions", async () => {
    const harness = await makeHarness()
    await harness.machine.markScopeUpgradeRequired()
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 0 })
    expect(harness.snapshots).toEqual([])
  })

  it("stops notifying after unsubscribe and survives throwing listeners", async () => {
    const harness = await makeHarness()
    const seen: AuthStatusSnapshot[] = []
    const unsubscribe = harness.machine.subscribe(() => {
      throw new Error("listener broke")
    })
    const unsubscribeSecond = harness.machine.subscribe((snapshot) => seen.push(snapshot))
    unsubscribe()
    await loginOnce(harness)
    unsubscribeSecond()
    // No listeners left; transitions must still run to completion.
    await harness.machine.logout()
    expect(seen.map((snapshot) => snapshot.status)).toEqual(["authorizing", "authenticated"])
    expect(await harness.machine.getStatus()).toEqual({ status: "anonymous", generation: 2 })
  })

  it("persists and reloads state through loadState/persistState", async () => {
    const harness = await makeHarness()
    await loginOnce(harness)
    await harness.machine.logout()
    const store = new AuthStateStore(path.join(harness.stateDir, "auth-state.json"))
    expect(await store.read()).toMatchObject({ status: "anonymous", generation: 2 })
  })

  it("fails closed with a TypeError when the persisted state file is corrupted", async () => {
    const harness = await makeHarness()
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path.join(harness.stateDir, "auth-state.json"), "{not json", "utf8")
    await expect(harness.machine.getStatus()).rejects.toBeInstanceOf(TypeError)
  })
})
