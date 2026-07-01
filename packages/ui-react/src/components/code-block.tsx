import * as React from "react"
import { Check, Copy } from "lucide-react"
import { SyntaxHighlight, type ShikiHighlighter } from "./syntax-highlight"
import { cn } from "../lib/utils"

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  code: string
  lang?: string
  theme?: string
  highlighter?: ShikiHighlighter
  /** Filename shown in the caption. */
  filename?: string
  /** Show the copy button. Defaults to true. */
  copyable?: boolean
  /** Show line numbers. */
  showLineNumbers?: boolean
  /** Cap the height and scroll. */
  maxHeight?: number | string
}

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(function CodeBlock(
  {
    code,
    lang = "text",
    theme,
    highlighter,
    filename,
    copyable = true,
    showLineNumbers,
    maxHeight,
    className,
    ...rest
  },
  ref,
) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code)
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea")
        ta.value = code
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }, [code])

  return (
    <div
      ref={ref}
      data-component="code-block"
      data-lang={lang}
      className={cn(
        "group relative overflow-hidden rounded-md border border-border bg-zinc-950 text-zinc-100",
        className,
      )}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      {...rest}
    >
      {(filename || copyable) && (
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs">
          <span className="font-mono text-zinc-400">{filename ?? lang}</span>
          {copyable ? (
            <button
              type="button"
              onClick={handleCopy}
              data-slot="code-block-copy"
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              aria-label={copied ? "Copied" : "Copy code"}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          ) : null}
        </div>
      )}
      <SyntaxHighlight
        code={code}
        lang={lang}
        theme={theme}
        highlighter={highlighter}
        showLineNumbers={showLineNumbers}
        className="rounded-none border-0"
      />
    </div>
  )
})
