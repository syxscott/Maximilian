// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Incremental streaming behavior: a StreamingMarkdown kept mounted across
 * append-only rerenders must show, at every step, exactly the DOM a fresh
 * mount of the same prefix shows, while reusing the frozen blocks' DOM nodes
 * instead of remounting.
 *
 * (borrowing) Ported from deepseek-harness `markdown-incremental.client.spec`.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, flush, renderUI } from "./helpers.js"
import { IncrementalMarkdownParser } from "../src/components/markdown-v2/incremental.js"
import { parseGfm } from "../src/components/markdown-v2/parse.js"
import { StreamingMarkdown } from "../src/components/markdown-v2/streaming-markdown.js"

afterEach(cleanup)

/**
 * A many-block document exercising every freeze-sensitive construct. The
 * prefix-equivalence property below holds only while no reference or footnote
 * definition lands on the far side of a freeze boundary from its use: a fresh
 * mount parses everything in one tree while the live stream's frozen blocks
 * are already baked (the self-heal test demonstrates the documented
 * deviation). Keep definitions adjacent to their references when extending
 * this corpus.
 */
const STREAM_DOC = [
  "# Title",
  "",
  "First paragraph with **strong** and `code`.",
  "",
  "- list item one",
  "- list item two",
  "",
  "  continuation of item two",
  "",
  "Setext heading",
  "===",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```ts",
  "const x = 1",
  "",
  "still inside the fence",
  "```",
  "",
  "> quote with lazy",
  "continuation line",
  "",
  "Uses a footnote[^n] twice[^n].",
  "",
  "[^n]: The footnote body.",
  "",
  "Closing paragraph after enough blocks to freeze everything above.",
  "",
  "One more tail block.",
].join("\n")

describe("incremental streaming rendering", () => {
  for (const chunkSize of [1, 3, 7, 16]) {
    // Byte-granular replays mount a fresh reference render per prefix; the
    // wall clock varies with host load, so the budget is generous.
    it(`matches a fresh render at every prefix (chunk=${chunkSize})`, { timeout: 30_000 }, () => {
      const live = renderUI(<StreamingMarkdown text="" settled={false} />)
      for (let end = chunkSize; end < STREAM_DOC.length + chunkSize; end += chunkSize) {
        const prefix = STREAM_DOC.slice(0, Math.min(end, STREAM_DOC.length))
        live.rerender(<StreamingMarkdown text={prefix} settled={false} />)
        const fresh = renderUI(<StreamingMarkdown text={prefix} settled={false} />)
        expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
        fresh.unmount()
      }
      live.unmount()
    })
  }

  it("keeps frozen block DOM nodes across freezes instead of remounting", () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i}.`)
    const first = `${paragraphs[0]}\n\n`
    const live = renderUI(<StreamingMarkdown text={first} settled={false} />)
    const firstBlock = live.container.querySelector("p")
    expect(firstBlock?.textContent).toBe(paragraphs[0])
    live.rerender(<StreamingMarkdown text={paragraphs.join("\n\n")} settled={false} />)
    // Same DOM node instance: the block kept its key across the freeze boundary.
    expect(live.container.querySelector("p")).toBe(firstBlock)
    expect(live.container.querySelectorAll("p")).toHaveLength(paragraphs.length)
    live.unmount()
  })

  it("recovers when the text diverges instead of appending", () => {
    const live = renderUI(
      <StreamingMarkdown text={"alpha\n\nbeta\n\ngamma\n\ndelta"} settled={false} />,
    )
    live.rerender(<StreamingMarkdown text={"totally\n\ndifferent\n\ndocument"} settled={false} />)
    const fresh = renderUI(
      <StreamingMarkdown text={"totally\n\ndifferent\n\ndocument"} settled={false} />,
    )
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
    live.unmount()
    fresh.unmount()
  })

  it("settles into the full math-enabled render after streaming", async () => {
    const doc = "Value $E = mc^2$ inline.\n\nSecond.\n\nThird.\n\nFourth."
    const live = renderUI(<StreamingMarkdown text={doc} settled={false} />)
    expect(live.container.querySelector(".katex")).toBeNull()
    live.rerender(<StreamingMarkdown text={doc} settled={true} />)
    // KaTeX loads asynchronously on the first settled formula; the lazy
    // component swaps the raw TeX in for the typeset formula when it lands.
    for (let i = 0; i < 50 && live.container.querySelector(".katex") === null; i++) {
      await flush()
    }
    const settled = renderUI(<StreamingMarkdown text={doc} settled={true} />)
    expect(live.container.innerHTML).toBe(settled.container.innerHTML)
    expect(live.container.querySelector(".katex")).not.toBeNull()
    live.unmount()
    settled.unmount()
  })

  it("self-heals a reference-style link once the document settles", () => {
    // The reference freezes before its definition arrives (the documented
    // prefix-freeze deviation), so the streaming DOM keeps the literal
    // bracket text; the settled full parse resolves it into an anchor.
    const fillers = Array.from({ length: 6 }, (_, i) => `Filler paragraph ${i}.`)
    const beforeDefinition = [
      ...fillers,
      "See [the docs][docs] for more.",
      "More prose follows.",
      "Even more prose.",
    ].join("\n\n")
    const full = `${beforeDefinition}\n\n[docs]: https://example.com/guide`
    const live = renderUI(<StreamingMarkdown text={beforeDefinition} settled={false} />)
    expect(live.container.querySelector("a")).toBeNull()
    // The reference is now frozen; the late definition cannot re-resolve it
    // while streaming.
    live.rerender(<StreamingMarkdown text={full} settled={false} />)
    expect(live.container.querySelector("a")).toBeNull()
    expect(live.container.textContent).toContain("[the docs][docs]")
    live.rerender(<StreamingMarkdown text={full} settled={true} />)
    const anchor = live.container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe("https://example.com/guide")
    expect(anchor?.textContent).toBe("the docs")
    expect(live.container.textContent).not.toContain("[docs]:")
    live.unmount()
  })
})

