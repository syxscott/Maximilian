// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ai-elements domain tests: model-layer unit coverage (every widget's
 * coercion function) + render smoke tests for the key widgets. The
 * aiElements dictionaries are flattened and registered over the test
 * locale so smoke tests assert real localized strings — which also
 * validates the domain JSONs.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, registerLocale } from "@max/i18n"

import aiEn from "@/locales/ai-elements.en-US.json"
import aiZh from "@/locales/ai-elements.zh-CN.json"
import {
  AttachmentCard,
  CitationBlock,
  CodeBlock,
  DocumentPreviewBlock,
  ErrorBlock,
  ImagePreviewBlock,
  KeyValueCard,
  LatencyMeter,
  MarkdownProseBlock,
  ReasoningBlock,
  StatusPill,
  TokenUsageBadge,
  attachmentModel,
  canUseClipboard,
  citationModel,
  codeBlockModel,
  codeLineCount,
  codeShouldCollapse,
  documentPreviewModel,
  errorModel,
  escapeHtml,
  imageSrcModel,
  keyValueEntries,
  latencyBarPercent,
  latencyRating,
  markdownToSafeHtml,
  mimeToVariant,
  reasoningModel,
  statusVariant,
  tokenUsageModel,
  visibleCodeLines,
} from "@/components/ai-elements"

// Gate the clipboard model functions so the CodeBlock copy button's
// availability + write paths are deterministic in jsdom.
let clipboardEnabled = false
let copyTextMock: (text: string) => Promise<void> = async () => {}
vi.mock("@/components/ai-elements/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ai-elements/model")>()),
  canUseClipboard: () => clipboardEnabled,
  copyText: (text: string) => copyTextMock(text),
}))

/** Flatten a nested domain dictionary into the dotted keys t() looks up. */
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  if (obj === null || typeof obj !== "object") return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === "object") Object.assign(out, flatten(v, key))
    else out[key] = String(v)
  }
  return out
}

beforeAll(() => {
  const en = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...en, ...flatten(aiEn) })
  const zh = getDictionary("zh-CN") ?? {}
  registerLocale("zh-CN", { ...zh, ...flatten(aiZh) })
})

afterEach(() => {
  cleanup()
  clipboardEnabled = false
  copyTextMock = async () => {}
})

// ── i18n dictionaries ───────────────────────────────────────────────────────

describe("aiElements dictionaries", () => {
  it("have identical key trees in zh-CN and en-US", () => {
    expect(Object.keys(flatten(aiZh)).sort()).toEqual(Object.keys(flatten(aiEn)).sort())
  })

  it("registers the flattened keys so t() resolves real strings", () => {
    expect(getDictionary("en-US")?.["aiElements.status.running"]).toBe("Running")
  })
})

// ── Model layer ─────────────────────────────────────────────────────────────

describe("markdownToSafeHtml / escapeHtml", () => {
  it("escapes raw HTML before anything else", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    )
  })

  it("renders headings with a level offset (h1 reserved by the app shell)", () => {
    expect(markdownToSafeHtml("# Title")).toContain("<h3>Title</h3>")
    expect(markdownToSafeHtml("## Sub")).toContain("<h4>Sub</h4>")
    expect(markdownToSafeHtml("###### Deep")).toContain("<h6>Deep</h6>")
  })

  it("groups consecutive list items into ul / ol and closes them", () => {
    const html = markdownToSafeHtml("- a\n- b\n1. one\n2. two\ntail")
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>")
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>")
    expect(html.endsWith("<p>tail</p>")).toBe(true)
  })

  it("supports bold and code spans", () => {
    const html = markdownToSafeHtml("**bold** and `code`")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<code>code</code>")
  })

  it("is XSS-safe: script / onerror never survive as markup", () => {
    const html = markdownToSafeHtml('<script>alert(1)</script>\n<img src=x onerror="alert(2)">')
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;script&gt;")
  })

  it("returns empty for non-string / blank input", () => {
    expect(markdownToSafeHtml(undefined)).toBe("")
    expect(markdownToSafeHtml(42)).toBe("")
    expect(markdownToSafeHtml("  \n  ")).toBe("")
  })
})

