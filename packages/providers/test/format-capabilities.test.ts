// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * apiFormat-level capability Declaration (OpenAgentCore
 * internal/harnessconfig/harness.go Declaration borrowing).
 *
 * Contracts under test:
 *   - ONE Declaration per apiFormat states the capabilities; admission
 *     (createProviderForFormat `requires`) and the runtime wire gate
 *     (wireStopSequences) both consume it;
 *   - a provider whose declaration lacks a required capability is REFUSED
 *     at admission;
 *   - runtime discovery can only NARROW the effective set — a probed
 *     missing capability degrades (wire gate closes, client-side fallback
 *     still applies) and there is no API that widens it back;
 *   - the 2026-10 model-id rejection table (capability-predicates.ts)
 *     keeps its semantics beneath the coarse format-level gate.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
  API_FORMAT_DECLARATIONS,
  assertFormatAdmission,
  declarationForFormat,
  declaredCapabilities,
  effectiveFormatCapabilities,
  formatSupports,
  noteRuntimeCapabilityMissing,
  resetRuntimeCapabilityNarrowing,
  runtimeNarrowedCapabilities,
  FormatCapabilityError,
} from "../src/format-capabilities.js"
import { createProviderForFormat } from "../src/formats/index.js"
import {
  wireStopSequences,
  applyStopWordsClientSide,
  supportsStopSequences,
} from "../src/capability-predicates.js"
import { createRegistry, resetRegistry } from "../src/registry.js"

const factoryConfig = {
  id: "t",
  name: "t",
  apiKey: "k",
  baseURL: "https://example.com/v1",
  defaultModel: "m",
}

describe("API_FORMAT_DECLARATIONS — the single source", () => {
  it("declares capabilities for every apiFormat, keyed by format", () => {
    for (const format of [
      "openai_chat",
      "anthropic",
      "gemini_native",
      "openai_responses",
    ] as const) {
      const declaration = declarationForFormat(format)
      expect(declaration.format).toBe(format)
      expect(declaration.capabilities.length).toBeGreaterThan(0)
    }
  })

  it("states the 限额映射 requirement: anthropic requires max output tokens", () => {
    expect(declarationForFormat("anthropic").requiresMaxOutputTokens).toBe(true)
    expect(declarationForFormat("anthropic").maxOutputTokensFallback).toBe(4096)
    for (const format of ["openai_chat", "gemini_native", "openai_responses"] as const) {
      expect(declarationForFormat(format).requiresMaxOutputTokens).toBe(false)
    }
  })

  it("only declares capabilities the adapters actually wire (tools nowhere, embeddings openai_chat only)", () => {
    for (const declaration of Object.values(API_FORMAT_DECLARATIONS)) {
      expect(declaration.capabilities).not.toContain("tools")
    }
    expect(declaredCapabilities("openai_chat").has("embeddings")).toBe(true)
    expect(declaredCapabilities("anthropic").has("embeddings")).toBe(false)
  })

  it("throws on an unknown apiFormat", () => {
    expect(() => declarationForFormat("carrier_pigeon" as never)).toThrow(FormatCapabilityError)
  })
})

