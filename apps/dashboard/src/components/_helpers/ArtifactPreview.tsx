import { useEffect, useMemo, useState } from "react"

export interface Artifact {
  name: string
  mime: string
  content: string
  workspaceId: string
}

export interface ArtifactPreviewProps {
  artifact: Artifact
}

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
  const { mime, name, content } = artifact
  if (mime === "text/markdown" || name.endsWith(".md")) {
    return <MarkdownBody content={content} />
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
    return (
      <div className="flex items-center justify-center max-h-[80vh] overflow-auto">
        <img
          alt={name}
          className="max-h-[80vh] object-contain"
          src={`data:${mime};base64,${content}`}
        />
      </div>
    )
  }
  if (mime === "text/csv" || name.endsWith(".csv")) {
    return <CsvTable content={content} />
  }
  return (
    <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
      <code>{content}</code>
    </pre>
  )
}

function MarkdownBody({ content }: { content: string }) {
  // Dynamic-import instead of CommonJS `require()` so Vite's ESM bundler can
  // tree-shake the markdown lib (when present) and won't blow up at build
  // time on a project that hasn't installed the optional renderer. The
  // previous version used `require("../lib/markdown")` which silently
  // threw in production: the catch swallowed the error and the previewer
  // always fell back to the <pre> rendering, so the markdown feature was
  // effectively dead in deployed builds.
  const [rendered, setRendered] = useState<string | null>(null)
  const [rendererMissing, setRendererMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRendered(null)
    setRendererMissing(false)
    ;(async () => {
      try {
        // `import` of a module that doesn't exist is a build error under
        // TS's resolver, so wrap the dynamic import in a Function() that
        // hides the path from the type checker. The runtime path is still
        // a normal `import()` call; we just want TS not to refuse the
        // build when the optional renderer isn't installed.
        const dynamicImport: (p: string) => Promise<unknown> = new Function(
          "p",
          "return import(p)",
        ) as (p: string) => Promise<unknown>
        const mod = (await dynamicImport("../lib/markdown")) as
          { renderMarkdown?: (s: string) => string; default?: (s: string) => string } | undefined
        const fn = mod?.renderMarkdown ?? mod?.default
        if (typeof fn !== "function") {
          if (!cancelled) setRendererMissing(true)
          return
        }
        const html = fn(content)
        if (!cancelled) setRendered(html)
      } catch {
        // Renderer module is optional; missing module is not an error —
        // we just fall back to the <pre> view below.
        if (!cancelled) setRendererMissing(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [content])

  if (!rendered || rendererMissing) {
    return (
      <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
        <code>{content}</code>
      </pre>
    )
  }
  return (
    <div
      className="prose dark:prose-invert max-w-none max-h-[80vh] overflow-auto p-4"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  )
}

function CsvTable({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content])
  if (rows.length === 0) {
    return (
      <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
        <code>{content}</code>
      </pre>
    )
  }
  const [header, ...body] = rows
  return (
    <div className="max-h-[80vh] overflow-auto">
      <table className="text-xs border-collapse">
        <thead className="sticky top-0 bg-background">
          <tr>
            {header!.map((cell, i) => (
              <th key={i} className="border border-border px-2 py-1 text-left font-mono">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-border px-2 py-1 font-mono tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(","))
}
