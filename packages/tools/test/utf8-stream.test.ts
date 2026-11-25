// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) OpenCode packages/core/test/shell-daemon.test.ts
// (commit d432a06b9c) — each output stream must keep multi-byte UTF-8
// characters intact when the process splits them across chunk boundaries.

import { describe, expect, it } from "vitest"
import { ExtensionBag, type ToolExecuteContext } from "@max/llm"
import { BackgroundShellRegistry } from "../src/bash-background.js"
import { bashTool, type BashOutput } from "../src/bash.js"
import { streamingBashTool } from "../src/bash-stream.js"
import { createUtf8StreamDecoder } from "../src/utf8-stream.js"

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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await sleep(20)
  }
}

/**
 * Build a shell command that writes the given byte chunks with a delay
 * between them, so a multi-byte character can straddle chunk boundaries.
 */
function emitInChunks(parts: readonly (readonly number[])[], gapMs = 60): string {
  const body = parts
    .map(
      (bytes, index) =>
        `${index === 0 ? "" : `await new Promise(r=>setTimeout(r,${gapMs}));`}` +
        `process.stdout.write(Buffer.from([${bytes.join(",")}]))`,
    )
    .join(";")
  return `${JSON.stringify(process.execPath)} -e '(async()=>{${body}})()'`
}

const SAMPLE_PARTS: readonly (readonly number[])[] = [
  [0x61], // a
  [0xc3],
  [0xa9], // é split across two chunks
  [0xe2],
  [0x82, 0xac], // € split across two chunks
  [0xf0, 0x9f],
  [0x98, 0x80], // 😀 split across two chunks
  [0x7a], // z
]
const SAMPLE_TEXT = "aé€😀z"

describe("createUtf8StreamDecoder", () => {
  const samples: ReadonlyArray<readonly [text: string, bytes: readonly number[]]> = [
    ["é", [0xc3, 0xa9]],
    ["€", [0xe2, 0x82, 0xac]],
    ["😀", [0xf0, 0x9f, 0x98, 0x80]],
  ]

  for (const [text, bytes] of samples) {
    it(`decodes ${text} delivered as one chunk`, () => {
      const decoder = createUtf8StreamDecoder()
      expect(decoder.push(Buffer.from(bytes))).toBe(text)
      expect(decoder.end()).toBe("")
    })

    it(`reassembles ${text} split at every byte boundary`, () => {
      for (let cut = 1; cut < bytes.length; cut++) {
        const decoder = createUtf8StreamDecoder()
        let out = decoder.push(Buffer.from(bytes.slice(0, cut)))
        out += decoder.push(Buffer.from(bytes.slice(cut)))
        expect(out).toBe(text)
        expect(decoder.end()).toBe("")
      }
    })
  }

  it("reassembles a mixed string whose characters straddle many chunk edges", () => {
    const bytes = Buffer.from(SAMPLE_TEXT, "utf-8")
    const cuts = [1, 2, 3, 4, 5, 6, 7]
    const decoder = createUtf8StreamDecoder()
    let out = ""
    let prev = 0
    for (const cut of cuts) {
      out += decoder.push(bytes.subarray(prev, cut))
      prev = cut
    }
    out += decoder.push(bytes.subarray(prev))
    expect(out).toBe(SAMPLE_TEXT)
    expect(decoder.end()).toBe("")
  })

  it("emits U+FFFD for an incomplete trailing sequence on end()", () => {
    const decoder = createUtf8StreamDecoder()
    expect(decoder.push(Buffer.from([0xc3]))).toBe("")
    expect(decoder.end()).toBe("\uFFFD")
  })
})

describe("bash tools — cross-chunk UTF-8 output", () => {
  it("foreground bash preserves multi-byte characters split across chunks", async () => {
    const output = (await bashTool.execute(
      { command: emitInChunks(SAMPLE_PARTS), timeout: 15_000 },
      testContext(),
    )) as BashOutput
    expect(output.output).toBe(SAMPLE_TEXT)
  })

  it("streaming bash preserves multi-byte characters split across chunks", async () => {
    let streamed = ""
    for await (const item of streamingBashTool.execute(
      { command: emitInChunks(SAMPLE_PARTS), timeout: 15_000 },
      testContext(),
    )) {
      if (item.type === "progress" && item.content.kind === "stdout") {
        streamed += item.content.data
      }
    }
    expect(streamed).toBe(SAMPLE_TEXT)
  })

  it("background registry line buffering preserves multi-byte characters split across chunks", async () => {
    const registry = new BackgroundShellRegistry()
    const started = registry.start(emitInChunks(SAMPLE_PARTS), process.cwd())
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await waitFor(() => registry.snapshot(started.bashId)?.status !== "running")
    const read = registry.read(started.bashId)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.lines).toEqual([SAMPLE_TEXT])
  })
})
