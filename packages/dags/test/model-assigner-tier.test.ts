// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ModelAssigner role-tier annotation (wshobson/agents model-tier borrowing).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import type { AgentRole } from "@max/core"
import type { Provider } from "@max/providers"
import { EvolutionFacade } from "@max/evolution"
import { ModelAssigner, DEFAULT_ROLE_TIER_POLICY } from "../src/model-assigner.js"
import { BlueprintStore } from "../src/blueprint-store.js"
import { TeamGraphBuilder } from "../src/team-graph-builder.js"
import type { AgentBlueprint } from "../src/types.js"

let tmp: string
let store: BlueprintStore
let facade: EvolutionFacade

function makeProvider(id: string, model: string): Provider {
  return {
    id,
    name: id,
    defaultModel: model,
    isConfigured: () => true,
    chat: async () => ({ content: "ok", model }),
    stream: async function* () {
      yield { delta: "ok", done: true }
    },
  }
}

function mkBp(id: string, role: AgentRole): AgentBlueprint {
  return {
    id,
    role,
    displayName: id,
    goal: `do ${id} work`,
    systemPrompt: `You are ${id}.`,
    capabilities: [],
    createdAt: new Date().toISOString(),
  } as unknown as AgentBlueprint
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-dags-tier-"))
  store = new BlueprintStore(tmp)
  facade = new EvolutionFacade({
    rootDir: tmp,
    candidates: [makeProvider("openai", "gpt-4o"), makeProvider("anthropic", "claude-sonnet")],
    fallbackProvider: makeProvider("openai", "gpt-4o"),
    defaultManifests: {},
  })
  await facade.initialize()
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("DEFAULT_ROLE_TIER_POLICY", () => {
  it("maps review/orchestration to frontier, utility to economy, rest to standard", () => {
    expect(DEFAULT_ROLE_TIER_POLICY("review")).toBe("frontier")
    expect(DEFAULT_ROLE_TIER_POLICY("reviewer-2")).toBe("frontier")
    expect(DEFAULT_ROLE_TIER_POLICY("orchestrator")).toBe("frontier")
    expect(DEFAULT_ROLE_TIER_POLICY("docs-summarizer")).toBe("economy")
    expect(DEFAULT_ROLE_TIER_POLICY("frontend")).toBe("standard")
    expect(DEFAULT_ROLE_TIER_POLICY("backend")).toBe("standard")
    expect(DEFAULT_ROLE_TIER_POLICY("general")).toBe("standard")
  })
})

describe("ModelAssigner tier annotation", () => {
  it("stamps the role tier on every node assignment", async () => {
    const bps: AgentBlueprint[] = [mkBp("reviewer", "review"), mkBp("worker", "backend")]
    const graph = new TeamGraphBuilder().build(bps, "ws", [])
    const assigner = new ModelAssigner(facade, store)
    const result = await assigner.assign(graph)

    for (const node of result.nodes) {
      expect(node.modelAssignment).toBeDefined()
      expect(node.modelAssignment!.tier).toBeTruthy()
      expect(node.modelAssignment!.reason).toContain(`tier=${node.modelAssignment!.tier}`)
    }
    const review = result.nodes.find((n) => n.role === "review")
    expect(review?.modelAssignment!.tier).toBe("frontier")
  })

  it("honors a custom tier policy", async () => {
    const bps: AgentBlueprint[] = [mkBp("worker", "backend")]
    const graph = new TeamGraphBuilder().build(bps, "ws", [])
    const assigner = new ModelAssigner(facade, store, () => "economy")
    const result = await assigner.assign(graph)
    for (const node of result.nodes) {
      expect(node.modelAssignment!.tier).toBe("economy")
    }
  })
})
