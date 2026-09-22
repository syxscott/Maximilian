import net from "node:net"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  createCapability,
  createCredentialLeaseClient,
  CredentialAuthMachine,
  CredentialLeaseFrameDecoder,
  CredentialLeaseProtocolError,
  encodeCredentialLeaseFrame,
  resolveCredentialLeaseEndpoint,
  startCredentialLeaseBroker,
  startCredentialLeaseServer,
  type AccessTokenLease,
  type AuthStatusSnapshot,
  type CredentialLeaseSession,
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

interface Stack {
  stateDir: string
  machine: CredentialAuthMachine
  broker: Awaited<ReturnType<typeof startCredentialLeaseBroker>>
  client: ReturnType<typeof createCredentialLeaseClient>
  close(): Promise<void>
}

async function makeStack(): Promise<Stack> {
  const stateDir = await makeTempDir("credential-lease-broker-")
  const machine = new CredentialAuthMachine({ stateDir })
  const broker = await startCredentialLeaseBroker({ stateDir, session: machine })
  const client = createCredentialLeaseClient({
    endpoint: broker.endpoint,
    capabilityFile: broker.capabilityFile,
  })
  return {
    stateDir,
    machine,
    broker,
    client,
    async close() {
      client.close()
      await broker.dispose()
    },
  }
}

function grantFor(_clock: unknown, token: string, timeToLiveMs: number): LoginGrant {
  return { accessToken: token, expiresAtMs: Date.now() + timeToLiveMs }
}

function fixedLease(token: string, generation: number): AccessTokenLease {
  return {
    accessToken: token,
    expiresAtMs: Date.now() + 60_000,
    generation,
    scopes: ["provider.default"],
    audience: "maximilian-provider",
  }
}

interface FakeSession extends CredentialLeaseSession {
  readonly loadCalls: number
  setLease(lease: AccessTokenLease | undefined): void
  failNextLoadWith(error: Error): void
  emit(snapshot: AuthStatusSnapshot): void
}