describe("IncrementalMarkdownParser", () => {
  it("freezes all but the trailing blocks and reports stable keys", () => {
    const parser = new IncrementalMarkdownParser(parseGfm)
    const first = parser.update("alpha\n\nbeta\n\ngamma\n\ndelta")
    expect(first.frozen).toHaveLength(2)
    expect(first.tail).toHaveLength(2)
    for (const block of first.frozen) expect(block.node.type).toBe("paragraph")
    const keys = first.frozen.map((block) => block.key)
    expect(keys[0]).toBeLessThan(keys[1] ?? 0)
    // The frozen prefix never re-parses: a later append reports the same
    // frozen keys in the same order.
    const grown = parser.update("alpha\n\nbeta\n\ngamma\n\ndelta\n\nepsilon")
    expect(grown.frozen.slice(0, keys.length).map((block) => block.key)).toEqual(keys)
    expect(grown.generation).toBe(first.generation)
  })

  it("bumps the generation on non-append input", () => {
    const parser = new IncrementalMarkdownParser(parseGfm)
    parser.update("alpha\n\nbeta\n\ngamma\n\ndelta")
    const reset = parser.update("totally\n\ndifferent")
    expect(reset.generation).toBe(1)
    expect(reset.frozen).toHaveLength(0)
  })

  it("is idempotent for identical input", () => {
    const parser = new IncrementalMarkdownParser(parseGfm)
    const first = parser.update("alpha\n\nbeta")
    expect(parser.update("alpha\n\nbeta")).toBe(first)
  })

  it("keeps an unclosed fence's completed lines out of per-chunk reparses", () => {
    const parser = new IncrementalMarkdownParser(parseGfm)
    const open = "```ts\nconst a = 1\n"
    const first = parser.update(open)
    // The unclosed fence cannot freeze; it stays the tail's only block.
    expect(first.frozen).toHaveLength(0)
    expect(first.tail).toHaveLength(1)
    expect(first.tail[0]?.node.type).toBe("code")
    const code = first.tail[0]?.node as { type: "code"; value?: string }
    expect(code.value).toBe("const a = 1")
    const grown = parser.update(`${open}const b = 2\n`)
    expect(grown.tail[0]?.node.type).toBe("code")
    expect((grown.tail[0]?.node as { value?: string }).value).toBe("const a = 1\nconst b = 2")
  })
})