describe("codeBlock model", () => {
  it("coerces strings and {code, language} objects defensively", () => {
    expect(codeBlockModel("const x = 1")).toEqual({ code: "const x = 1" })
    expect(codeBlockModel({ code: "y", language: "ts" })).toEqual({ code: "y", language: "ts" })
    expect(codeBlockModel({ content: "z", lang: "py" })).toEqual({ code: "z", language: "py" })
    expect(codeBlockModel(null)).toEqual({ code: "" })
    expect(codeBlockModel({ code: 42 }).code).toBe("")
  })

  it("counts lines and applies the collapse threshold", () => {
    expect(codeLineCount("")).toBe(1)
    expect(codeLineCount("a\nb")).toBe(2)
    const code24 = Array.from({ length: 24 }, () => "x").join("\n")
    const code25 = code24 + "\ny"
    expect(codeShouldCollapse(code24)).toBe(false)
    expect(codeShouldCollapse(code25)).toBe(true)
    expect(codeShouldCollapse(code25, 30)).toBe(false)
  })

  it("truncates to the head lines and reports the hidden count", () => {
    const code = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n")
    const v = visibleCodeLines(code, 24)
    expect(v.text.split("\n")).toHaveLength(24)
    expect(v.text.startsWith("line-0\n")).toBe(true)
    expect(v.hiddenCount).toBe(6)
    expect(visibleCodeLines("short", 24)).toEqual({ text: "short", hiddenCount: 0 })
  })
})

describe("reasoningModel", () => {
  it("accepts a bare string", () => {
    expect(reasoningModel("thinking")).toEqual({
      text: "thinking",
      chars: 8,
      durationMs: undefined,
    })
  })

  it("reads text + duration aliases from objects", () => {
    expect(reasoningModel({ text: "abc", durationMs: 1500 })).toEqual({
      text: "abc",
      chars: 3,
      durationMs: 1500,
    })
    expect(reasoningModel({ thinking: "xy", elapsedMs: 2000 }).text).toBe("xy")
    expect(reasoningModel({ content: "z", duration: 3000 }).durationMs).toBe(3000)
  })

  it("counts non-whitespace characters (CJK-friendly 字数)", () => {
    expect(reasoningModel("考虑 一下").chars).toBe(4)
  })

  it("degrades garbage input to an empty model", () => {
    expect(reasoningModel(7)).toEqual({ text: "", chars: 0, durationMs: undefined })
  })
})

describe("attachmentModel / mimeToVariant", () => {
  it("maps mime types to display variants", () => {
    expect(mimeToVariant("image/png")).toBe("image")
    expect(mimeToVariant("audio/mpeg")).toBe("audio")
    expect(mimeToVariant("video/mp4")).toBe("video")
    expect(mimeToVariant("application/pdf")).toBe("pdf")
    expect(mimeToVariant("application/json")).toBe("json")
    expect(mimeToVariant("text/javascript")).toBe("code")
    expect(mimeToVariant("application/zip")).toBe("archive")
    expect(mimeToVariant("text/csv")).toBe("spreadsheet")
    expect(mimeToVariant("text/plain")).toBe("text")
    expect(mimeToVariant("application/octet-stream")).toBe("file")
  })

  it("falls back to the file extension when mime is missing", () => {
    expect(mimeToVariant(undefined, "shot.PNG")).toBe("image")
    expect(mimeToVariant(undefined, "archive.tar.gz")).toBe("archive")
    expect(mimeToVariant(undefined, "main.py")).toBe("code")
    expect(mimeToVariant(undefined, "data.csv")).toBe("spreadsheet")
    expect(mimeToVariant(undefined, "notes.md")).toBe("text")
    expect(mimeToVariant(undefined, "blob.bin")).toBe("file")
  })

  it("extracts name (basename only), size and mime from passthrough shapes", () => {
    expect(attachmentModel("/tmp/report final.pdf")).toMatchObject({
      name: "report final.pdf",
      variant: "pdf",
    })
    expect(attachmentModel({ filename: "a.png", size: 2048 })).toMatchObject({
      name: "a.png",
      sizeBytes: 2048,
      variant: "image",
    })
    expect(attachmentModel({ name: "b", sizeBytes: 10, mimeType: "video/webm" })).toMatchObject({
      name: "b",
      mime: "video/webm",
      variant: "video",
    })
    expect(attachmentModel(null).name).toBe("file")
    expect(attachmentModel({ path: "C:\\dir\\f.txt" }).name).toBe("f.txt")
  })
})

