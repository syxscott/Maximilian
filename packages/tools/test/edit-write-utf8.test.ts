// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) OpenCode packages/core/test/tool-edit.test.ts /
// tool-patch.test.ts (commit b4d81f04ad) — files that will be rewritten
// as text must pass a UTF-8 validity gate; invalid bytes are refused and
// the original file is left byte-for-byte unchanged.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExtensionBag, ToolFailure, type ToolExecuteContext } from "@max/llm"
import { editTool, type EditOutput } from "../src/edit.js"
import { writeTool, type WriteOutput } from "../src/write.js"

function testContext(): ToolExecuteContext {
  return {
    sessionID: "test-session",
    agent: "test",
    assistantMessageID: "msg-1",
    toolCallID: "call-1",
    extensions: new ExtensionBag(),
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "max-tools-edit-utf8-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("edit tool — UTF-8 gate", () => {
  it("refuses a latin-1 file whose oldString still matches after decoding, leaving bytes unchanged", async () => {
    const filePath = join(dir, "latin1.txt")
    // 0xe9 is é in latin-1 but invalid as a standalone UTF-8 byte; the
    // rest of the file still contains an ASCII match for oldString.
    const original = Buffer.concat([Buffer.from("caf\xe9 ", "latin1"), Buffer.from("hello\n")])
    await writeFile(filePath, original)

    const failure = await editTool
      .execute({ path: filePath, oldString: "hello", newString: "bye" }, testContext())
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ToolFailure)
    expect((failure as Error).message).toContain("not valid UTF-8")
    expect(Buffer.compare(await readFile(filePath), original)).toBe(0)
  })

  it("refuses a binary file whose oldString matches after decoding, leaving bytes unchanged", async () => {
    const filePath = join(dir, "binary.bin")
    const original = Buffer.concat([Buffer.from([0x00, 0xff, 0xfe, 0x80]), Buffer.from("hello\n")])
    await writeFile(filePath, original)

    await expect(
      editTool.execute({ path: filePath, oldString: "hello", newString: "bye" }, testContext()),
    ).rejects.toThrow(/not valid UTF-8/)
    expect(Buffer.compare(await readFile(filePath), original)).toBe(0)
  })

  it("checks UTF-8 validity before matching oldString (gate precedes not-found)", async () => {
    const filePath = join(dir, "precedence.bin")
    const original = Buffer.from([0xff, 0xfe])
    await writeFile(filePath, original)

    // oldString is absent, but the UTF-8 failure must win because the
    // rewrite gate runs first.
    await expect(
      editTool.execute({ path: filePath, oldString: "absent", newString: "x" }, testContext()),
    ).rejects.toThrow(/not valid UTF-8/)
    expect(Buffer.compare(await readFile(filePath), original)).toBe(0)
  })

  it("edits a valid UTF-8 file without altering other multi-byte characters", async () => {
    const filePath = join(dir, "valid.txt")
    await writeFile(filePath, "héllo wörld 😀\n")

    const output = (await editTool.execute(
      { path: filePath, oldString: "wörld", newString: "world" },
      testContext(),
    )) as EditOutput

    expect(output.replacements).toBe(1)
    expect(await readFile(filePath, "utf-8")).toBe("héllo world 😀\n")
  })
})

describe("write tool — UTF-8 gate", () => {
  it("refuses to overwrite an existing non-UTF-8 file, leaving bytes unchanged", async () => {
    const filePath = join(dir, "existing.bin")
    const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("old\n")])
    await writeFile(filePath, original)

    await expect(
      writeTool.execute({ path: filePath, content: "new content\n" }, testContext()),
    ).rejects.toThrow(/not valid UTF-8/)
    expect(Buffer.compare(await readFile(filePath), original)).toBe(0)
  })

  it("creates a new file with multi-byte UTF-8 content (no gate needed)", async () => {
    const filePath = join(dir, "nested", "created.txt")
    const output = (await writeTool.execute(
      { path: filePath, content: "é € 😀\n" },
      testContext(),
    )) as WriteOutput

    expect(output.existed).toBe(false)
    expect(await readFile(filePath, "utf-8")).toBe("é € 😀\n")
  })

  it("overwrites an existing valid UTF-8 file normally", async () => {
    const filePath = join(dir, "valid.txt")
    await writeFile(filePath, "old é\n")

    const output = (await writeTool.execute(
      { path: filePath, content: "new € 😀\n" },
      testContext(),
    )) as WriteOutput

    expect(output.existed).toBe(true)
    expect(await readFile(filePath, "utf-8")).toBe("new € 😀\n")
  })
})