/** Session double with load counting and manual status notifications. */
function makeFakeSession(): FakeSession {
  const state = {
    loadCalls: 0,
    lease: undefined as AccessTokenLease | undefined,
    loadError: undefined as Error | undefined,
    snapshot: { status: "authenticated", generation: 1 } as AuthStatusSnapshot,
  }
  const listeners = new Set<(snapshot: AuthStatusSnapshot) => void>()
  return {
    get loadCalls() {
      return state.loadCalls
    },
    async getStatus(): Promise<AuthStatusSnapshot> {
      return state.snapshot
    },
    async getAccessToken(): Promise<AccessTokenLease> {
      state.loadCalls += 1
      if (state.loadError) throw state.loadError
      if (!state.lease) throw new CredentialLeaseProtocolError("AUTH_REQUIRED")
      return state.lease
    },
    async handleUnauthorized(): Promise<"retry" | "logout"> {
      return "logout"
    },
    subscribe(listener: (snapshot: AuthStatusSnapshot) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setLease(lease: AccessTokenLease | undefined): void {
      state.lease = lease
    },
    failNextLoadWith(error: Error): void {
      state.loadError = error
    },
    emit(snapshot: AuthStatusSnapshot): void {
      state.snapshot = snapshot
      for (const listener of listeners) listener(snapshot)
    },
  }
}

function connectSocket(endpoint: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint)
    socket.once("connect", () => resolve(socket))
    socket.once("error", reject)
  })
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${label}`)),
      milliseconds,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.once("close", () => resolve())
    socket.once("error", () => resolve())
  })
}

/** Sends the queued request (half-closing the write side) and collects response frames. */
function readFrames(socket: net.Socket, decoder: CredentialLeaseFrameDecoder): Promise<unknown[]> {
  const collected: unknown[] = []
  socket.on("data", (chunk) => {
    try {
      collected.push(...decoder.push(chunk))
    } catch {
      socket.destroy()
    }
  })
  const closed = waitForClose(socket)
  socket.end()
  return withTimeout(closed, 5000, "the server to answer and close").then(() => collected)
}

describe("credential lease broker over a unix socket", () => {
  it("writes the capability file 0600 into a 0700 run directory", async () => {
    const stateDir = await makeTempDir("credential-lease-broker-")
    const machine = new CredentialAuthMachine({ stateDir })
    const broker = await startCredentialLeaseBroker({ stateDir, session: machine })
    try {
      const runDir = path.dirname(broker.capabilityFile)
      expect((await stat(broker.capabilityFile)).mode & 0o777).toBe(0o600)
      expect((await stat(runDir)).mode & 0o777).toBe(0o700)
      expect((await readFile(broker.capabilityFile, "utf8")).trim()).toMatch(/^[a-f0-9]{64}$/u)
      expect((await stat(broker.endpoint)).mode & 0o777).toBe(0o600)
    } finally {
      await broker.dispose()
    }
  })

  it("reports the anonymous session status before any login", async () => {
    const stack = await makeStack()
    try {
      expect(await stack.client.getStatus()).toEqual({
        method: "status",
        status: "anonymous",
        generation: 0,
      })
    } finally {
      await stack.close()
    }
  })

  it("reports AUTH_REQUIRED while anonymous and serves leases after login", async () => {
    const stack = await makeStack()
    try {
      const rejected = await stack.client.getLease(0).catch((error) => error)
      expect(rejected).toBeInstanceOf(CredentialLeaseProtocolError)
      expect((rejected as CredentialLeaseProtocolError).code).toBe("AUTH_REQUIRED")

      const grant = grantFor(undefined, "tok-1", 60_000)
      await stack.machine.login(async () => grant)
      expect(await stack.client.getStatus()).toEqual({
        method: "status",
        status: "authenticated",
        generation: 1,
        expiresAtMs: grant.expiresAtMs,
      })
      expect(await stack.client.getLease(0)).toEqual({
        method: "lease",
        accessToken: "tok-1",
        expiresAtMs: grant.expiresAtMs,
        generation: 1,
        audience: "maximilian-provider",
        scopes: ["provider.default"],
      })
    } finally {
      await stack.close()
    }
  })

  it("caches the lease: repeated requests do not re-enter the session", async () => {
    const session = makeFakeSession()
    session.setLease(fixedLease("tok-1", 1))
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      expect((await client.getLease(1000)).accessToken).toBe("tok-1")
      expect((await client.getLease(1000)).accessToken).toBe("tok-1")
      expect(session.loadCalls).toBe(1)
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("fails fast with AUTH_REQUIRED when a freshly loaded lease is never usable", async () => {
    // Regression: a lease that satisfied the session but failed the broker's
    // own usability check used to be retried in an unbounded loop, livelocking
    // the request (and the worker) instead of answering.
    const session = makeFakeSession()
    session.setLease({
      accessToken: "stale-token",
      expiresAtMs: Date.now() - 60_000, // already expired on the broker's clock
      generation: 1,
      scopes: ["provider.default"],
      audience: "maximilian-provider",
    })
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      const attempt = client.getLease(0)
      const failure = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("broker livelocked on an unusable lease")),
          3000,
        )
        attempt.then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            resolve(error)
          },
        )
      })
      expect(failure).toBeInstanceOf(CredentialLeaseProtocolError)
      expect((failure as CredentialLeaseProtocolError).code).toBe("AUTH_REQUIRED")
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("joins concurrent lease requests into one in-flight session load", async () => {
    const session = makeFakeSession()
    session.setLease(fixedLease("tok-1", 1))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = session.getAccessToken.bind(session)
    // Hold every load open until released so a second request can arrive while
    // the first is still in flight.
    session.getAccessToken = async (minValidityMs: number) => {
      await gate
      return inner(minValidityMs)
    }
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      const first = client.getLease(0)
      await new Promise((resolve) => setTimeout(resolve, 30))
      const second = client.getLease(0)
      await new Promise((resolve) => setTimeout(resolve, 30))
      release()
      expect(await first).toMatchObject({ accessToken: "tok-1", generation: 1 })
      expect(await second).toMatchObject({ accessToken: "tok-1", generation: 1 })
      expect(session.loadCalls).toBe(1)
    } finally {
      release()
      client.close()
      await broker.dispose()
    }
  })

  it("maps an unauthorized report onto logout and closes admission", async () => {
    const stack = await makeStack()
    try {
      await stack.machine.login(async () => grantFor(undefined, "tok-1", 60_000))
      const lease = await stack.client.getLease(0)
      expect(await stack.client.handleUnauthorized(lease.generation)).toEqual({
        method: "unauthorized",
        action: "logout",
      })
      expect(await stack.client.getStatus()).toEqual({
        method: "status",
        status: "anonymous",
        generation: 2,
      })
      const rejected = await stack.client.getLease(0).catch((error) => error)
      expect((rejected as CredentialLeaseProtocolError).code).toBe("AUTH_REQUIRED")
    } finally {
      await stack.close()
    }
  })

  it("serves a refreshed lease with a new generation after an unauthorized retry", async () => {
    const stateDir = await makeTempDir("credential-lease-broker-")
    let refreshCount = 0
    const machine = new CredentialAuthMachine({
      stateDir,
      refresh: async () => {
        refreshCount += 1
        return { accessToken: `tok-r${refreshCount}`, expiresAtMs: Date.now() + 60_000 }
      },
    })
    const broker = await startCredentialLeaseBroker({ stateDir, session: machine })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      await machine.login(async () => ({ accessToken: "tok-0", expiresAtMs: Date.now() + 5000 }))
      expect(await client.getLease(30_000)).toMatchObject({
        accessToken: "tok-r1",
        generation: 2,
      })
      expect(await client.getLease(0)).toMatchObject({ accessToken: "tok-r1", generation: 2 })
      expect(refreshCount).toBe(1)
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("rejects clients presenting a capability other than the broker's", async () => {
    const stateDir = await makeTempDir("credential-lease-broker-")
    const machine = new CredentialAuthMachine({ stateDir })
    const broker = await startCredentialLeaseBroker({ stateDir, session: machine })
    const endpoint = resolveCredentialLeaseEndpoint(stateDir)
    // Overwrite the shared capability file with a valid-looking but wrong secret.
    await writeFile(endpoint.capabilityFile, `${createCapability()}\n`, "utf8")
    const impostor = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: endpoint.capabilityFile,
    })
    try {
      const error = await impostor.getStatus().catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialLeaseProtocolError)
      expect((error as CredentialLeaseProtocolError).code).toBe("CAPABILITY_REJECTED")
    } finally {
      impostor.close()
      await broker.dispose()
    }
  })

  it("maps an in-session failure onto INTERNAL_ERROR while the session looks healthy", async () => {
    const session = makeFakeSession()
    session.failNextLoadWith(new Error("session exploded"))
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      const error = await client.getLease(0).catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialLeaseProtocolError)
      expect((error as CredentialLeaseProtocolError).code).toBe("INTERNAL_ERROR")
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("raises its minimum generation floor and drops stale cached leases", async () => {
    const session = makeFakeSession()
    session.setLease(fixedLease("tok-1", 1))
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      expect(await client.getLease(0)).toMatchObject({ generation: 1 })
      // A login elsewhere bumps the epoch and the broker hears the notification.
      session.emit({ status: "authenticated", generation: 2 })
      const error = await client.getLease(0).catch((caught) => caught)
      expect((error as CredentialLeaseProtocolError).code).toBe("AUTH_REQUIRED")
      session.setLease(fixedLease("tok-2", 2))
      expect(await client.getLease(0)).toMatchObject({ accessToken: "tok-2", generation: 2 })
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("closes admission while the session leaves the authenticated lifecycle", async () => {
    const session = makeFakeSession()
    session.setLease(fixedLease("tok-1", 1))
    const stateDir = await makeTempDir("credential-lease-broker-")
    const broker = await startCredentialLeaseBroker({ stateDir, session })
    const client = createCredentialLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    })
    try {
      expect(await client.getLease(0)).toMatchObject({ accessToken: "tok-1" })
      session.emit({ status: "expired", generation: 1 })
      const error = await client.getLease(0).catch((caught) => caught)
      expect((error as CredentialLeaseProtocolError).code).toBe("AUTH_REQUIRED")
      session.emit({ status: "authenticated", generation: 1 })
      expect(await client.getLease(0)).toMatchObject({ accessToken: "tok-1" })
    } finally {
      client.close()
      await broker.dispose()
    }
  })

  it("disposes idempotently, removes the capability file, and stops serving", async () => {
    const stack = await makeStack()
    await stack.machine.login(async () => grantFor(undefined, "tok-1", 60_000))
    await stack.client.getStatus()
    await stack.broker.dispose()
    const capabilityGone = await stat(stack.broker.capabilityFile).then(
      () => false,
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    )
    expect(capabilityGone).toBe(true)
    await stack.broker.dispose() // second dispose is a no-op
    stack.client.close()
    const lateClient = createCredentialLeaseClient({
      endpoint: stack.broker.endpoint,
      capabilityFile: stack.broker.capabilityFile,
    })
    try {
      const error = await lateClient.getStatus().catch((caught) => caught)
      expect(error).toBeInstanceOf(CredentialLeaseProtocolError)
      expect((error as CredentialLeaseProtocolError).code).toBe("BROKER_UNAVAILABLE")
    } finally {
      lateClient.close()
    }
  })

  it("rejects client construction with non-positive timeouts", () => {
    expect(() =>
      createCredentialLeaseClient({
        endpoint: "/tmp/x/run/credential-lease-v1.sock",
        capabilityFile: "/tmp/x/run/credential-lease-v1.cap",
        requestTimeoutMs: 0,
      }),
    ).toThrow(CredentialLeaseProtocolError)
  })
})

describe("credential lease wire protocol hardening", () => {
  it("destroys the connection on a frame without a usable request id", async () => {
    const stack = await makeStack()
    try {
      const socket = await connectSocket(stack.broker.endpoint)
      const payload = Buffer.from('{"version":1,"requestId":"bad!!id"}', "utf8")
      const header = Buffer.alloc(4)
      header.writeUInt32BE(payload.length, 0)
      socket.write(Buffer.concat([header, payload]))
      await withTimeout(waitForClose(socket), 5000, "the server to reject the bad frame")
    } finally {
      await stack.close()
    }
  })

  it("destroys the connection on a zero-length frame", async () => {
    const stack = await makeStack()
    try {
      const socket = await connectSocket(stack.broker.endpoint)
      socket.write(Buffer.alloc(4))
      await withTimeout(waitForClose(socket), 5000, "the server to reject the empty frame")
    } finally {
      await stack.close()
    }
  })

  it("answers an unknown method with an INVALID_REQUEST failure response", async () => {
    const stack = await makeStack()
    try {
      const capability = (await readFile(stack.broker.capabilityFile, "utf8")).trim()
      const socket = await connectSocket(stack.broker.endpoint)
      socket.write(
        encodeCredentialLeaseFrame({
          version: 1,
          requestId: "probe-unknown",
          capability,
          method: "teleport",
        }),
      )
      const frames = await readFrames(socket, new CredentialLeaseFrameDecoder())
      expect(frames).toEqual([
        {
          version: 1,
          requestId: "probe-unknown",
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Credential lease request is invalid.",
          },
        },
      ])
    } finally {
      await stack.close()
    }
  })

  it("rejects a server started with a malformed capability", async () => {
    const stateDir = await makeTempDir("credential-lease-broker-")
    const endpoint = resolveCredentialLeaseEndpoint(stateDir)
    await expect(
      startCredentialLeaseServer({
        endpoint: endpoint.endpoint,
        capability: "too-short",
        handler: async () => ({ method: "status", status: "anonymous", generation: 0 }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" })
  })
})
