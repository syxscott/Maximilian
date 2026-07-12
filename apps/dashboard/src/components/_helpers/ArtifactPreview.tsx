import { useMemo } from "react"

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
  let rendered = ""
  try {
    // Try the project's markdown renderer if present. Falls back to <pre> on
    // any error so the previewer never crashes on a malformed artifact.

    const mod = require("../lib/markdown")
    const fn = mod.renderMarkdown ?? mod.default
    if (typeof fn === "function") rendered = fn(content)
  } catch {
    return (
      <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
        <code>{content}</code>
      </pre>
    )
  }
  if (!rendered) {
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
