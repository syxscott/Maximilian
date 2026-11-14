// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * CodeBlock v2 — fenced code display with incremental Shiki highlighting.
 *
 * (borrowing) Ported from deepseek-harness `markdown/CodeBlock.tsx`:
 *
 * - A streaming fence (`streaming`, keyed stably by the markdown renderer)
 *   tokenizes through a per-instance `StreamingHighlightSession`, which
 *   re-tokenizes only appended text and keeps completed line groups (32
 *   lines per group) untouched, so React reconciles instead of rebuilding
 *   the whole tree per chunk.
 * - A single document-wide IntersectionObserver gates highlighting: an
 *   off-screen fence paints its geometry from the plain-text arm and only
 *   tokenizes when it first scrolls into view.
 * - A `diff`/`patch` fence renders unified-diff rows; each file's removed
 *   and added sides tokenize with the language its header names.
 * - Grammars load lazily (first render plain text, re-render once the
 *   grammar registers); the highlighter itself uses shiki's JavaScript
 *   regex engine — no oniguruma WASM.
 */

import { Fragment, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "../lib/utils.js"
import {
  HIGHLIGHT_THEME_CLASS,
  StreamingHighlightSession,
  grammarLoadCount,
  highlightToHtml,
  subscribeGrammarLoaded,
} from "../lib/syntax-highlighter.js"
import type { HighlightSpan, StreamingHighlightFrame } from "../lib/syntax-highlighter.js"
import {
  diffFenceTokens,
  isDiffContent,
  isDiffFenceLanguage,
  parseDiffFence,
} from "../lib/diff-fence.js"
import type { DiffRow } from "../lib/diff-fence.js"
import { useViewportHighlighting } from "../lib/use-viewport-highlighting.js"

export interface CodeBlockV2Props {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /**
   * Render unified-diff rows: row colors by marker column, and each file's
   * removed and added sides tokenized with the language its header names.
   * Omitted, a `diff` or `patch` `lang` selects them; `true` or `false`
   * forces the choice for any `lang`.
   */
  diff?: boolean | undefined
  /**
   * The code is still growing (a streaming markdown fence): highlight through
   * a per-instance streaming session, which re-tokenizes only appended text
   * and keeps completed line groups (and DOM) untouched. The caller must
   * keep the component instance stable across growth (a stream-stable React
   * key); an unchanged streamed fence also retains that tree when it
   * settles. Cold settled callers get shiki's HTML.
   */
  streaming?: boolean | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Show a numbered gutter without adding numbers to copied source. Defaults to false. */
  lineNumbers?: boolean | undefined
  /** Show the language and copy header. Defaults to true. */
  showHeader?: boolean | undefined
  /** Show the copy button. Defaults to true. */
  copyable?: boolean | undefined
  /** Copy-button idle label. Defaults to "Copy". */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. Defaults to "Copied". */
  copiedLabel?: string | undefined
}

/**
 * The `pre` attributes the shiki HTML arm emits for the token theme,
 * mirrored so the streaming arm's tree is interchangeable with the settled
 * swap (the streaming parity test pins the two arms).
 */
const SHIKI_PRE_PROPS = {
  className: HIGHLIGHT_THEME_CLASS,
  style: {
    backgroundColor: "var(--color-background-stronger)",
    color: "var(--text-base)",
  },
  tabIndex: 0,
} as const

/** Completed-line group size; React reconciles groups while the DOM remains line-for-line identical. */
const STREAMING_LINE_GROUP_SIZE = 32

/** Copy text through the async clipboard when available, else a hidden textarea. */
async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path (permissions, non-secure contexts).
    }
  }
  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}

/** Line color class per row kind; context rows keep the block's default ink. */
const DIFF_ROW_CLASS: Record<DiffRow["kind"], string | undefined> = {
  add: "text-[var(--syntax-diff-add)]",
  del: "text-[var(--syntax-diff-delete)]",
  hunk: "text-[var(--syntax-unknown)]",
  meta: "text-muted-foreground",
  context: undefined,
}

