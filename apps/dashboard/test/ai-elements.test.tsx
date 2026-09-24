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
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, registerLocale } from "@max/i18n"

import aiEn from "@/locales/ai-elements.en-US.json"
import aiZh from "@/locales/ai-elements.zh-CN.json"
import {
  AlertBanner,
  AttachmentCard,
  BarMini,
  CitationBlock,
  CodeBlock,
  Collapse,
  CommandBlock,
  CopyField,
  CountUp,
  DeltaBadge,
  DiffStat,
  DocumentPreviewBlock,
  DonutStat,
  EmptyHint,
  ErrorBlock,
  FileChangeCard,
  GaugeArc,
  HeatRow,
  ImagePreviewBlock,
  JsonPeek,
  KeyValueCard,
  LatencyMeter,
  LinkPreviewCard,
  MarkdownProseBlock,
  PlanStepList,
  ProgressBlock,
  QuoteBlock,
  ReasoningBlock,
  SkeletonBlock,
  Sparkline,
  StatCard,
  StatusPill,
  TableBlock,
  TerminalOutputBlock,
  TimelineMini,
  TodoListBlock,
  ToolResultBlock,
  TokenUsageBadge,
  WebSearchBlock,
  alertVariant,
  attachmentModel,
  barMiniModel,
  canUseClipboard,
  citationModel,
  codeBlockModel,
  codeLineCount,
  codeShouldCollapse,
  collapseModel,
  commandBlockModel,
  copyFieldModel,
  countUpValue,
  deltaBadgeModel,
  diffStatFromUnified,
  documentPreviewModel,
  donutModel,
  easeOutCubic,
  emptyHintModel,
  errorModel,
  escapeHtml,
  fileChangeModel,
  gaugeArcModel,
  heatRowModel,
  imageSrcModel,
  jsonPeekModel,
  keyValueEntries,
  latencyBarPercent,
  latencyRating,
  linkPreviewModel,
  markdownToSafeHtml,
  mimeToVariant,
  planStepListModel,
  prefersReducedMotion,
  progressModel,
  quoteModel,
  reasoningModel,
  skeletonModel,
  sparklineModel,
  statCardModel,
  statusVariant,
  stripAnsi,
  tableBlockModel,
  terminalLinesModel,
  timelineMiniModel,
  todoListModel,
  toolResultModel,
  tokenUsageModel,
  visibleCodeLines,
  webSearchModel,
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

// ── Batch-2 model layer ─────────────────────────────────────────────────────

describe("toolResultModel", () => {
  it("accepts a bare string output", () => {
    expect(toolResultModel("plain output")).toEqual({
      tool: "",
      ok: true,
      status: "completed",
      durationMs: undefined,
      content: "plain output",
    })
  })

  it("reads the full shape with aliases", () => {
    expect(toolResultModel({ tool: "bash", ok: true, durationMs: 1200, content: "hi" })).toEqual({
      tool: "bash",
      ok: true,
      status: "completed",
      durationMs: 1200,
      content: "hi",
    })
    expect(toolResultModel({ name: "grep", output: "matches", elapsedMs: 5 }).content).toBe(
      "matches",
    )
  })

  it("derives failure from ok=false, an error field or a failed status", () => {
    expect(toolResultModel({ ok: false }).status).toBe("failed")
    expect(toolResultModel({ error: "boom" })).toMatchObject({ ok: false, content: "boom" })
    expect(toolResultModel({ status: "error" })).toMatchObject({ ok: false, status: "failed" })
    expect(toolResultModel({ status: "running" })).toMatchObject({ ok: true, status: "running" })
  })
})

describe("planStepListModel", () => {
  it("resolves dependency chains into indent depths", () => {
    const plan = {
      steps: [
        { id: "a", title: "Read", status: "completed" },
        { id: "b", title: "Edit", status: "in_progress", dependsOn: ["a"] },
        { id: "c", title: "Test", dependsOn: "b" },
      ],
    }
    expect(planStepListModel(plan)).toEqual([
      { title: "Read", status: "completed", depth: 0 },
      { title: "Edit", status: "running", depth: 1 },
      { title: "Test", status: "pending", depth: 2 },
    ])
  })

  it("degrades cycles to finite depths instead of hanging", () => {
    const cyc = {
      steps: [
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["a"] },
      ],
    }
    expect(planStepListModel(cyc).map((s) => s.depth)).toEqual([1, 0])
  })

  it("degrades garbage to an empty list and fills missing titles", () => {
    expect(planStepListModel(42)).toEqual([])
    expect(planStepListModel({ steps: [null] })).toEqual([
      { title: "#1", status: "pending", depth: 0 },
    ])
  })
})

