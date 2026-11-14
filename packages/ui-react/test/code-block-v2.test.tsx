// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CodeBlock v2: the streaming fence arm equals the settled shiki-HTML arm at
 * every appended prefix while keeping completed lines' DOM nodes untouched,
 * and a diff fence renders unified rows whose bodies tokenize per file side.
 *
 * (borrowing) Parity mechanics ported from deepseek-harness
 * `streaming-code-block.client.spec`.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, click, flush, renderUI } from "./helpers.js"
import { CodeBlockV2 } from "../src/components/code-block-v2.js"
import { StreamingHighlightSession, highlightToHtml } from "../src/lib/syntax-highlighter.js"
import { parseDiffFence, diffFenceTokens, isDiffFenceLanguage } from "../src/lib/diff-fence.js"

afterEach(cleanup)

/** One arm's token tree with every style channel the settled HTML arm emits. */
function readPre(root: HTMLElement) {
  const pre = root.querySelector("pre.shiki")
  expect(pre).not.toBeNull()
  return {
    classes: [...(pre as Element).classList].sort().join(" "),
    tabIndex: pre?.getAttribute("tabindex"),
    text: pre?.textContent,
    lines: [...(pre?.querySelectorAll(".line") ?? [])].map((line) =>
      [...line.querySelectorAll("span[style]")].map((span) => {
        const style = (span as HTMLElement).style
        return `${span.textContent ?? ""}|${style.color}|${style.fontStyle}|${style.fontWeight}|${style.textDecoration}`
      }),
    ),
  }
}

describe("StreamingHighlightSession", () => {
  it("reconstructs the code verbatim and colors tokens through --syntax-* properties", () => {
    const code = "const a = 1\n// note\nconst b = 'x'"
    const lines = new StreamingHighlightSession().update(code, "ts")
    expect(lines?.map((line) => line.map((span) => span.text).join("")).join("\n")).toBe(code)
    expect(lines?.[0]?.[0]?.style.color).toBe("var(--syntax-keyword)")
    expect(lines?.[1]?.[0]?.style.color).toBe("var(--syntax-comment)")
  })

  it("incremental growth equals a fresh from-scratch tokenization at every prefix", () => {
    // The template literal spans lines, so mid-stream states leave the
    // grammar inside a multi-line construct — the case where a stale saved
    // state would color the continuation wrong.
    const code = "const s = `template\nline ${x} mid\n` // done\nconst t: number = 42"
    const session = new StreamingHighlightSession()
    for (let end = 1; end <= code.length; end++) {
      const slice = code.slice(0, end)
      expect(session.update(slice, "ts")).toEqual(
        new StreamingHighlightSession().update(slice, "ts"),
      )
    }
  })

  it("keeps completed lines' span arrays identical across growth and re-tokenizes only the tail", () => {
    const session = new StreamingHighlightSession()
    const first = session.update("const a = 1\nlet", "ts")
    expect(first).toBeDefined()
    const second = session.update("const a = 1\nlet b = 2", "ts")
    expect(second?.[0]).toBe(first?.[0])
    expect(second?.[1]).not.toBe(first?.[1])
  })

  it("reports only newly completed lines to a retained renderer", () => {
    const session = new StreamingHighlightSession()
    const first = session.updateFrame("const a = 1\nlet", "ts")
    const second = session.updateFrame("const a = 1\nlet b = 2\n// tail", "ts")
    expect(first?.appended).toHaveLength(1)
    expect(first?.tail).toHaveLength(1)
    expect(second?.appended).toHaveLength(1)
    expect(second?.appended[0]?.map((span) => span.text).join("")).toBe("let b = 2")
    expect(second?.tail[0]?.map((span) => span.text).join("")).toBe("// tail")
    expect(second?.generation).toBe(first?.generation)
    expect(session.updateFrame("const a = 1\nlet b = 2\n// tail", "ts")).toBe(second)
  })

  it("returns undefined for an unknown language", () => {
    expect(new StreamingHighlightSession().update("x", "definitely-not-a-lang")).toBeUndefined()
    expect(highlightToHtml("x", "definitely-not-a-lang")).toBeUndefined()
  })
})

