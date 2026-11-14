// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) Mini-Agent mini_agent/tools/bash_tool.py:52-205 — tests for
// the background shell registry trio:
//   - incremental cursor reads: two bash_output calls never overlap and
//     never lose a line
//   - bash_kill: SIGTERM → SIGKILL escalation, status "terminated"
//   - registry cap: starting beyond the limit is refused without spawning
//   - retention: output stays readable after the process exits

import { describe, it, expect, afterEach } from "vitest"
import { ExtensionBag, type ToolExecuteContext } from "@max/llm"
import { BackgroundShellRegistry, setBackgroundShellRegistry } from "../src/bash-background.js"
import { bashTool, type BashOutput } from "../src/bash.js"
import { bashOutputTool, bashKillTool } from "../src/bash-output.js"

function testContext(): ToolExecuteContext {
  return {
    sessionID: "test-session",
    agent: "test",
    assistantMessageID: "msg-1",
    toolCallID: "call-1",
    extensions: new ExtensionBag(),
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the predicate holds, bounded by a deadline (poll loop). */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await sleep(20)
  }
}

const registries: BackgroundShellRegistry[] = []
function makeRegistry(opts?: ConstructorParameters<typeof BackgroundShellRegistry>[0]) {
  const registry = new BackgroundShellRegistry(opts)
  registries.push(registry)
  return registry
}

afterEach(() => {
  // Kill anything still running so no process leaks between tests.
  for (const registry of registries) {
    for (const id of registry.ids()) {
      void registry.kill(id).catch(() => {})
    }
  }
  registries.length = 0
  setBackgroundShellRegistry(undefined)
})

describe("BackgroundShellRegistry — cursor reads", () => {
  it("delivers incremental output across two reads with no overlap and no loss", async () => {
    const registry = makeRegistry()
    // Three lines over time: the first read catches "a", the second the rest.
    const started = registry.start("echo a; sleep 0.25; echo b; echo c", process.cwd())
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { bashId } = started

    // First read: at least the first line, cursor past exactly what was read.
    await waitFor(() => {
      const read = registry.read(bashId)
      if (!read.ok) throw new Error(read.error)
      return read.lines.length >= 1
    })
    const first = registry.read(bashId)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.lines).toContain("a")
    expect(first.nextIndex).toBe(first.lines.length)

    // Wait for the process to finish, then read from the cursor.
    await waitFor(() => registry.snapshot(bashId)?.status !== "running")

    const second = registry.read(bashId, { lastReadIndex: first.nextIndex })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    // No overlap: "a" is not delivered twice. No loss: union == all lines.
    const union = [...first.lines, ...second.lines]
    expect(union.filter((line) => line === "a")).toHaveLength(1)
    expect(union).toContain("b")
    expect(union).toContain("c")
    expect(second.nextIndex).toBeGreaterThanOrEqual(first.nextIndex)
    // A third read from the returned cursor is empty (nothing skipped).
    const third = registry.read(bashId, { lastReadIndex: second.nextIndex })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.lines).toEqual([])

    // Exited shells are retained: status recorded, output still readable.
    expect(registry.snapshot(bashId)?.status).toBe("completed")
    const rereadFromZero = registry.read(bashId)
    expect(rereadFromZero.ok).toBe(true)
    if (!rereadFromZero.ok) return
    expect(rereadFromZero.lines).toEqual(["a", "b", "c"])
  })

  it("applies the regex filter but still advances the cursor past filtered lines", async () => {
    const registry = makeRegistry()
    const started = registry.start("echo keep-1; echo drop; echo keep-2", process.cwd())
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { bashId } = started

    await waitFor(() => registry.snapshot(bashId)?.status !== "running")
    const read = registry.read(bashId, { filter: "^keep-" })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.lines).toEqual(["keep-1", "keep-2"])
    expect(read.nextIndex).toBe(3) // advanced past the filtered line too

    const again = registry.read(bashId, { lastReadIndex: read.nextIndex })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.lines).toEqual([])
  })

  it("warns and reads unfiltered when the filter regex is invalid", async () => {
    const registry = makeRegistry()
    const started = registry.start("echo hello", process.cwd())
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { bashId } = started
    await waitFor(() => registry.snapshot(bashId)?.status !== "running")

    const read = registry.read(bashId, { filter: "([" })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.lines).toEqual(["hello"])
    expect(read.warnings.some((w) => w.includes("invalid filter regex"))).toBe(true)
  })
})

