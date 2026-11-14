// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Fence-layer dispatch and math behavior: `math`/`mermaid` fences route to
 * their layers by language, a streaming math fence shows its source (never a
 * KaTeX error for an incomplete formula), and copying a selection inside the
 * document writes formulas back as TeX.
 *
 * (borrowing) Copy-tex and mermaid test mechanics adapted from deepseek-harness
 * `markdown-copy-tex.client.spec` and chat-demo's mermaid service contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, flush, renderUI } from "./helpers.js"
import { StreamingMarkdown } from "../src/components/markdown-v2/streaming-markdown.js"
import { TeXMath } from "../src/components/markdown-v2/katex-math.js"
import { ensureKatex } from "../src/components/markdown-v2/katex-lazy.js"
import { copyKatexAsTex } from "../src/components/markdown-v2/copy-tex.js"
import { renderMermaid } from "../src/lib/mermaid-render.js"
import type { FenceLayerProps } from "../src/components/markdown-v2/fence-layers.js"

vi.mock("../src/lib/mermaid-render.js", () => ({ renderMermaid: vi.fn() }))

afterEach(cleanup)

beforeEach(() => {
  vi.mocked(renderMermaid).mockReset()
})

// jsdom implements no layout or innerText, so textContent stands in for it
// here and the copy specs assert only the TeX fragments.
const nativeInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")
function stubInnerText(): void {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent
    },
  })
}
function restoreInnerText(): void {
  if (nativeInnerText === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, "innerText")
  } else {
    Object.defineProperty(HTMLElement.prototype, "innerText", nativeInnerText)
  }
}

describe("math rendering", () => {
  it("renders an incomplete formula as source, never a KaTeX error", async () => {
    await ensureKatex()
    const view = renderUI(<TeXMath tex={"\\frac{1}{"} />)
    expect(view.container.querySelector(".katex")).toBeNull()
    expect(view.container.querySelector(".katex-error")).toBeNull()
    expect(view.container.textContent).toContain("\\frac{1}{")
    view.unmount()
  })

  it("renders a complete formula through KaTeX", async () => {
    await ensureKatex()
    const view = renderUI(<TeXMath tex="E = mc^2" />)
    expect(view.container.querySelector(".katex-html")).not.toBeNull()
    expect(
      view.container.querySelector('annotation[encoding="application/x-tex"]')?.textContent,
    ).toBe("E = mc^2")
    view.unmount()
  })

  it("keeps the last successful formula when the source breaks mid-stream", async () => {
    await ensureKatex()
    const view = renderUI(<TeXMath tex="E = mc^2" />)
    expect(view.container.querySelector(".katex")).not.toBeNull()
    view.rerender(<TeXMath tex={"\\frac{1}{"} />)
    // The broken source keeps the previous success instead of flashing an error.
    expect(view.container.querySelector(".katex")).not.toBeNull()
    expect(view.container.querySelector(".katex-error")).toBeNull()
    view.rerender(<TeXMath tex={"\\frac{1}{2}"} />)
    expect(
      view.container.querySelector('annotation[encoding="application/x-tex"]')?.textContent,
    ).toContain("frac")
    expect(view.container.querySelector(".katex-error")).toBeNull()
    view.unmount()
  })
})

describe("fence layer dispatch", () => {
  it("shows a streaming math fence as source and renders it once settled", async () => {
    await ensureKatex()
    const view = renderUI(<StreamingMarkdown text={"```math\n\\frac{a}{b}\n"} settled={false} />)
    expect(view.container.querySelector(".katex")).toBeNull()
    // The fence body stays visible as code while streaming.
    expect(view.container.textContent).toContain("\\frac{a}{b}")
    view.rerender(<StreamingMarkdown text={"```math\n\\frac{a}{b}\n```"} settled={true} />)
    expect(view.container.querySelector(".katex-display")).not.toBeNull()
    expect(
      view.container.querySelector('annotation[encoding="application/x-tex"]')?.textContent,
    ).toContain("frac")
    view.unmount()
  })

  it("dispatches a fence language to a registered layer", () => {
    const layer = vi.fn((props: FenceLayerProps) => props.children)
    const view = renderUI(
      <StreamingMarkdown
        text={"```diagram\nhello\n```"}
        settled={false}
        fenceLayers={{ diagram: layer }}
      />,
    )
    expect(layer).toHaveBeenCalledTimes(1)
    expect(layer.mock.calls[0]?.[0].lang).toBe("diagram")
    expect(layer.mock.calls[0]?.[0].code).toBe("hello")
    expect(view.container.textContent).toContain("hello")
    view.unmount()
  })

  it("keeps a plain code block when no layer matches the language", () => {
    const view = renderUI(<StreamingMarkdown text={"```ts\nconst a = 1\n```"} settled={false} />)
    expect(view.container.querySelector("[data-component='code-block-v2']")).not.toBeNull()
    expect(view.container.textContent).toContain("const a = 1")
    view.unmount()
  })
})