describe("todoListModel", () => {
  it("reads done flags and normalizes priorities", () => {
    expect(
      todoListModel([
        { text: "a", done: true, priority: "P1" },
        { content: "b", status: "done" },
        { title: "c", priority: 3 },
        "d",
      ]),
    ).toEqual([
      { text: "a", completed: true, priority: "high" },
      { text: "b", completed: true, priority: "medium" },
      { text: "c", completed: false, priority: "low" },
      { text: "d", completed: false, priority: "medium" },
    ])
  })

  it("reads the todos/items keys and degrades garbage to empty", () => {
    expect(todoListModel({ todos: [{ text: "x", checked: true }] })).toEqual([
      { text: "x", completed: true, priority: "medium" },
    ])
    expect(todoListModel({ items: [] })).toEqual([])
    expect(todoListModel(null)).toEqual([])
  })
})

describe("fileChangeModel", () => {
  it("computes +/- stats from an edit pair via affix trimming", () => {
    expect(
      fileChangeModel({ path: "src/a.ts", oldString: "x\ny\nz", newString: "x\nY\nz" }),
    ).toMatchObject({ path: "src/a.ts", kind: "edit", added: 1, removed: 1, binary: false })
  })

  it("treats content-only payloads as writes and flags NUL bytes as binary", () => {
    expect(fileChangeModel({ path: "new.ts", content: "a\nb" })).toMatchObject({
      kind: "write",
      added: 2,
      removed: 0,
    })
    expect(fileChangeModel({ oldString: "a\u0000b", newString: "c" }).binary).toBe(true)
  })

  it("accepts a bare path string", () => {
    expect(fileChangeModel("only/path.ts")).toMatchObject({
      path: "only/path.ts",
      kind: "write",
      added: 0,
      removed: 0,
    })
  })
})

describe("stripAnsi / terminalLinesModel", () => {
  it("strips ANSI CSI sequences", () => {
    expect(stripAnsi("\u001B[31mred\u001B[0m plain")).toBe("red plain")
  })

  it("classifies tones: ANSI color first, then keywords", () => {
    const lines = terminalLinesModel("\u001B[32m\u2713 ok\u001B[0m\nERROR: nope\nWARN old\nplain")
    expect(lines.map((l) => l.tone)).toEqual(["success", "error", "warn", "plain"])
    expect(lines[0]?.text).toBe("\u2713 ok")
  })

  it("normalizes CRLF, reads { output } parts and caps rows", () => {
    expect(terminalLinesModel("a\r\nb")).toHaveLength(2)
    expect(terminalLinesModel({ output: "x" })).toEqual([{ text: "x", tone: "plain" }])
    expect(terminalLinesModel("a\nb\nc", 2)).toHaveLength(2)
  })
})

describe("webSearchModel", () => {
  it("extracts results with hostnames and drops unsafe URLs", () => {
    const m = webSearchModel({
      query: "q",
      results: [
        { title: "T", url: "https://docs.x.dev/a", snippet: "s" },
        { title: "B", url: "javascript:alert(1)" },
      ],
    })
    expect(m.query).toBe("q")
    expect(m.results[0]).toMatchObject({ domain: "docs.x.dev", snippet: "s" })
    expect(m.results[1]?.url).toBeUndefined()
    expect(m.truncated).toBe(false)
  })

  it("caps results and degrades garbage", () => {
    const many = { results: Array.from({ length: 10 }, (_, i) => ({ title: `t${i}` })) }
    expect(webSearchModel(many, 8).truncated).toBe(true)
    expect(webSearchModel(many, 8).results).toHaveLength(8)
    expect(webSearchModel("junk")).toEqual({ query: "", results: [], truncated: false })
  })
})

