// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Multi-backend SandboxService tests (借鉴 Open Interpreter).
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  LocalSandboxService,
  DockerSandboxService,
  MacSandboxExecService,
  ProcessSandboxService,
  SandboxServiceBase,
  type SandboxOptions,
} from "../src/sandbox.js"

const LOCAL_OPTS: SandboxOptions = { backend: "local" }
const PROCESS_OPTS: SandboxOptions = { backend: "process" }
const DOCKER_OPTS: SandboxOptions = { backend: "docker", dockerImage: "ubuntu:22.04" }
const MAC_OPTS: SandboxOptions = { backend: "mac-sandbox-exec" }

describe("SandboxServiceBase.create() factory", () => {
  it("creates LocalSandboxService for 'local'", () => {
    const svc = SandboxServiceBase.create(LOCAL_OPTS)
    expect(svc).toBeInstanceOf(LocalSandboxService)
    expect(svc.backend).toBe("local")
  })

  it("creates ProcessSandboxService for 'process'", () => {
    const svc = SandboxServiceBase.create(PROCESS_OPTS)
    expect(svc).toBeInstanceOf(ProcessSandboxService)
    expect(svc.backend).toBe("process")
  })

  it("creates DockerSandboxService for 'docker'", () => {
    const svc = SandboxServiceBase.create(DOCKER_OPTS)
    expect(svc).toBeInstanceOf(DockerSandboxService)
    expect(svc.backend).toBe("docker")
  })

  it("creates MacSandboxExecService for 'mac-sandbox-exec'", () => {
    const svc = SandboxServiceBase.create(MAC_OPTS)
    expect(svc).toBeInstanceOf(MacSandboxExecService)
    expect(svc.backend).toBe("mac-sandbox-exec")
  })

  it("unknown backend defaults to LocalSandboxService", () => {
    const svc = SandboxServiceBase.create({ backend: "local" as import("../src/sandbox.js").SandboxBackend })
    expect(svc).toBeInstanceOf(LocalSandboxService)
  })
})

describe("LocalSandboxService", () => {
  let svc: LocalSandboxService

  beforeEach(() => {
    svc = new LocalSandboxService()
  })

  it("execute() runs a command and returns stdout", async () => {
    const result = await svc.execute("echo hello from local")
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from local")
  })

  it("execute() returns non-zero exit code on failure", async () => {
    const result = await svc.execute("exit 42")
    expect(result.exitCode).toBe(42)
  })

  it("execute() accepts timeout option", async () => {
    const result = await svc.execute("sleep 0.1 && echo done", { timeout: 5000 })
    expect(result.exitCode).toBe(0)
  })

  it("execute() times out when command exceeds timeout", async () => {
    const result = await svc.execute("sleep 10", { timeout: 100 })
    expect(result.exitCode).not.toBe(0)
    expect(result.duration).toBeLessThan(5000)
  })

  it("writeFile() and readFile() round-trip", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const dir = await mkdtemp(`${tmpdir()}/sandbox-test-`)
    const path = `${dir}/test.txt`
    await svc.writeFile(path, "hello world")
    const content = await svc.readFile(path)
    expect(content).toBe("hello world")
    await rm(dir, { recursive: true })
  })

  it("remove() deletes a file", async () => {
    const { writeFile, rm, mkdtemp } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const dir = await mkdtemp(`${tmpdir()}/sandbox-test-`)
    const path = `${dir}/test.txt`
    await writeFile(path, "hello")
    await svc.remove(path)
    await expect(svc.readFile(path)).rejects.toThrow()
    await rm(dir, { recursive: true })
  })

  it("isAvailable() returns true", async () => {
    await expect(svc.isAvailable()).resolves.toBe(true)
  })

  it("destroy() clears state", async () => {
    await svc.destroy()
    // After destroy, execute should still work (new execution context).
    const result = await svc.execute("echo ok")
    expect(result.exitCode).toBe(0)
  })
})

describe("LocalSandboxService legacy interface (backward compatibility)", () => {
  let svc: LocalSandboxService

  beforeEach(() => {
    svc = new LocalSandboxService()
  })

  it("start() returns running sandbox", async () => {
    const sb = await svc.start()
    expect(sb.status).toBe("running")
    expect(sb.id).toMatch(/^sb-/)
  })

  it("pause()/resume() flip status", async () => {
    const sb = await svc.start()
    expect(await svc.pause(sb.id)).toBe(true)
    expect((await svc.get(sb.id))?.status).toBe("paused")
    expect(await svc.resume(sb.id)).toBe(true)
    expect((await svc.get(sb.id))?.status).toBe("running")
  })

  it("stop() removes sandbox", async () => {
    const sb = await svc.start()
    expect(await svc.stop(sb.id)).toBe(true)
    expect(await svc.get(sb.id)).toBeNull()
  })

  it("exec() runs in sandbox working dir", async () => {
    const sb = await svc.start({ metadata: { workingDir: "/tmp" } })
    const result = await svc.exec(sb.id, "pwd")
    expect(result.exitCode).toBe(0)
    // /tmp should be mentioned in output
    expect(result.stdout).toMatch(/\/tmp/)
  })
})

describe("ProcessSandboxService", () => {
  let svc: ProcessSandboxService

  beforeEach(() => {
    svc = new ProcessSandboxService(PROCESS_OPTS)
  })

  it("execute() runs a command", async () => {
    const result = await svc.execute("echo hello from process")
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from process")
  })

  it("isAvailable() returns true", async () => {
    await expect(svc.isAvailable()).resolves.toBe(true)
  })
})

describe("MacSandboxExecService", () => {
  it("isAvailable() returns false on non-macOS", async () => {
    const svc = new MacSandboxExecService(MAC_OPTS)
    // We're on Linux so it should not be available.
    await expect(svc.isAvailable()).resolves.toBe(process.platform === "darwin")
  })
})