describe("citationModel", () => {
  it("normalizes ordinal + title + url", () => {
    expect(citationModel({ index: 3, title: "Docs", url: "https://x.dev/a" })).toEqual({
      index: 3,
      title: "Docs",
      url: "https://x.dev/a",
    })
  })

  it("drops non-http(s) urls so they cannot become link targets", () => {
    expect(citationModel({ index: 1, title: "t", url: "javascript:alert(1)" }).url).toBeUndefined()
    expect(citationModel({ n: 2, source: "s", href: "ftp://f" }).title).toBe("s")
  })

  it("degrades garbage to a zero-index untitled citation", () => {
    expect(citationModel("junk")).toEqual({ index: 0, title: "", url: undefined })
    expect(citationModel({ index: "7", title: "ok" }).index).toBe(7)
  })
})

describe("statusVariant", () => {
  it("canonicalizes aliases case-insensitively", () => {
    expect(statusVariant("in_progress")).toBe("running")
    expect(statusVariant("Done")).toBe("completed")
    expect(statusVariant("SUCCESS")).toBe("completed")
    expect(statusVariant("error")).toBe("failed")
    expect(statusVariant("cancelled")).toBe("skipped")
    expect(statusVariant("queued")).toBe("pending")
  })

  it("defaults unknown / missing statuses to pending", () => {
    expect(statusVariant("warp-speed")).toBe("pending")
    expect(statusVariant(undefined)).toBe("pending")
    expect(statusVariant(42)).toBe("pending")
  })
})

describe("tokenUsageModel", () => {
  it("reads the input/output/cache triple with aliases", () => {
    expect(tokenUsageModel({ input: 100, output: 50, cacheRead: 25 })).toEqual({
      input: 100,
      output: 50,
      cacheRead: 25,
      total: 175,
      known: true,
    })
    expect(tokenUsageModel({ promptTokens: "10", completionTokens: 5 }).total).toBe(15)
    expect(tokenUsageModel({ totalTokens: 999 }).known).toBe(true)
    expect(tokenUsageModel({ totalTokens: 999 }).total).toBe(999)
  })

  it("flags fully-unknown usage so the badge can degrade", () => {
    const m = tokenUsageModel({ hello: "world" })
    expect(m.known).toBe(false)
    expect(tokenUsageModel(null).known).toBe(false)
  })
})

describe("latencyRating / latencyBarPercent", () => {
  it("rates <1s green, <5s yellow, beyond red", () => {
    expect(latencyRating(999)).toBe("fast")
    expect(latencyRating(1000)).toBe("moderate")
    expect(latencyRating(4999)).toBe("moderate")
    expect(latencyRating(5000)).toBe("slow")
    expect(latencyRating(Number.NaN)).toBe("fast")
  })

  it("scales the bar on a 0–10s axis, capped at 100%", () => {
    expect(latencyBarPercent(0)).toBe(0)
    expect(latencyBarPercent(1000)).toBe(10)
    expect(latencyBarPercent(10000)).toBe(100)
    expect(latencyBarPercent(120000)).toBe(100)
    expect(latencyBarPercent(-5)).toBe(0)
  })
})