describe("admission reads the same Declaration", () => {
  it("admits a provider whose required capabilities are declared", () => {
    const p = createProviderForFormat("openai_chat", {
      ...factoryConfig,
      requires: ["streaming", "embeddings", "maxOutputTokens"],
    })
    expect(p.id).toBe("t")
  })

  it("REFUSES a provider whose declaration lacks a required capability", () => {
    // No format wires tools today — admission must refuse, not build half-working.
    expect(() =>
      createProviderForFormat("openai_chat", { ...factoryConfig, requires: ["tools"] }),
    ).toThrow(FormatCapabilityError)
    expect(() =>
      createProviderForFormat("anthropic", { ...factoryConfig, requires: ["embeddings"] }),
    ).toThrow(FormatCapabilityError)
  })

  it("assertFormatAdmission names the missing capability", () => {
    try {
      assertFormatAdmission("gemini_native", ["streamUsage"])
      expect.fail("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(FormatCapabilityError)
      expect((err as FormatCapabilityError).capability).toBe("streamUsage")
      expect((err as FormatCapabilityError).message).toContain("streamUsage")
    }
  })

  it("the registry admits every real preset with its wrapper-stack requirement", () => {
    resetRegistry()
    const registry = createRegistry({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k2" })
    expect(registry.list().map((p) => p.id)).toContain("openai")
    expect(registry.list().map((p) => p.id)).toContain("anthropic")
  })
})

describe("runtime discovery narrows, never widens", () => {
  beforeEach(() => resetRuntimeCapabilityNarrowing())
  afterEach(() => resetRuntimeCapabilityNarrowing())

  it("a probed-missing capability leaves the declaration untouched but closes the effective set", () => {
    noteRuntimeCapabilityMissing("openai_chat", "stopSequences")
    // Declaration unchanged — narrowing is runtime state, not authoring state.
    expect(declaredCapabilities("openai_chat").has("stopSequences")).toBe(true)
    expect(runtimeNarrowedCapabilities("openai_chat")).toEqual(new Set(["stopSequences"]))
    expect(formatSupports("openai_chat", "stopSequences")).toBe(false)
    expect([...effectiveFormatCapabilities("openai_chat")].sort()).toEqual(
      [...declaredCapabilities("openai_chat")].filter((c) => c !== "stopSequences").sort(),
    )
    // Other formats are unaffected — narrowing is per-format.
    expect(formatSupports("anthropic", "stopSequences")).toBe(true)
  })

  it("wire gate degrades: narrowed format omits the parameter, client-side fallback still truncates", () => {
    const model = "gpt-x"
    // Before narrowing: the wire gate passes the sequences through.
    expect(wireStopSequences(model, ["\nObservation:"], "openai_chat")).toEqual(["\nObservation:"])
    noteRuntimeCapabilityMissing("openai_chat", "stopSequences")
    // After narrowing: the wire gate closes (degradation, not failure)...
    expect(wireStopSequences(model, ["\nObservation:"], "openai_chat")).toBeUndefined()
    // ...and the semantics still hold client-side.
    expect(applyStopWordsClientSide("answer\nObservation: tool output", ["\nObservation:"])).toBe(
      "answer",
    )
  })

  it("the model-id rejection table keeps its semantics beneath the format gate", () => {
    // Bedrock's OpenAI-hosted family still rejects stop sequences regardless
    // of the format declaration (2026-10 capability-predicates behavior).
    expect(supportsStopSequences("openai.gpt-oss-120b-1:0")).toBe(false)
    expect(supportsStopSequences("gpt-5.6")).toBe(true)
    expect(wireStopSequences("openai.gpt-oss-120b-1:0", ["STOP"], "openai_chat")).toBeUndefined()
  })

  it("cannot narrow an undeclared capability and cannot widen", () => {
    // openai_responses does not declare stopSequences — "narrowing" it is a
    // probe bug and throws; there is no API to add a capability back.
    expect(() => noteRuntimeCapabilityMissing("openai_responses", "stopSequences")).toThrow(
      FormatCapabilityError,
    )
    expect(() => noteRuntimeCapabilityMissing("openai_chat", "tools" as never)).toThrow(
      FormatCapabilityError,
    )
    expect(formatSupports("openai_responses", "stopSequences")).toBe(false)
    expect(formatSupports("openai_chat", "stopSequences")).toBe(true)
  })

  it("narrowing also refuses admission for the affected format", () => {
    noteRuntimeCapabilityMissing("gemini_native", "stopSequences")
    expect(() =>
      createProviderForFormat("gemini_native", { ...factoryConfig, requires: ["stopSequences"] }),
    ).toThrow(FormatCapabilityError)
  })
})