/** One diff row: optional marker column, then the body with its token colors. */
function renderDiffRow(
  row: DiffRow,
  index: number,
  tokens: readonly HighlightSpan[] | undefined,
): ReactNode {
  const kindClass = DIFF_ROW_CLASS[row.kind]
  return (
    <Fragment key={index}>
      {index > 0 && "\n"}
      <span className={cn("line", kindClass)}>
        {isDiffContent(row) ? (
          <Fragment>
            <span className="select-none opacity-70">{row.marker}</span>
            {tokens === undefined
              ? row.body
              : tokens.map((span, spanIndex) => (
                  <span key={spanIndex} style={span.style}>
                    {span.text}
                  </span>
                ))}
          </Fragment>
        ) : (
          row.raw
        )}
      </span>
    </Fragment>
  )
}

function renderLine(line: readonly HighlightSpan[], index: number): ReactNode {
  return (
    <Fragment key={index}>
      {index > 0 && "\n"}
      <span className="line">
        {line.map((span, spanIndex) => (
          <span key={spanIndex} style={span.style}>
            {span.text}
          </span>
        ))}
      </span>
    </Fragment>
  )
}

export function CodeBlockV2({
  code,
  lang,
  diff,
  streaming,
  className,
  lineNumbers = false,
  showHeader = true,
  copyable = true,
  copyLabel = "Copy",
  copiedLabel = "Copied",
}: CodeBlockV2Props) {
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code
  const diffRows = useMemo(
    () => ((diff ?? isDiffFenceLanguage(lang)) ? parseDiffFence(trimmed) : undefined),
    [trimmed, lang, diff],
  )
  const sourceLines = lineNumbers ? trimmed.split("\n") : undefined
  const rootRef = useRef<HTMLDivElement>(null)
  // Diff rows join the same viewport gate as grammar-highlighted fences, so
  // an off-screen fence paints its row colors without tokenizing the body.
  const highlighting = useViewportHighlighting(rootRef, diffRows === undefined ? lang : "diff")
  // Re-render when a lazy grammar finishes loading, so a fence that showed
  // plain text while its language's grammar imported picks up highlighting.
  // The snapshot value is opaque; only its change across renders drives the
  // memos below (it participates in their dependency arrays for that effect).
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  // Each file's old and new sides are tokenized separately; a growing fence
  // re-tokenizes per chunk because that grouping has no incremental path, and
  // diffs in a fence are short enough to accept it.
  const diffTokens = useMemo(
    () => (diffRows === undefined || !highlighting ? undefined : diffFenceTokens(diffRows)),
    [diffRows, highlighting, loaded],
  )
  // Streaming state lives in refs mutated inside the memo (the markdown-v2
  // streaming-cache pattern): the session's caches carry across chunks only
  // because the owner keys this instance stably while the fence grows.
  const sessionRef = useRef<StreamingHighlightSession | null>(null)
  const lineCacheRef = useRef<{
    code: string
    lang: string | undefined
    generation: number
    frame: StreamingHighlightFrame
    groups: ReactNode[]
    pending: ReactNode[]
    nextLine: number
    body: ReactNode
  } | null>(null)
  const settledRef = useRef(false)
  const streamedBody = useMemo(() => {
    // A diff fence draws its own rows; the session's single-language stream is unused.
    if (!highlighting || diffRows !== undefined) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
      return undefined
    }
    if (streaming !== true) {
      const previous = lineCacheRef.current
      if (previous !== null && previous.code === trimmed && previous.lang === lang) {
        settledRef.current = true
        return previous.body
      }
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = true
      return undefined
    }
    if (settledRef.current) {
      sessionRef.current = null
      lineCacheRef.current = null
      settledRef.current = false
    }
    sessionRef.current ??= new StreamingHighlightSession()
    const frame = sessionRef.current.updateFrame(trimmed, lang)
    if (frame === undefined) {
      lineCacheRef.current = null
      return undefined
    }
    const previous = lineCacheRef.current
    if (previous?.frame === frame && previous.code === trimmed && previous.lang === lang) {
      return previous.body
    }
    const sameGeneration = previous?.generation === frame.generation
    const groups = sameGeneration ? [...previous.groups] : []
    let pending = sameGeneration ? [...previous.pending] : []
    let nextLine = sameGeneration ? previous.nextLine : 0
    for (const line of frame.appended) {
      pending.push(renderLine(line, nextLine))
      nextLine += 1
      if (pending.length !== STREAMING_LINE_GROUP_SIZE) continue
      const start = nextLine - pending.length
      groups.push(<Fragment key={start}>{pending}</Fragment>)
      pending = []
    }
    const tail = frame.tail.map((line, index) => renderLine(line, nextLine + index))
    const tailGroup = <Fragment key={nextLine - pending.length}>{[...pending, ...tail]}</Fragment>
    const body = (
      <pre {...SHIKI_PRE_PROPS}>
        <code>
          {groups}
          {tailGroup}
        </code>
      </pre>
    )
    lineCacheRef.current = {
      code: trimmed,
      lang,
      generation: frame.generation,
      frame,
      groups,
      pending,
      nextLine,
      body,
    }
    return body
  }, [streaming, highlighting, diffRows, trimmed, lang, loaded])
  const html = useMemo(
    () =>
      diffRows === undefined && highlighting && streaming !== true && streamedBody === undefined
        ? highlightToHtml(trimmed, lang)
        : undefined,
    [diffRows, streaming, highlighting, streamedBody, trimmed, lang, loaded],
  )
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    /* The plain-text fallback is the typed stand-in if the DOM shape ever diverges. */
    const text = rootRef.current?.querySelector("pre")?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
      }, 1000)
    })
  }, [copied, trimmed])

  // The shiki HTML output is a static span tree it generated from `code` (no
  // user HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
  const body =
    diffRows !== undefined ? (
      <pre className="whitespace-pre">
        <code>
          {diffRows.rows.map((row, index) => renderDiffRow(row, index, diffTokens?.get(index)))}
        </code>
      </pre>
    ) : streamedBody !== undefined ? (
      streamedBody
    ) : html === undefined ? (
      <pre className="whitespace-pre">
        <code>
          {sourceLines === undefined
            ? trimmed
            : sourceLines.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && "\n"}
                  <span className="line">{line}</span>
                </Fragment>
              ))}
        </code>
      </pre>
    ) : (
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )

  return (
    <div
      ref={rootRef}
      data-component="code-block-v2"
      data-lang={lang ?? ""}
      className={cn(
        "group relative overflow-hidden rounded-md border border-border bg-zinc-950 text-zinc-100",
        className,
      )}
    >
      {showHeader && (
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs">
          <span className="font-mono text-zinc-400">{lang ?? ""}</span>
          {copyable && (
            <button
              type="button"
              onClick={onCopy}
              data-slot="code-block-v2-copy"
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              aria-label={copied ? copiedLabel : copyLabel}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? copiedLabel : copyLabel}</span>
            </button>
          )}
        </div>
      )}
      {sourceLines === undefined ? (
        <div className="overflow-x-auto p-3 font-mono text-xs leading-5">{body}</div>
      ) : (
        <div className="grid grid-cols-[auto_1fr]">
          <div
            aria-hidden="true"
            className="select-none border-r border-white/10 px-2 py-3 text-right font-mono text-xs leading-5 text-zinc-500 tabular-nums"
          >
            {sourceLines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
          <div className="overflow-x-auto p-3 font-mono text-xs leading-5">{body}</div>
        </div>
      )}
    </div>
  )
}
