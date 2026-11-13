// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Env-anchor snapshots with change-dedup injection (deepseek chat-demo
 * latestReminder.ts + toRequestMessages appendReminder borrowing): the
 * snapshot is injected only on first appearance or when its content
 * changed — an unchanged snapshot is never re-sent, so anchors stay fresh
 * without burning tokens every round.
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_ENV_ANCHOR_FORMATTERS,
  createEnvSnapshot,
  defaultEnvSnapshotProvider,
  formatAnchorMessage,
  shouldInjectAnchor,
} from "../src/context-anchor.js"
import { makeTool } from "@max/llm"
import { ToolEnabledProvider, createToolRegistry, runToolLoop } from "../src/tool-integration.js"
import type { ChatResponse, Provider } from "@max/providers"

const FIXED_NOW = new Date(2026, 10, 14, 12, 0, 0) // 2026-11-14, local time

const deterministicFormatters = {
  date: () => "2026-11-14",
  weekday: () => "Saturday",
  timezone: () => "Asia/Shanghai",
}

describe("createEnvSnapshot", () => {
  it("joins the five anchor fields with commas (chat-demo joining convention)", () => {
    const snapshot = createEnvSnapshot(
      FIXED_NOW,
      { workspaceId: "ws-1", modelId: "m-1", language: "en-US" },
      deterministicFormatters,
    )
    expect(snapshot).toBe("2026-11-14,Saturday,ws-1,m-1,en-US")
  })

  it("prefers cwd over workspaceId as the location anchor", () => {
    const snapshot = createEnvSnapshot(
      FIXED_NOW,
      { cwd: "/home/user/project", workspaceId: "ws-1", modelId: "m-1" },
      deterministicFormatters,
    )
    expect(snapshot.split(",")[2]).toBe("/home/user/project")
  })

  it("falls back to the timezone when no language is given", () => {
    const snapshot = createEnvSnapshot(
      FIXED_NOW,
      { workspaceId: "ws-1", modelId: "m-1" },
      deterministicFormatters,
    )
    expect(snapshot.split(",")[4]).toBe("Asia/Shanghai")
  })

  it("uses deterministic defaults for every field (host-clock providers remain injectable)", () => {
    const snapshot = createEnvSnapshot(new Date(2026, 10, 14), { workspaceId: "w", modelId: "m" })
    const fields = snapshot.split(",")
    expect(fields).toHaveLength(5)
    expect(fields[0]).toBe("2026-11-14")
    expect(fields[1]).toBe(DEFAULT_ENV_ANCHOR_FORMATTERS.weekday(new Date(2026, 10, 14)))
  })
})

describe("shouldInjectAnchor (chat-demo appendReminder dedup semantics)", () => {
  it("injects on first appearance", () => {
    expect(shouldInjectAnchor(undefined, "snap-A")).toBe(true)
  })

  it("skips injection when the snapshot is unchanged", () => {
    expect(shouldInjectAnchor("snap-A", "snap-A")).toBe(false)
  })

  it("injects when the snapshot changed", () => {
    expect(shouldInjectAnchor("snap-A", "snap-B")).toBe(true)
  })

  it("an empty snapshot never injects", () => {
    expect(shouldInjectAnchor(undefined, "")).toBe(false)
    expect(shouldInjectAnchor("snap-A", "")).toBe(false)
  })
})

describe("formatAnchorMessage", () => {
  it("renders a user-role anchor body with an explicit environment-anchor annotation", () => {
    const message = formatAnchorMessage("2026-11-14,Saturday,ws-1,m-1,en-US")
    expect(message.startsWith("[environment anchor]")).toBe(true)
    expect(message).toContain("2026-11-14,Saturday,ws-1,m-1,en-US")
  })
})

