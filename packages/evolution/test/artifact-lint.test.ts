// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Shape-contract lint tests (hermes c240e65399 borrowing) plus the
 * end-to-end rejection path through EvolutionEngine.evolve().
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import type { AgentRole, AgentManifest } from "@max/core"
import {
  lintPromptShape,
  summarizeViolations,
  countReferences,
  EvolutionEngine,
  MetricsStore,
  ProfileStore,
  validateCandidate,
} from "../src/index.js"
import { toMemoryEntry } from "../src/types.js"

describe("lintPromptShape", () => {
  const cleanPrompt = [
    "You are the backend agent.",
    "",
    "# Output discipline",
    "- Validate every input before use.",
    "- Prefer working code over clever code.",
  ].join("\n")

  it("passes an imperative prompt with no incident references", () => {
    expect(lintPromptShape({ text: cleanPrompt })).toEqual([])
  })

  it("flags issue/PR references", () => {
    const violations = lintPromptShape({
      text: `${cleanPrompt}\nSee #1234 for the original report.`,
    })
    expect(violations.map((v) => v.code)).toContain("incident-reference")
    expect(violations[0].detail).toContain("#1234")
  })

  it("flags tracker URLs", () => {
    const violations = lintPromptShape({
      text: `${cleanPrompt}\nDetails: https://github.com/acme/widgets/issues/12`,
    })
    expect(violations.map((v) => v.code)).toContain("incident-reference")
  })

  it("flags ISO dates", () => {
    const violations = lintPromptShape({ text: `${cleanPrompt}\nSince 2026-01-15 this matters.` })
    expect(violations.map((v) => v.code)).toContain("incident-reference")
  })

  it("flags conversational debris", () => {
    const violations = lintPromptShape({ text: `${cleanPrompt}\nAs discussed, always retry once.` })
    expect(violations.map((v) => v.code)).toContain("chat-reference")
  })

  it("flags reference sprawl past the cap", () => {
    const refs = Array.from({ length: 61 }, (_, i) => `\`src/mod${i}/file.ts\``).join(" ")
    expect(countReferences(refs)).toBe(61)
    const violations = lintPromptShape({ text: `${cleanPrompt}\n${refs}` })
    expect(violations.map((v) => v.code)).toContain("references-sprawl")
  })

  it("flags section sprawl past the cap", () => {
    const sections = Array.from({ length: 25 }, (_, i) => `# Section ${i}\nDo the thing.`).join(
      "\n",
    )
    const violations = lintPromptShape({ text: `You are the agent.\n${sections}` })
    expect(violations.map((v) => v.code)).toContain("section-sprawl")
  })

  it("flags duplicate headings", () => {
    const text = ["You are the agent.", "# Rules", "- a", "# rules", "- b"].join("\n")
    const violations = lintPromptShape({ text })
    expect(violations.map((v) => v.code)).toContain("duplicate-section")
  })

  it("summarizeViolations renders code + detail", () => {
    const summary = summarizeViolations([
      { code: "incident-reference", detail: `references "#1234"` },
    ])
    expect(summary).toBe('incident-reference (references "#1234")')
  })
})

describe("constraint-gates duplicate-section", () => {
  it("rejects a candidate that repeats a heading", () => {
    const gate = validateCandidate({
      newSystemPrompt: `You are the agent. ${"x".repeat(200)}\n# Rules\n- a\n# Rules\n- b`,
      baseSystemPrompt: `You are the agent. ${"x".repeat(200)}`,
    })
    expect(gate.code).toBe("duplicate-section")
    expect(gate.ok).toBe(false)
  })

  it("accepts distinct headings", () => {
    const gate = validateCandidate({
      newSystemPrompt: `You are the agent. ${"x".repeat(200)}\n# Rules\n- a\n# Output\n- b`,
      baseSystemPrompt: `You are the agent. ${"x".repeat(200)}`,
    })
    expect(gate.ok).toBe(true)
  })
})

describe("EvolutionEngine shape-lint rejection path", () => {
  let tmp: string
  let metrics: MetricsStore
  let profiles: ProfileStore

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-shapelint-"))
    metrics = new MetricsStore(tmp)
    profiles = new ProfileStore(tmp)
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("discards a candidate whose appended feedback references an incident", async () => {
    // Long base keeps the candidate under the 20% growth cap so the lint
    // (not the growth gate) is what rejects it.
    const role: AgentRole = "backend"
    const manifest: AgentManifest = {
      role,
      displayName: role,
      goal: role,
      systemPrompt: `You are the backend agent, careful and explicit.\n${"Do the careful thing. ".repeat(90)}`,
    }
    const profile = await profiles.getOrCreate(role, manifest)
    profile.memory.userFeedback.push(toMemoryEntry("See #1234 for the incident report"))
    await profiles.save(profile)

    const engine = new EvolutionEngine(tmp, metrics, profiles)
    const decision = await engine.evolve(role, manifest)

    expect(decision.outcome).toBe("discarded")
    expect(decision.reason).toContain("Shape lint rejected")
    expect(decision.reason).toContain("incident-reference")

    // The rejected candidate landed in failed/ for postmortem.
    const failedDir = path.join(tmp, "agent-versions", role, "failed")
    const failed = await fs.readdir(failedDir)
    expect(failed).toHaveLength(1)
    const record = JSON.parse(await fs.readFile(path.join(failedDir, failed[0]), "utf-8"))
    expect(record.lint).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "incident-reference" })]),
    )
  })

  it("still promotes a clean candidate (no lint regressions)", async () => {
    const role: AgentRole = "frontend"
    const manifest: AgentManifest = {
      role,
      displayName: role,
      goal: role,
      systemPrompt: `You are the frontend agent, careful and explicit.\n${"Do the careful thing. ".repeat(120)}`,
    }
    const profile = await profiles.getOrCreate(role, manifest)
    profile.memory.userFeedback.push(toMemoryEntry("Always validate form inputs before submitting"))
    await profiles.save(profile)

    const engine = new EvolutionEngine(tmp, metrics, profiles)
    const decision = await engine.evolve(role, manifest)
    expect(decision.outcome).toBe("promoted")
    expect(decision.reason).not.toContain("Shape lint")
  })
})