describe("linkPreviewModel", () => {
  it("extracts url, title, description and domain", () => {
    expect(linkPreviewModel({ url: "https://x.dev/p", title: "X", description: "d" })).toEqual({
      url: "https://x.dev/p",
      title: "X",
      description: "d",
      domain: "x.dev",
    })
  })

  it("treats a bare URL string as the title and rejects non-http targets", () => {
    expect(linkPreviewModel("https://y.dev/page")).toMatchObject({
      title: "https://y.dev/page",
      domain: "y.dev",
    })
    expect(linkPreviewModel("not-a-url")).toMatchObject({ url: undefined, domain: "" })
  })
})

describe("commandBlockModel", () => {
  it("reads command + exit code with aliases", () => {
    expect(commandBlockModel("ls -la")).toEqual({
      command: "ls -la",
      exitCode: undefined,
      ok: undefined,
    })
    expect(commandBlockModel({ command: "make", exitCode: 1 })).toMatchObject({ ok: false })
    expect(commandBlockModel({ cmd: "echo hi", code: 0 })).toMatchObject({ ok: true })
    expect(commandBlockModel({ line: "x", exit_code: "3" }).exitCode).toBe(3)
  })
})

describe("tableBlockModel", () => {
  it("normalizes array rows with headers", () => {
    expect(
      tableBlockModel({
        columns: ["Name", "Age"],
        rows: [
          ["a", 1],
          ["b", 2],
        ],
      }),
    ).toEqual({
      columns: ["Name", "Age"],
      rows: [
        ["a", "1"],
        ["b", "2"],
      ],
      totalRows: 2,
      truncated: false,
    })
  })

  it("derives columns from object rows and pads scalar rows", () => {
    expect(tableBlockModel({ rows: [{ name: "x", size: 2 }] }).columns).toEqual(["name", "size"])
    expect(tableBlockModel(["a", "b"])).toMatchObject({
      columns: ["col-1"],
      rows: [["a"], ["b"]],
    })
  })

  it("caps rows and reports the overflow", () => {
    const rows = Array.from({ length: 12 }, () => ["r"])
    const m = tableBlockModel({ rows }, 10)
    expect(m.rows).toHaveLength(10)
    expect(m.totalRows).toBe(12)
    expect(m.truncated).toBe(true)
    expect(tableBlockModel({}).totalRows).toBe(0)
  })
})

describe("progressModel", () => {
  it("coerces fractions, percents and clamps", () => {
    expect(progressModel(0.5).value).toBe(50)
    expect(progressModel("75").value).toBe(75)
    expect(progressModel({ percent: 120 }).value).toBe(100)
    expect(progressModel({ pct: -5 }).value).toBe(0)
    expect(progressModel({ value: 0.25 }).value).toBe(25)
    expect(progressModel({ progress: 42 }).value).toBe(42)
    expect(progressModel("junk")).toEqual({ value: 0, label: undefined })
  })

  it("carries the label", () => {
    expect(progressModel({ value: 0.5, label: "Half" }).label).toBe("Half")
  })
})

describe("alertVariant / quoteModel / diffStatFromUnified / collapseModel", () => {
  it("canonicalizes alert levels", () => {
    expect(alertVariant("warning")).toBe("warn")
    expect(alertVariant("danger")).toBe("error")
    expect(alertVariant("OK")).toBe("success")
    expect(alertVariant(undefined)).toBe("info")
    expect(alertVariant("notice")).toBe("info")
  })

  it("extracts quotes with sources", () => {
    expect(quoteModel("text")).toEqual({ text: "text", source: undefined })
    expect(quoteModel({ quote: "b", author: "A" })).toEqual({ text: "b", source: "A" })
    expect(quoteModel(42).text).toBe("")
  })

  it("counts +/- lines and files in a unified diff", () => {
    const diff = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1,3 +1,4 @@",
      " ctx",
      "-old",
      "-old2",
      "+new",
    ].join("\n")
    expect(diffStatFromUnified(diff)).toEqual({ added: 1, removed: 2, files: 1 })
    expect(diffStatFromUnified(42)).toEqual({ added: 0, removed: 0, files: 0 })
  })

  it("resolves controlled vs uncontrolled collapse state", () => {
    expect(collapseModel(undefined, true)).toEqual({ isControlled: false, initialOpen: true })
    expect(collapseModel(false, true)).toEqual({ isControlled: true, initialOpen: false })
    expect(collapseModel(true, false)).toEqual({ isControlled: true, initialOpen: true })
  })
})

