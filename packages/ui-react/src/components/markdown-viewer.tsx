import * as React from "react"
import { cn } from "../lib/utils.js"

/**
 * Lightweight markdown viewer.
 *
 * The default implementation does NOT depend on `react-markdown` /
 * `remark-gfm` / `rehype-highlight` to keep the package portable. It
 * escapes HTML and renders a `<pre>` block — useful for previews.
 *
 * For a full-featured renderer, install the deps and pass `render` as a
 * prop that returns the rendered ReactNode. The shape mirrors the common
 * react-markdown callback signature.
 */
export type MarkdownRender = (input: { markdown: string }) => React.ReactNode

export interface MarkdownViewerProps extends React.HTMLAttributes<HTMLDivElement> {
  markdown: string
  /** Optional custom renderer. Receives the raw markdown and returns ReactNode. */
  render?: MarkdownRender
  /** When `render` is omitted, escape HTML and render as plain text in <pre>. */
  asPre?: boolean
}

const defaultRender: MarkdownRender = ({ markdown }) => {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return <pre className="m-0 whitespace-pre-wrap font-sans text-sm">{escape(markdown)}</pre>
}

export const MarkdownViewer = React.forwardRef<HTMLDivElement, MarkdownViewerProps>(
  function MarkdownViewer({ markdown, render = defaultRender, asPre, className, ...rest }, ref) {
    const content = React.useMemo(() => render({ markdown }), [markdown, render])
    return (
      <div
        ref={ref}
        data-component="markdown-viewer"
        data-as-pre={asPre ? true : undefined}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none text-foreground",
          "[&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5",
          className,
        )}
        {...rest}
      >
        {content}
      </div>
    )
  },
)
