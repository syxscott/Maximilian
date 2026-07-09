import { useEffect, useRef, type HTMLAttributes } from "react"
import { cn } from "../lib/utils.js"

export interface MarkdownProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  text: string
  cacheKey?: string
  streaming?: boolean
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallbackHtml(markdown: string): string {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

function inlineMarkdown(markdown: string): string {
  let html = fallbackHtml(markdown)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = String(href).replace(/"/g, "&quot;")
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  return html
}

function decorate(root: HTMLDivElement) {
  const codes = Array.from(root.querySelectorAll(":not(pre) > code")) as HTMLElement[]
  for (const code of codes) {
    code.classList.add("markdown-inline-code")
  }
}

export function Markdown({ text, className, streaming: _streaming, ...rest }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastTextRef = useRef<string>("")

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (lastTextRef.current === text) return
    lastTextRef.current = text
    if (!text) {
      el.innerHTML = ""
      return
    }
    el.innerHTML = inlineMarkdown(text)
    decorate(el)
  }, [text])

  return (
    <div
      ref={containerRef}
      data-component="markdown"
      className={cn(className)}
      {...rest}
    />
  )
}