describe("sparklineModel", () => {
  it("maps a series to a bounded polyline", () => {
    const m = sparklineModel([1, 2, 3], 96, 24)
    expect(m.points).toHaveLength(3)
    expect(m.min).toBe(1)
    expect(m.max).toBe(3)
    expect(m.points[0]?.x).toBe(0)
    expect(m.points[2]?.x).toBe(96)
    expect(m.polyline).toMatch(/^0\.00,/)
  })

  it("degrades to an empty model and drops non-numeric entries", () => {
    expect(sparklineModel([])).toEqual({ points: [], polyline: "", min: 0, max: 0 })
    expect(sparklineModel([1, "x", null, 3]).points).toHaveLength(2)
    expect(sparklineModel([5]).points).toHaveLength(1)
  })
})

describe("barMiniModel", () => {
  it("maps values to baseline-zero bars", () => {
    const m = barMiniModel([1, 2, 3], 30, 30)
    expect(m.bars).toHaveLength(3)
    expect(m.max).toBe(3)
    expect(m.bars[2]).toMatchObject({ height: 30, y: 0 })
    expect(m.bars[0]).toMatchObject({ height: 10, y: 20 })
  })

  it("clamps negatives to zero-height and degrades to empty", () => {
    expect(barMiniModel([-1, 0, 5]).bars[0]?.height).toBe(0)
    expect(barMiniModel("junk")).toEqual({ bars: [], max: 0 })
  })
})

describe("donutModel / heatRowModel / gaugeArcModel", () => {
  it("emits stroke-dasharray for the donut ratio", () => {
    expect(donutModel(0.25, 8).dash).toBe("12.57 37.70")
    expect(donutModel(150, 8)).toMatchObject({ ratio: 1, dash: "50.27 0.00" })
    expect(donutModel({}, 8)).toMatchObject({ ratio: 0, dash: "0.00 50.27" })
  })

  it("tiers heat cells relative to the row min/max with empty slots", () => {
    expect(heatRowModel([1, 2, 3, 4]).map((c) => c.tier)).toEqual([1, 2, 3, 4])
    expect(heatRowModel([null, 5, "x", 5]).map((c) => c.tier)).toEqual([0, 1, 0, 1])
    expect(heatRowModel([])).toEqual([])
  })

  it("emits gauge arcs: track always, value path only above zero", () => {
    expect(gaugeArcModel(0).valuePath).toBe("")
    const half = gaugeArcModel(50)
    expect(half.ratio).toBe(0.5)
    expect(half.trackPath).toContain("2.00 14.00")
    expect(half.valuePath).toContain("14.00 2.00")
    expect(gaugeArcModel(200).ratio).toBe(1)
  })
})

describe("timelineMiniModel / statCardModel / deltaBadgeModel", () => {
  it("maps statuses to timeline dot tones", () => {
    expect(
      timelineMiniModel({
        items: [{ label: "A", status: "done" }, { title: "B", status: "failed" }, { text: "C" }],
      }).map((i) => i.tone),
    ).toEqual(["accent", "danger", "muted"])
    expect(timelineMiniModel({ events: [{ label: "E", time: "12:00" }] })[0]?.time).toBe("12:00")
    expect(timelineMiniModel([1, 2, 3], 2)).toHaveLength(2)
  })

  it("extracts stat cards with trend direction from alias or delta sign", () => {
    expect(statCardModel({ label: "L", value: 42, delta: -3 })).toEqual({
      label: "L",
      value: "42",
      direction: "down",
      delta: -3,
    })
    expect(statCardModel({ value: "1.2k", trend: "up" }).direction).toBe("up")
    expect(statCardModel({ value: 7, direction: "falling" }).direction).toBe("down")
    expect(statCardModel({})).toEqual({ label: "", value: "", direction: "flat", delta: undefined })
  })

  it("formats delta badges signed and degrades to neutral", () => {
    expect(deltaBadgeModel(5)).toEqual({ value: 5, direction: "up", text: "+5" })
    expect(deltaBadgeModel(-2.5)).toMatchObject({ direction: "down", text: "-2.5" })
    expect(deltaBadgeModel(0)).toMatchObject({ direction: "flat", text: "0" })
    expect(deltaBadgeModel("abc").value).toBe(0)
  })
})