describe("BackgroundShellRegistry — kill", () => {
  it("terminates a running shell and reports status=terminated", async () => {
    const registry = makeRegistry()
    const started = registry.start("sleep 30", process.cwd())
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { bashId } = started

    const killed = await registry.kill(bashId)
    expect(killed.ok).toBe(true)
    if (!killed.ok) return
    expect(killed.status).toBe("terminated")
    // SIGTERM on bash maps to exit code 143 (128 + SIGTERM).
    expect(killed.exitCode).toBe(143)

    // The record is retained after the kill (post-termination reading).
    expect(registry.snapshot(bashId)?.status).toBe("terminated")

    // Killing again is a no-op that still reports terminated.
    const again = await registry.kill(bashId)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.status).toBe("terminated")
  })

  it("reports a structured error for an unknown bash_id", async () => {
    const registry = makeRegistry()
    const killed = await registry.kill("nope")
    expect(killed.ok).toBe(false)
    if (killed.ok) return
    expect(killed.error).toContain("shell not found: nope")
    const read = registry.read("nope")
    expect(read.ok).toBe(false)
  })
})

describe("BackgroundShellRegistry — cap", () => {
  it("refuses to start beyond maxShells without spawning", async () => {
    const registry = makeRegistry({ maxShells: 2 })
    const a = registry.start("sleep 30", process.cwd())
    const b = registry.start("sleep 30", process.cwd())
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)

    const c = registry.start("echo should-not-run", process.cwd())
    expect(c.ok).toBe(false)
    if (c.ok) return
    expect(c.error).toContain("registry is full (2/2)")
    expect(registry.size).toBe(2)
    expect(registry.ids().sort()).toEqual([a.ok ? a.bashId : "", b.ok ? b.bashId : ""].sort())
  })
})

describe("bash tool trio over the registry", () => {
  it("bash(run_in_background) returns a bashId and bash_output reads the increments", async () => {
    const registry = makeRegistry()
    setBackgroundShellRegistry(registry)

    const start = (await bashTool.execute(
      { command: "echo alpha; sleep 0.2; echo beta", run_in_background: true },
      testContext(),
    )) as BashOutput
    expect(start.background).toBe(true)
    expect(start.bashId).toBeTruthy()
    expect(start.status).toBe("running")
    expect(start.exitCode).toBe(0)
    const bashId = start.bashId as string

    // First poll: partial output with its own cursor.
    await waitFor(() => {
      const read = registry.read(bashId)
      return read.ok && read.lines.length >= 1
    })
    const firstResult = await bashOutputTool.execute({ bashId, last_read_index: 0 }, testContext())
    expect(firstResult.lines).toContain("alpha")
    expect(firstResult.nextIndex).toBeGreaterThanOrEqual(1)

    // Second poll after completion: only the new lines, from the cursor.
    await waitFor(() => registry.snapshot(bashId)?.status !== "running")
    const second = await bashOutputTool.execute(
      { bashId, last_read_index: firstResult.nextIndex },
      testContext(),
    )
    expect(second.lines).toContain("beta")
    expect(second.lines).not.toContain("alpha")
    expect(second.status).toBe("completed")
  })

  it("bash_kill reports terminated through the tool surface", async () => {
    const registry = makeRegistry()
    setBackgroundShellRegistry(registry)

    const start = (await bashTool.execute(
      { command: "sleep 30", run_in_background: true },
      testContext(),
    )) as BashOutput
    const bashId = start.bashId as string
    expect(start.bashId).toBeTruthy()

    const killed = await bashKillTool.execute({ bashId }, testContext())
    expect(killed.ok).toBe(true)
    expect(killed.status).toBe("terminated")
    expect(killed.exitCode).toBe(143)

    const afterKill = await bashOutputTool.execute({ bashId }, testContext())
    expect(afterKill.status).toBe("terminated")
  })

  it("registry rejection surfaces in the bash result without throwing", async () => {
    const registry = makeRegistry({ maxShells: 1 })
    setBackgroundShellRegistry(registry)
    const first = await registry.start("sleep 30", process.cwd())
    expect(first.ok).toBe(true)

    const result = (await bashTool.execute(
      { command: "echo nope", run_in_background: true },
      testContext(),
    )) as BashOutput
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe("error")
    expect(result.output).toContain("registry is full (1/1)")
    expect(result.bashId).toBeUndefined()
  })

  it("bash_output reports notFound for an unknown id without throwing", async () => {
    setBackgroundShellRegistry(makeRegistry())
    const result = await bashOutputTool.execute({ bashId: "ghost" }, testContext())
    expect(result.notFound).toBe(true)
    expect(result.status).toBe("error")
    expect(result.output).toContain("shell not found: ghost")
  })
})
