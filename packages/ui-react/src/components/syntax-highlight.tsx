import * as React from "react"
import { cn } from "../lib/utils.js"

/**
 * Internal shiki highlighter. The function is async and returns HTML string.
 * We accept it as a prop to avoid a hard dependency on shiki, so consumers
 * can wire it up however they like. See `useShikiHighlighter` for the
 * recommended pattern.
 */
export type ShikiHighlighter = (input: {
  code: string
  lang: string
  theme?: string
}) => Promise<string>

export interface SyntaxHighlightProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  code: string
  lang?: string
  theme?: string
  highlighter?: ShikiHighlighter
  /** Show line numbers on the left. */
  showLineNumbers?: boolean
  /** Optional starting line number. Defaults to 1. */
  startLine?: number
}

const defaultHighlighter: ShikiHighlighter = async ({ code, lang }) => {
  // Minimal, dependency-free highlighter: HTML-escape and tag spans.
  // Replace with a shiki-based highlighter by passing the `highlighter` prop.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<pre class="shiki" data-lang="${escape(lang)}"><code>${escape(code)}</code></pre>`
}

export const SyntaxHighlight = React.forwardRef<HTMLDivElement, SyntaxHighlightProps>(
  function SyntaxHighlight(
    { code, lang = "text", theme, highlighter = defaultHighlighter, showLineNumbers, startLine = 1, className, ...rest },
    ref,
  ) {
    const [html, setHtml] = React.useState<string>("")
    const codeRef = React.useRef(code)

    React.useEffect(() => {
      let cancelled = false
      highlighter({ code, lang, theme })
        .then((result) => {
          if (!cancelled) {
            codeRef.current = code
            setHtml(result)
          }
        })
        .catch(() => {
          if (!cancelled) setHtml("")
        })
      return () => {
        cancelled = true
      }
    }, [code, lang, theme, highlighter])

    const lineCount = React.useMemo(() => (code ? code.split("\n").length : 0), [code])

    if (showLineNumbers) {
      return (
        <div
          ref={ref}
          data-component="syntax-highlight"
          data-lang={lang}
          data-theme={theme}
          className={cn("relative overflow-auto rounded-md bg-zinc-950 text-zinc-100", className)}
          {...rest}
        >
          <div className="grid grid-cols-[3rem_1fr]">
            <div
              aria-hidden="true"
              className="select-none border-r border-white/10 py-3 text-right font-mono text-xs leading-5 text-zinc-500"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="px-2">
                  {startLine + i}
                </div>
              ))}
            </div>
            <div
              className="overflow-x-auto py-3 pr-4 font-mono text-xs leading-5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      )
    }

    return (
      <div
        ref={ref}
        data-component="syntax-highlight"
        data-lang={lang}
        data-theme={theme}
        className={cn("overflow-auto rounded-md bg-zinc-950 p-3 text-zinc-100", className)}
        {...rest}
      >
        <div className="font-mono text-xs leading-5" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  },
)