describe("CodeBlockV2 arms", () => {
  const CODE =
    "const answer = 42\n// trailing comment\nfunction greet(name: string) {\n  return `hi ${name}`\n}"

  it("renders the same token tree while streaming as the settled HTML swap", () => {
    const view = renderUI(<CodeBlockV2 code={CODE} lang="ts" streaming />)
    const streamed = readPre(view.container)
    view.rerender(<CodeBlockV2 code={CODE} lang="ts" />)
    const settled = readPre(view.container)
    expect(streamed.classes).toBe(settled.classes)
    expect(streamed.tabIndex).toBe(settled.tabIndex)
    expect(streamed.text).toBe(CODE)
    expect(streamed.lines).toEqual(settled.lines)
    view.unmount()
  })

  it("keeps completed line groups' DOM untouched while the fence grows", () => {
    const view = renderUI(<CodeBlockV2 code={"const a = 1\n// tail"} lang="ts" streaming />)
    const pre = view.container.querySelector("pre.shiki") as HTMLPreElement
    const code = pre.querySelector("code") as HTMLElement
    const firstText = code.childNodes[0]
    view.rerender(<CodeBlockV2 code={"const a = 1\nlet b = 2\n// tail"} lang="ts" streaming />)
    // The first completed line's fragment (child of the grouped code element)
    // is the same node instance across growth.
    expect(code.childNodes[0]).toBe(firstText)
    expect(pre.textContent).toBe("const a = 1\nlet b = 2\n// tail")
    view.unmount()
  })

  it("falls back to plain text for an unknown language and still preserves geometry", () => {
    const view = renderUI(<CodeBlockV2 code={"just text\nsecond line"} lang="mystic" />)
    expect(view.container.querySelector("pre.shiki")).toBeNull()
    expect(view.container.textContent).toContain("just text")
    view.unmount()
  })

  it("renders line numbers without adding them to copied source", () => {
    const view = renderUI(<CodeBlockV2 code={"a\nb\nc"} lang="text" lineNumbers />)
    expect(view.container.querySelector("pre")?.textContent).toBe("a\nb\nc")
    const gutter = [...view.container.querySelectorAll("div")].find(
      (el) => el.textContent === "123",
    )
    expect(gutter).toBeDefined()
    view.unmount()
  })

  it("copies the visible source through the header button", async () => {
    const written: string[] = []
    const original = navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text)
        },
      },
    })
    try {
      const view = renderUI(<CodeBlockV2 code={"copy me"} lang="ts" />)
      const button = [...view.container.querySelectorAll("button")].find((el) =>
        /copy/i.test(el.textContent ?? ""),
      )
      expect(button).toBeDefined()
      click(button as HTMLButtonElement)
      await flush()
      expect(written).toEqual(["copy me"])
      expect(
        [...view.container.querySelectorAll("button")].some((el) =>
          /copied/i.test(el.textContent ?? ""),
        ),
      ).toBe(true)
      view.unmount()
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: original })
    }
  })
})

describe("diff fences", () => {
  const DIFF = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 83db48f..bf269f4 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,3 @@",
    " const keep = 1",
    "-const old = 2",
    "+const neu = 2",
    " const tail = 3",
  ].join("\n")

  it("detects diff fence languages", () => {
    expect(isDiffFenceLanguage("diff")).toBe(true)
    expect(isDiffFenceLanguage("PATCH")).toBe(true)
    expect(isDiffFenceLanguage("ts")).toBe(false)
    expect(isDiffFenceLanguage(undefined)).toBe(false)
  })

  it("parses rows without losing a byte and resolves header languages", () => {
    const fence = parseDiffFence(DIFF)
    expect(fence.rows.map((row) => row.raw).join("\n")).toBe(DIFF)
    expect(fence.languages.get(0)).toBe("typescript")
    expect(fence.rows.filter((row) => row.kind === "add").map((row) => row.body)).toEqual([
      "const neu = 2",
    ])
    expect(fence.rows.filter((row) => row.kind === "del").map((row) => row.body)).toEqual([
      "const old = 2",
    ])
  })

  it("tokenizes the old and new sides with the header language", () => {
    const fence = parseDiffFence(DIFF)
    const tokens = diffFenceTokens(fence)
    expect(tokens).toBeDefined()
    const addRow = fence.rows.findIndex((row) => row.kind === "add")
    const delRow = fence.rows.findIndex((row) => row.kind === "del")
    expect(
      tokens
        ?.get(addRow)
        ?.map((span) => span.text)
        .join(""),
    ).toBe("const neu = 2")
    expect(
      tokens
        ?.get(delRow)
        ?.map((span) => span.text)
        .join(""),
    ).toBe("const old = 2")
    // Colors resolve through the shared custom-property vocabulary.
    expect(tokens?.get(addRow)?.[0]?.style.color).toMatch(/^var\(--syntax-/)
  })

  it("renders diff rows with marker columns and token colors in the block", () => {
    const view = renderUI(<CodeBlockV2 code={DIFF} lang="diff" />)
    expect(view.container.querySelector("[data-lang='diff']")).not.toBeNull()
    expect(view.container.textContent).toContain("diff --git a/src/app.ts b/src/app.ts")
    expect(view.container.textContent).toContain("+const neu = 2")
    view.unmount()
  })
})