describe("easeOutCubic / countUpValue / prefersReducedMotion", () => {
  it("eases with clamped cubic ease-out", () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBe(0.875)
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })

  it("interpolates frames and lands on the target for hostile inputs", () => {
    expect(countUpValue(0, 100, 500, 1000)).toBeCloseTo(87.5)
    expect(countUpValue(0, 100, 2000, 1000)).toBe(100)
    expect(countUpValue(10, 50, Number.NaN, 100)).toBe(50)
    expect(countUpValue(0, 100, 500, 0)).toBe(100)
  })

  it("probes prefers-reduced-motion defensively", () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
    expect(prefersReducedMotion()).toBe(true)
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList)
    expect(prefersReducedMotion()).toBe(false)
    window.matchMedia = original
  })
})

describe("skeletonModel / emptyHintModel / copyFieldModel / jsonPeekModel", () => {
  it("normalizes skeleton shapes", () => {
    expect(skeletonModel(0)).toEqual({ variant: "text", lines: 1 })
    expect(skeletonModel(99)).toEqual({ variant: "text", lines: 8 })
    expect(skeletonModel("circle")).toEqual({ variant: "circle", lines: 3 })
    expect(skeletonModel({ variant: "RECT", lines: "2" })).toEqual({ variant: "rect", lines: 2 })
    expect(skeletonModel(true)).toEqual({ variant: "text", lines: 3 })
  })

  it("extracts empty-state hint pieces", () => {
    expect(emptyHintModel("Nothing")).toEqual({
      title: "Nothing",
      hint: undefined,
      actionLabel: undefined,
    })
    expect(emptyHintModel({ text: "X", description: "D", button: "Go" })).toEqual({
      title: "X",
      hint: "D",
      actionLabel: "Go",
    })
  })

  it("extracts copy field values", () => {
    expect(copyFieldModel("abc")).toEqual({ value: "abc", label: undefined })
    expect(copyFieldModel({ value: "v", label: "L" })).toEqual({ value: "v", label: "L" })
    expect(copyFieldModel(42).value).toBe("")
  })

  it("pretty-prints JSON with bounded previews", () => {
    expect(jsonPeekModel({ a: 1 })).toEqual({
      preview: '{\n  "a": 1\n}',
      full: '{\n  "a": 1\n}',
      truncated: false,
      isJson: true,
    })
    expect(jsonPeekModel('{"b":[1,2]}').full).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}')
    expect(jsonPeekModel("not json")).toMatchObject({ full: "not json", isJson: false })
    expect(jsonPeekModel(undefined).isJson).toBe(false)
    const big = jsonPeekModel({ k: "x".repeat(600) }, 100)
    expect(big.truncated).toBe(true)
    expect(big.preview).toHaveLength(100)
    expect(big.full.length).toBeGreaterThan(100)
  })
})

// ── Batch-1/2 component smoke ───────────────────────────────────────────────

describe("ToolResultBlock / PlanStepList / TodoListBlock (smoke)", () => {
  it("renders tool name, status pill, duration and output", () => {
    render(
      <ToolResultBlock result={{ tool: "bash", ok: true, durationMs: 900, content: "all good" }} />,
    )
    expect(screen.getByText("bash")).toBeInTheDocument()
    expect(screen.getByText("all good")).toBeInTheDocument()
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })

  it("marks failures and shows the error as content", () => {
    render(<ToolResultBlock result={{ tool: "make", ok: false, error: "boom" }} />)
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("boom")).toBeInTheDocument()
  })

  it("indents plan steps by dependency depth and degrades to the empty state", () => {
    const plan = {
      steps: [
        { id: "a", title: "Read", status: "completed" },
        { id: "b", title: "Edit", dependsOn: ["a"] },
      ],
    }
    const { unmount } = render(<PlanStepList steps={plan} />)
    const items = screen.getAllByRole("listitem")
    expect(items[0]).toHaveStyle({ paddingLeft: "12px" })
    expect(items[1]).toHaveStyle({ paddingLeft: "28px" })
    unmount()
    render(<PlanStepList steps={{}} />)
    expect(screen.getByText("(empty plan)")).toBeInTheDocument()
  })

  it("renders todo checkboxes, priorities and the progress footer", () => {
    render(
      <TodoListBlock todos={[{ text: "ship", done: true, priority: "p1" }, { text: "rest" }]} />,
    )
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes[0]).toHaveAttribute("aria-checked", "true")
    expect(boxes[1]).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("1/2 done")).toBeInTheDocument()
    expect(screen.getByLabelText("High priority")).toBeInTheDocument()
  })
})

