// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * deny≠failure tests (crewAI borrowing): policy denials classify as
 * non-retryable `policy_denied` and are excluded from failure learning.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import {
  PolicyDeniedError,
  POLICY_DENIED_PREFIX,
  isPolicyDeniedError,
  isPolicyDeniedMessage,
  classifyTaskError,
} from "@max/core"
import type { AgentRole, AgentManifest } from "@max/core"
import { EvolutionFacade, MetricsStore, ProfileStore } from "../src/index.js"
import { entryContent } from "../src/types.js"
import { defaultReflector } from "../src/reflection.js"

describe("PolicyDeniedError", () => {
  it("carries policy + detail and serializes with a stable prefix", () => {
    const err = new PolicyDeniedError("permission:write", "user rejected /etc/hosts edit")
    expect(err.policy).toBe("permission:write")
    expect(err.detail).toContain("/etc/hosts")
    expect(isPolicyDeniedError(err)).toBe(true)
    expect(isPolicyDeniedMessage(err.message)).toBe(true)
    expect(err.message.startsWith(POLICY_DENIED_PREFIX)).toBe(true)
  })

  it("recognizes serialized prefixes and legacy tool strings", () => {
    expect(isPolicyDeniedMessage("POLICY_DENIED:governance:cap — budget exceeded")).toBe(true)
    expect(isPolicyDeniedMessage("Permission denied: write → /etc/passwd")).toBe(true)
    expect(isPolicyDeniedMessage("TypeError: boom")).toBe(false)
    expect(isPolicyDeniedMessage(undefined)).toBe(false)
  })
})

describe("classifyTaskError — policy denials", () => {
  it("classifies a typed PolicyDeniedError as policy_denied (not retryable)", () => {
    const c = classifyTaskError(new PolicyDeniedError("governance:cap", "agent limit reached"))
    expect(c.reason).toBe("policy_denied")
    expect(c.retryable).toBe(false)
    expect(c.shouldFallback).toBe(false)
  })

  it("classifies serialized denial strings as policy_denied", () => {
    const c = classifyTaskError(new Error("POLICY_DENIED:permission:write — rejected"))
    expect(c.reason).toBe("policy_denied")
    expect(c.retryable).toBe(false)
  })

  it("still classifies real failures as before", () => {
    expect(classifyTaskError(new Error("429 rate limit")).reason).toBe("rate_limit")
    expect(classifyTaskError(new Error("timeout after 30s")).retryable).toBe(true)
  })
})

describe("evolution learning excludes policy denials", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-policy-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const role: AgentRole = "backend"
  const manifest: AgentManifest = {
    role,
    displayName: role,
    goal: role,
    systemPrompt: "You are the backend agent.",
  }

  function makeFacade(): EvolutionFacade {
    return new EvolutionFacade({
      rootDir: tmp,
      candidates: [],
      fallbackProvider: {} as never,
      defaultManifests: {},
      reflector: false, // isolate from reflection in this suite
    } as never)
  }

  const baseInput = {
    task: { id: "t1", agentRole: role } as never,
    provider: "p",
    model: "m",
    executionTimeMs: 5,
    tokenInput: 1,
    tokenOutput: 1,
    defaultManifest: manifest,
  }

  it("a governance rejection is recorded as a metric but not as a failure memory", async () => {
    const facade = makeFacade()
    await facade.recordCompletion({
      ...baseInput,
      error: "POLICY_DENIED:governance:capability-cap — write ops blocked",
    })

    const profile = await facade.profiles.getOrCreate(role, manifest)
    expect(profile.memory.commonErrors).toHaveLength(0)

    const record = await facade.metrics.get("t1")
    expect(record?.error).toContain("POLICY_DENIED")
  })

  it("a real failure still lands in commonErrors", async () => {
    const facade = makeFacade()
    await facade.recordCompletion({
      ...baseInput,
      error: "TypeError: cannot read 'id' of undefined",
    })
    const profile = await facade.profiles.getOrCreate(role, manifest)
    expect(profile.memory.commonErrors).toHaveLength(1)
  })

  it("the default reflector refuses to turn a denial into a lesson", async () => {
    const lessons = await defaultReflector({
      record: {
        taskId: "t",
        agentId: "a",
        agentRole: role,
        provider: "p",
        model: "m",
        executionTime: 1,
        tokenInput: 0,
        tokenOutput: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        retryCount: 0,
        timestamp: new Date().toISOString(),
        error: "POLICY_DENIED:permission:write — rejected",
      },
    })
    expect(lessons).toEqual([])
  })

  it("entryContent sanity: reviewSuggestions still render as text", () => {
    expect(entryContent(undefined)).toBe("")
  })
})
