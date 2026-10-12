// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the single-pass prompt-template renderer wired into
 * BlueprintGenerator (conductor e171f9d8e borrowing): the `{{userRequest}}`
 * fill in capability prompt templates is linear, splice-verbatim, and
 * pin-safe against brace-heavy inputs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findPlaceholders, renderPromptTemplate } from "../src/prompt-template.js"
import { CapabilityLibrary } from "../src/capability-library.js"
import { BlueprintStore } from "../src/blueprint-store.js"
import { BlueprintGenerator } from "../src/blueprint-generator.js"

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dags-template-"))
}

describe("findPlaceholders — single-pass scan semantics", () => {
  it("finds plain and repeated slots with exact ranges", () => {
    expect(findPlaceholders("no slots").map((p) => p.name)).toEqual([])
    expect(findPlaceholders("{{a}}")).toEqual([{ start: 0, end: 5, name: "a" }])
    expect(findPlaceholders("x {{a}} y {{b}} z").map((p) => [p.start, p.end])).toEqual([
      [2, 7],
      [10, 15],
    ])
  })
  it("trims the name and folds nested braces into the outer slot", () => {
    expect(findPlaceholders("{{  userRequest  }}")[0]?.name).toBe("userRequest")
    expect(findPlaceholders("{{ {x} {{y}} }}")[0]?.name).toBe("{x} {{y")
  })
  it("an unclosed {{ hides the tail", () => {
    expect(findPlaceholders("open {{ never")).toEqual([])
    expect(findPlaceholders("{{a}} tail {{b")).toHaveLength(1)
  })
})

describe("renderPromptTemplate", () => {
  it("fills slots, repeatedly, without re-scanning replacements", () => {
    expect(renderPromptTemplate("Hi {{userRequest}} — {{userRequest}}", { userRequest: "R" })).toBe(
      "Hi R — R",
    )
    expect(renderPromptTemplate("{{a}}", { a: "{{b}}", b: "boom" })).toBe("{{b}}")
  })
  it("unknown slots render empty", () => {
    expect(renderPromptTemplate("[{{missing}}]", {})).toBe("[]")
  })
  it("an unclosed {{ leaves the tail raw", () => {
    expect(renderPromptTemplate("keep {{ userRequest", { userRequest: "x" })).toBe(
      "keep {{ userRequest",
    )
  })
  it("is not pathological on brace-heavy templates", () => {
    const template = "{".repeat(100_000)
    expect(renderPromptTemplate(template, { userRequest: "y" })).toBe(template)
  })
})

describe("BlueprintGenerator template fill through the renderer", () => {
  let tmp: string
  let generator: BlueprintGenerator

  beforeEach(async () => {
    tmp = await makeTmp()
    generator = new BlueprintGenerator(new CapabilityLibrary(), new BlueprintStore(tmp))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("fills {{userRequest}} from the capability library templates", async () => {
    const library = new CapabilityLibrary()
    const frontend = library.get("frontend")
    expect(frontend?.promptTemplate).toContain("{{userRequest}}")
    const [bp] = await generator.generate(["frontend"], { userRequest: "Build a todo app" })
    expect(bp.systemPrompt).toContain("Build a todo app")
    expect(bp.systemPrompt).not.toContain("{{userRequest}}")
  })
  it("a user request containing template syntax is spliced verbatim (no second pass)", async () => {
    const hostile = "{{userRequest}} was here"
    const [bp] = await generator.generate(["frontend"], { userRequest: hostile })
    // The injected text is not re-scanned: the original slot is consumed
    // (the fill happened exactly once there) — the literal {{userRequest}}
    // occurrences left are the injected value itself plus composePrompt's
    // trailing raw-request appendix, never the untouched slot.
    expect(bp.systemPrompt).not.toContain("part of: {{userRequest}}.")
    expect(bp.systemPrompt).toContain("part of: {{userRequest}} was here.")
  })
})