describe("FileChangeCard / TerminalOutputBlock (smoke)", () => {
  it("shows path, +/- badges and expands into the shared DiffPreview", async () => {
    const user = userEvent.setup()
    render(<FileChangeCard change={{ path: "src/a.ts", oldString: "x\ny", newString: "x\nz" }} />)
    expect(screen.getByText("src/a.ts")).toBeInTheDocument()
    expect(screen.getByText("+1")).toBeInTheDocument()
    expect(screen.getByText("-1")).toBeInTheDocument()
    expect(screen.queryByTestId("diff-preview")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /expand diff/i }))
    expect(screen.getByTestId("diff-preview")).toBeInTheDocument()
  })

  it("tones terminal lines and degrades empty output", () => {
    const { container, unmount } = render(
      <TerminalOutputBlock output={"ERROR: boom\n\u2713 all done"} />,
    )
    expect(container.querySelector(".text-red-600")).toHaveTextContent("ERROR: boom")
    expect(container.querySelector(".text-emerald-600")).toHaveTextContent("✓ all done")
    unmount()
    render(<TerminalOutputBlock output="" />)
    expect(screen.getByText("(no output)")).toBeInTheDocument()
  })
})

describe("WebSearchBlock / LinkPreviewCard / CommandBlock (smoke)", () => {
  it("renders the query and safe result links", () => {
    render(
      <WebSearchBlock
        search={{ query: "vitest", results: [{ title: "Docs", url: "https://vitest.dev/guide" }] }}
      />,
    )
    expect(screen.getByText("vitest")).toBeInTheDocument()
    const link = screen.getByText("Docs")
    expect(link).toHaveAttribute("href", "https://vitest.dev/guide")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByText("1 results")).toBeInTheDocument()
  })

  it("anchors safe links and renders junk links inert", () => {
    const { unmount } = render(
      <LinkPreviewCard link={{ url: "https://z.ai", title: "Z.ai", description: "AI" }} />,
    )
    expect(screen.getByText("Z.ai").closest("a")).toHaveAttribute("href", "https://z.ai")
    unmount()
    render(<LinkPreviewCard link="javascript:alert(1)" />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("shows the command with an exit-code badge, or none while unknown", () => {
    const { unmount } = render(<CommandBlock command={{ command: "make test", exitCode: 2 }} />)
    expect(screen.getByText("make test")).toBeInTheDocument()
    expect(screen.getByLabelText("exit 2")).toHaveTextContent("exit 2")
    unmount()
    render(<CommandBlock command="ls" />)
    expect(screen.queryByLabelText(/exit/)).not.toBeInTheDocument()
  })
})

describe("TableBlock / ProgressBlock / AlertBanner / QuoteBlock (smoke)", () => {
  it("renders table headers/cells and the truncation footer", () => {
    const { unmount } = render(
      <TableBlock
        table={{
          columns: ["K", "V"],
          rows: [
            ["a", 1],
            ["b", 2],
          ],
        }}
      />,
    )
    expect(screen.getByRole("columnheader", { name: "K" })).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
    unmount()
    const rows = Array.from({ length: 12 }, (_, i) => [`r${i}`, i])
    render(<TableBlock table={{ rows }} />)
    expect(screen.getAllByRole("row")).toHaveLength(11)
    expect(screen.getByText("2 more rows (12 total)")).toBeInTheDocument()
  })

  it("exposes progress semantics for fraction input", () => {
    render(<ProgressBlock progress={{ value: 0.3, label: "Upload" }} />)
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30")
    expect(screen.getByText("Upload")).toBeInTheDocument()
  })

  it("renders alert variants with the localized default title", () => {
    render(<AlertBanner variant="warning" text="careful" />)
    expect(screen.getByRole("alert")).toHaveTextContent("Warning")
    expect(screen.getByRole("alert")).toHaveTextContent("careful")
  })

  it("renders quotes with attribution and hides empty ones", () => {
    const { unmount } = render(<QuoteBlock quote={{ text: "stay hungry", source: "Jobs" }} />)
    expect(screen.getByText("stay hungry")).toBeInTheDocument()
    expect(screen.getByText("— Jobs")).toBeInTheDocument()
    unmount()
    const empty = render(<QuoteBlock quote="" />)
    expect(empty.container).toBeEmptyDOMElement()
  })
})

describe("DiffStat / Collapse (smoke)", () => {
  it("renders +N/-N badges from a unified diff and nothing for empty diffs", () => {
    const diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@\n-old\n+new\n+new2"
    const { unmount } = render(<DiffStat diff={diff} />)
    expect(screen.getByText("+2")).toBeInTheDocument()
    expect(screen.getByText("-1")).toBeInTheDocument()
    expect(screen.getByText("1 files")).toBeInTheDocument()
    unmount()
    const empty = render(<DiffStat diff="nothing" />)
    expect(empty.container).toBeEmptyDOMElement()
  })

  it("toggles uncontrolled and reports controlled opens", async () => {
    const user = userEvent.setup()
    render(
      <Collapse summary="Details">
        <span>hidden-body</span>
      </Collapse>,
    )
    expect(screen.queryByText("hidden-body")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /details/i }))
    expect(screen.getByText("hidden-body")).toBeInTheDocument()
    const onOpenChange = vi.fn()
    render(
      <Collapse summary="Sealed" open={false} onOpenChange={onOpenChange}>
        <span>x-body</span>
      </Collapse>,
    )
    await user.click(screen.getByRole("button", { name: /sealed/i }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText("x-body")).not.toBeInTheDocument()
  })
})

describe("chart widgets (smoke)", () => {
  it("renders the sparkline polyline and omits it for junk input", () => {
    const { container, unmount } = render(<Sparkline values={[1, 2, 3]} />)
    expect(container.querySelector("polyline")).toBeInTheDocument()
    unmount()
    const empty = render(<Sparkline values="junk" />)
    expect(empty.container.querySelector("polyline")).toBeNull()
  })

  it("renders one bar per value and donut meter semantics", () => {
    const { container, unmount } = render(<BarMini values={[1, 2, 3]} />)
    expect(container.querySelectorAll("rect")).toHaveLength(3)
    unmount()
    render(<DonutStat value={0.75} />)
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "75")
    expect(screen.getByText("75%")).toBeInTheDocument()
  })

  it("renders heat cells and omits empty rows", () => {
    const { container, unmount } = render(<HeatRow values={[1, 2, 3, 4]} />)
    expect(container.querySelectorAll("span[title]")).toHaveLength(4)
    unmount()
    render(<HeatRow values={[null, null]} />)
    expect(screen.getByText("(no values)")).toBeInTheDocument()
  })

  it("renders the gauge track and value arcs", () => {
    const { container, unmount } = render(<GaugeArc value={0.5} />)
    expect(container.querySelectorAll("path")).toHaveLength(2)
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "50")
    unmount()
    const zero = render(<GaugeArc value={0} />)
    expect(zero.container.querySelectorAll("path")).toHaveLength(1)
  })

  it("renders timeline entries with tone dots and the empty state", () => {
    const { unmount } = render(
      <TimelineMini
        timeline={{
          items: [
            { label: "build", status: "done", time: "12:00" },
            { label: "test", status: "error" },
          ],
        }}
      />,
    )
    expect(screen.getByText("build")).toBeInTheDocument()
    expect(screen.getByText("12:00")).toBeInTheDocument()
    expect(screen.getByText("test")).toBeInTheDocument()
    unmount()
    render(<TimelineMini timeline={{}} />)
    expect(screen.getByText("(no events)")).toBeInTheDocument()
  })
})