describe("errorModel / imageSrcModel / keyValueEntries / documentPreviewModel", () => {
  it("normalizes Error instances, objects and strings", () => {
    const e = new Error("boom")
    e.name = "TypeError"
    expect(errorModel(e)).toMatchObject({ name: "TypeError", message: "boom" })
    expect(errorModel({ message: "m", stack: "s" })).toEqual({
      name: undefined,
      message: "m",
      stack: "s",
    })
    expect(errorModel("plain").message).toBe("plain")
    expect(errorModel({ error: "wrapped" }).message).toBe("wrapped")
    expect(errorModel(1).message).toBe("")
  })

  it("accepts only data:image and http(s) image sources", () => {
    expect(imageSrcModel("data:image/png;base64,AAAA")).toEqual({
      src: "data:image/png;base64,AAAA",
      isDataUrl: true,
    })
    expect(imageSrcModel({ url: "http://x/y.png" }).src).toBe("http://x/y.png")
    expect(imageSrcModel("https://x/y.png").isDataUrl).toBe(false)
    expect(imageSrcModel("javascript:alert(1)").src).toBeUndefined()
    expect(imageSrcModel({ src: 42 }).src).toBeUndefined()
  })

  it("flattens metadata objects into string entries", () => {
    expect(keyValueEntries({ a: "x", b: 2, c: true, d: null, e: undefined })).toEqual([
      { key: "a", value: "x" },
      { key: "b", value: "2" },
      { key: "c", value: "true" },
      { key: "d", value: "null" },
    ])
    expect(keyValueEntries({ nested: { deep: [1, 2] } })).toEqual([
      { key: "nested", value: '{"deep":[1,2]}' },
    ])
    expect(keyValueEntries("scalar")).toEqual([])
    expect(
      keyValueEntries([
        { key: "k", value: "v" },
        { key: "n", value: 3 },
      ]),
    ).toEqual([
      { key: "k", value: "v" },
      { key: "n", value: "3" },
    ])
  })

  it("line-truncates documents and reports hidden lines", () => {
    const doc = Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n")
    const m = documentPreviewModel(doc, 40)
    expect(m.truncated).toBe(true)
    expect(m.hiddenLines).toBe(10)
    expect(m.text.split("\n")).toHaveLength(40)
    expect(documentPreviewModel("short", 40)).toEqual({
      text: "short",
      totalLines: 1,
      hiddenLines: 0,
      truncated: false,
    })
    expect(documentPreviewModel(null).totalLines).toBe(0)
  })
})

// ── Component smoke ─────────────────────────────────────────────────────────