describe("defaultEnvSnapshotProvider", () => {
  it("recomputes per call so a crossing day boundary yields a changed snapshot", () => {
    let now = new Date(2026, 10, 14, 23, 59, 0)
    const provider = defaultEnvSnapshotProvider(
      { workspaceId: "ws-1", modelId: "m-1" },
      {
        ...deterministicFormatters,
        date: () => (now.getDate() === 14 ? "2026-11-14" : "2026-11-15"),
      },
    )
    const before = provider()
    now = new Date(2026, 10, 15, 0, 1, 0)
    const after = provider()
    expect(before).not.toBe(after)
  })
})

// ── runToolLoop wiring ───────────────────────────────────────────────────────

const plain = (content: string): ChatResponse => ({
  content,
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
})

const toolBlock = (name: string, input: unknown): string =>
  "```tool\n" + JSON.stringify({ name, input }) + "\n```"

class ScriptedProvider implements Provider {
  id = "scripted"
  name = "scripted"
  defaultModel = "scripted-1"
  isConfigured(): boolean {
    return true
  }
  readonly requests: string[][] = []
  private step = 0
  constructor(private readonly script: ChatResponse[]) {}
  async chat(messages: { content: string }[]): Promise<ChatResponse> {
    this.requests.push(messages.map((m) => m.content))
    return this.script[Math.min(this.step++, this.script.length - 1)]!
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

const makeLoop = (provider: Provider): ToolEnabledProvider => {
  const registry = createToolRegistry()
  registry.register({
    echo: makeTool({
      name: "echo",
      description: "echo",
      kind: "misc",
      inputSchema: { type: "object" },
      execute: async (input) => input,
    }),
  })
  return new ToolEnabledProvider(provider, registry)
}

const ANCHOR_TAG = "[environment anchor]"

describe("runToolLoop env-anchor injection", () => {
  it("sends the anchor once when the snapshot is stable across rounds", async () => {
    const provider = new ScriptedProvider([plain(toolBlock("echo", { x: 1 })), plain("done")])
    let snapshotCalls = 0
    await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 5,
      envSnapshot: () => {
        snapshotCalls++
        return "stable-snapshot"
      },
    })
    // Two rounds → two LLM calls. The anchor was pushed once (first
    // appearance) and CARRIED in the conversation history — if the dedup
    // were broken, the second request would show two anchor messages.
    expect(provider.requests).toHaveLength(2)
    const anchorsPerRequest = provider.requests.map(
      (req) => req.filter((c) => c.startsWith(ANCHOR_TAG)).length,
    )
    expect(anchorsPerRequest).toEqual([1, 1])
    // The snapshot is recomputed before every LLM call (fresh Date each
    // time), not memoized by the loop.
    expect(snapshotCalls).toBe(2)
  })

  it("re-injects exactly once per distinct snapshot when the environment changes mid-loop", async () => {
    const provider = new ScriptedProvider([
      plain(toolBlock("echo", { x: 1 })),
      plain(toolBlock("echo", { x: 2 })),
      plain("done"),
    ])
    let round = 0
    await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 5,
      envSnapshot: () => `snapshot-round-${Math.min(round++, 2)}`,
    })
    expect(provider.requests).toHaveLength(3)
    // Each round's request carries exactly one anchor per DISTINCT snapshot
    // seen so far (cumulative history: [1, 2, 3]) — no snapshot was ever
    // re-sent after its round.
    const anchorsPerRequest = provider.requests.map(
      (req) => req.filter((c) => c.startsWith(ANCHOR_TAG)).length,
    )
    expect(anchorsPerRequest).toEqual([1, 2, 3])
    const finalRequest = provider.requests[2]!
    for (const snapshot of ["snapshot-round-0", "snapshot-round-1", "snapshot-round-2"]) {
      expect(
        finalRequest.filter((c) => c.startsWith(ANCHOR_TAG) && c.includes(snapshot)),
      ).toHaveLength(1)
    }
  })

  it("without an envSnapshot provider nothing is injected (zero-overhead default)", async () => {
    const provider = new ScriptedProvider([plain(toolBlock("echo", { x: 1 })), plain("done")])
    await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], { maxRounds: 5 })
    for (const request of provider.requests) {
      expect(request.some((c) => c.startsWith(ANCHOR_TAG))).toBe(false)
    }
  })
})