describe("StatCard / DeltaBadge / CountUp / SkeletonBlock (smoke)", () => {
  it("renders the stat value with trend arrow and delta badge", () => {
    render(<StatCard stat={{ label: "Stars", value: 1200, delta: 12 }} />)
    expect(screen.getByText("Stars")).toBeInTheDocument()
    expect(screen.getByText("1200")).toBeInTheDocument()
    expect(screen.getByText("+12")).toBeInTheDocument()
    expect(screen.getByLabelText("Trending up")).toBeInTheDocument()
  })

  it("colors negative deltas and degrades junk to neutral", () => {
    const { unmount } = render(<DeltaBadge delta={-4} />)
    expect(screen.getByText("-4")).toBeInTheDocument()
    expect(screen.getByLabelText("decrease")).toBeInTheDocument()
    unmount()
    render(<DeltaBadge delta="abc" />)
    expect(screen.getByText("0")).toBeInTheDocument()
  })

  it("snaps to the target under reduced motion and animates otherwise", async () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
    const { unmount } = render(<CountUp value={42} />)
    expect(screen.getByText("42")).toBeInTheDocument()
    unmount()
    window.matchMedia = original
    render(<CountUp value={100} durationMs={20} />)
    // rAF pacing degrades under full-suite parallel load — allow for it.
    await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument(), { timeout: 5000 })
  })

  it("renders the requested skeleton line count", () => {
    const { container } = render(<SkeletonBlock shape={4} />)
    expect(container.querySelectorAll(".h-3")).toHaveLength(4)
  })
})