describe("CodeBlock (smoke)", () => {
  it("renders the language label and code body", () => {
    render(<CodeBlock code={"const a = 1"} language="ts" />)
    expect(screen.getByText("ts")).toBeInTheDocument()
    expect(screen.getByText("const a = 1")).toBeInTheDocument()
  })

  it("hides the copy button when the clipboard API is unavailable", () => {
    clipboardEnabled = false
    render(<CodeBlock code="x" />)
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument()
  })

  it("copies the code through the clipboard and confirms", async () => {
    clipboardEnabled = true
    const writeText = vi.fn().mockResolvedValue(undefined)
    copyTextMock = writeText
    const user = userEvent.setup()
    render(<CodeBlock code="copy-me" />)
    await user.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("copy-me")
    expect(await screen.findByText("Copied")).toBeInTheDocument()
  })

  it("collapses >24-line code behind an expander", async () => {
    const user = userEvent.setup()
    const code = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n")
    render(<CodeBlock code={code} />)
    expect(screen.queryByText("line-29")).not.toBeInTheDocument()
    await user.click(screen.getByText("Show 6 more lines"))
    expect(screen.getByText("line-29")).toBeInTheDocument()
  })

  it("renders optional line numbers", () => {
    render(<CodeBlock code={"a\nb"} showLineNumbers />)
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})

describe("StatusPill / TokenUsageBadge / LatencyMeter (smoke)", () => {
  it("maps an alias status to the localized variant label", () => {
    render(<StatusPill status="in_progress" />)
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("falls back to the pending label for unknown statuses", () => {
    render(<StatusPill status="warp-speed" />)
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })

  it("shows the compact token total via formatTokens", () => {
    render(<TokenUsageBadge usage={{ input: 12000, output: 340, cacheRead: 0 }} />)
    expect(screen.getByText("12.3K")).toBeInTheDocument()
  })

  it("degrades unknown usage to a muted placeholder", () => {
    render(<TokenUsageBadge usage={{ nope: true }} />)
    expect(screen.getByText("token usage unknown")).toBeInTheDocument()
  })

  it("renders the latency bar with rating styling", () => {
    const { container } = render(<LatencyMeter ms={8000} />)
    expect(container.querySelector("[role='meter']")).toBeInTheDocument()
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
  })
})

describe("AttachmentCard / ReasoningBlock (smoke)", () => {
  it("renders name, size and fires onRemove", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<AttachmentCard attachment={{ name: "spec.pdf", size: 2048 }} onRemove={onRemove} />)
    expect(screen.getByText("spec.pdf")).toBeInTheDocument()
    expect(screen.getByText("2 KB")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("omits the remove button without an onRemove callback", () => {
    render(<AttachmentCard attachment={{ name: "a.txt" }} />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows the reasoning summary with duration and char count", () => {
    render(<ReasoningBlock input={{ text: "weigh options", durationMs: 65000 }} />)
    expect(screen.getByText("Reasoning")).toBeInTheDocument()
    expect(screen.getByText("1m 5s · 12 chars")).toBeInTheDocument()
  })

  it("renders nothing when there is no reasoning text", () => {
    const { container } = render(<ReasoningBlock input={{ durationMs: 5 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("MarkdownProseBlock / CitationBlock / ErrorBlock (smoke)", () => {
  it("renders markdown as safe HTML (no script elements)", () => {
    const { container } = render(
      <MarkdownProseBlock text={"# Plan\n\n**bold** step `one`\n\n<script>x</script>"} />,
    )
    expect(container.querySelector("h3")).toHaveTextContent("Plan")
    expect(container.querySelector("strong")).toHaveTextContent("bold")
    expect(container.querySelector("code")).toHaveTextContent("one")
    expect(container.querySelector("script")).toBeNull()
  })

  it("shows the empty state for blank markdown", () => {
    render(<MarkdownProseBlock text="" />)
    expect(screen.getByText("(no content)")).toBeInTheDocument()
  })

  it("links citations with rel=noopener noreferrer", () => {
    render(<CitationBlock citation={{ index: 2, title: "RFC 9110", url: "https://rfc.dev" }} />)
    const link = screen.getByText("RFC 9110")
    expect(link).toHaveAttribute("href", "https://rfc.dev")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveAttribute("target", "_blank")
    expect(screen.getByText("[2]")).toBeInTheDocument()
  })

  it("renders error name+message and keeps the stack collapsed", () => {
    render(<ErrorBlock error={{ name: "TimeoutError", message: "gave up", stack: "at f()" }} />)
    expect(screen.getByRole("alert")).toHaveTextContent("TimeoutError: gave up")
    expect(screen.getByText("Show stack trace")).toBeInTheDocument()
  })
})

describe("KeyValueCard / DocumentPreviewBlock / ImagePreviewBlock (smoke)", () => {
  it("renders metadata rows and an empty state", () => {
    const { container, rerender } = render(<KeyValueCard data={{ model: "glm", temp: 0.2 }} />)
    expect(container.querySelector("dl")).toBeInTheDocument()
    rerender(<KeyValueCard data={{}} />)
    expect(screen.getByText("No metadata")).toBeInTheDocument()
  })

  it("truncates long documents behind an expander", async () => {
    const user = userEvent.setup()
    const doc = Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n")
    render(<DocumentPreviewBlock text={doc} visibleLines={40} />)
    // Collapsed: the <pre> holds a single text node with lines L0..L39.
    expect(screen.queryByText(/L49/)).not.toBeInTheDocument()
    await user.click(screen.getByText("Show 10 more lines"))
    expect(screen.getByText(/L49/)).toBeInTheDocument()
  })

  it("falls back to the unavailable state for bad image input", () => {
    render(<ImagePreviewBlock image="javascript:alert(1)" />)
    expect(screen.getByText("Image preview unavailable")).toBeInTheDocument()
  })

  it("renders valid image sources inside a details preview", () => {
    render(<ImagePreviewBlock image="data:image/png;base64,AAAA" alt="pic" />)
    // Thumbnail in the <summary> + full-size image behind it.
    expect(screen.getAllByAltText("pic")).toHaveLength(2)
  })
})

describe("ai-elements barrel", () => {
  it("exposes the clipboard guard through the public surface", () => {
    expect(typeof canUseClipboard).toBe("function")
  })
})