describe("copy-tex", () => {
  function stubClipboardData(): { data: Map<string, string>; event: Event } {
    const data = new Map<string, string>()
    const event = new Event("copy", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, value: string) => data.set(type, value) },
    })
    return { data, event }
  }

  it("copies a selected formula as delimited TeX source", async () => {
    await ensureKatex()
    stubInnerText()
    try {
      const view = renderUI(
        <StreamingMarkdown text={"Energy $E=mc^2$ and more prose."} settled={true} />,
      )
      const root = view.container.querySelector(
        "[data-component='streaming-markdown']",
      ) as HTMLElement
      const visual = view.container.querySelector(".katex-html") as Element
      const paragraph = view.container.querySelector("p") as HTMLParagraphElement
      const range = document.createRange()
      range.setStart(paragraph.firstChild as Node, 0)
      range.setEnd(visual, 0)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const { data, event } = stubClipboardData()
      copyKatexAsTex(event as ClipboardEvent, root)
      expect(event.defaultPrevented).toBe(true)
      expect(data.get("text/plain")).toBe("Energy $E=mc^2$")
      expect(data.get("text/html")).not.toMatch(/katex-(?:html|mathml)/u)
      view.unmount()
    } finally {
      restoreInnerText()
      document.getSelection()?.removeAllRanges()
    }
  })
})

describe("mermaid fence layer", () => {
  async function mermaidView(text: string, settled: boolean) {
    const view = renderUI(<StreamingMarkdown text={text} settled={settled} />)
    await flush()
    return view
  }

  it("draws the last complete lines of a streaming fragment and never flashes errors", async () => {
    vi.mocked(renderMermaid).mockImplementation(async (code: string) => {
      if (code.includes("B[")) throw new Error("parse error")
      return `<svg data-diagram="${code.replace(/\W+/g, "-")}"></svg>`
    })
    // The fragment's full text fails to parse; the prefix before its last
    // line break ("flowchart TD") draws instead.
    const view = await mermaidView("```mermaid\nflowchart TD\nA[-->B[", false)
    await flush()
    expect(view.container.querySelector("[data-mermaid-status='failed']")).toBeNull()
    expect(view.container.querySelector("svg")?.getAttribute("data-diagram")).toBe("flowchart-TD")
    view.unmount()
  })

  it("retains the shown diagram when a later fragment only adds an invalid tail", async () => {
    const source = "flowchart TD\nA[-->B\nA-->C"
    vi.mocked(renderMermaid).mockImplementation(async (code: string) => {
      if (code.endsWith("A[")) throw new Error("parse error")
      return `<svg data-diagram="${code.replace(/\W+/g, "-")}"></svg>`
    })
    const complete = `\`\`\`mermaid\n${source}\n\`\`\``
    const view = await mermaidView(complete, false)
    await flush()
    expect(view.container.querySelector("svg")?.getAttribute("data-diagram")).toBe(
      source.replace(/\W+/g, "-"),
    )
    // Stream a fragment that only appends an invalid node after the shown
    // prefix: the prefix is already covered by the displayed diagram, so the
    // old diagram stays (the failing draw happens, the covered prefix draw is
    // skipped) and no error flashes.
    const invalidTail = `\`\`\`mermaid\n${source}\nA[`
    view.rerender(<StreamingMarkdown text={invalidTail} settled={false} />)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flush()
    expect(view.container.querySelector("svg")?.getAttribute("data-diagram")).toBe(
      source.replace(/\W+/g, "-"),
    )
    expect(vi.mocked(renderMermaid).mock.calls.map(([code]) => code)).toEqual([
      source,
      `${source}\nA[`,
    ])
    expect(view.container.querySelector("[data-mermaid-status='failed']")).toBeNull()
    view.unmount()
  })

  it("surfaces a render error only after the document settles", async () => {
    vi.mocked(renderMermaid).mockImplementation(async () => {
      throw new Error("always broken")
    })
    const view = await mermaidView("```mermaid\nflowchart TD\nA[\n```", false)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flush()
    expect(view.container.querySelector("[data-mermaid-status='failed']")).toBeNull()
    view.rerender(<StreamingMarkdown text={"```mermaid\nflowchart TD\nA[\n```"} settled={true} />)
    await flush()
    expect(view.container.querySelector("[data-mermaid-status='failed']")).not.toBeNull()
    view.unmount()
  })
})