describe("EmptyHint / CopyField / JsonPeek (smoke)", () => {
  it("renders the hint and fires the optional action", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { unmount } = render(
      <EmptyHint
        hint={{ title: "No sessions", hint: "Start one", action: "Create" }}
        onAction={onAction}
      />,
    )
    expect(screen.getByText("No sessions")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Create" }))
    expect(onAction).toHaveBeenCalledOnce()
    unmount()
    render(<EmptyHint hint={{}} />)
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument()
  })

  it("copies the field through the clipboard and hides without the API", async () => {
    clipboardEnabled = true
    const writeText = vi.fn().mockResolvedValue(undefined)
    copyTextMock = writeText
    const user = userEvent.setup()
    const { unmount } = render(<CopyField field={{ value: "sk-123", label: "key" }} />)
    expect(screen.getByText("sk-123")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("sk-123")
    unmount()
    clipboardEnabled = false
    render(<CopyField field="hidden-value" />)
    expect(screen.queryByText("hidden-value")).not.toBeInTheDocument()
  })

  it("truncates JSON behind an expander and tags non-JSON strings", async () => {
    const user = userEvent.setup()
    render(<JsonPeek json={{ big: "y".repeat(300) }} maxChars={100} />)
    expect(screen.getByText(/Show \d+ more characters/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /more characters/i }))
    expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument()
    const { unmount } = render(<JsonPeek json="plain text" />)
    expect(screen.getByText("not JSON")).toBeInTheDocument()
    unmount()
  })
})

describe("ai-elements barrel", () => {
  it("exposes the clipboard guard through the public surface", () => {
    expect(typeof canUseClipboard).toBe("function")
  })

  it("exposes every batch-2 widget and its model", () => {
    for (const widget of [
      ToolResultBlock,
      PlanStepList,
      TodoListBlock,
      FileChangeCard,
      TerminalOutputBlock,
      WebSearchBlock,
      LinkPreviewCard,
      CommandBlock,
      TableBlock,
      ProgressBlock,
      AlertBanner,
      QuoteBlock,
      DiffStat,
      Collapse,
      Sparkline,
      BarMini,
      DonutStat,
      HeatRow,
      GaugeArc,
      TimelineMini,
      StatCard,
      DeltaBadge,
      CountUp,
      SkeletonBlock,
      EmptyHint,
      CopyField,
      JsonPeek,
    ]) {
      expect(typeof widget).toBe("function")
    }
    expect(typeof diffStatFromUnified).toBe("function")
    expect(typeof sparklineModel).toBe("function")
  })
})
