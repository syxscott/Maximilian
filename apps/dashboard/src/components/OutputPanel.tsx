import { useMemo, useState } from "react"
import { useLocale, t } from "@max/i18n"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FileText, Image as ImageIcon, BarChart2, Code2, FileDiff } from "lucide-react"
import { DiffViewer, type DiffLine } from "@max/ui-react"
import { ArtifactPreview, type Artifact } from "./_helpers/ArtifactPreview"
import type { Workspace, RuntimeEvent } from "../api"

export interface OutputPanelProps {
  workspaceId?: string
  workspace: Workspace | null
  events?: RuntimeEvent[]
}

function guessMime(name: string): string {
  const lower = name.toLowerCase()
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : ""
  if (ext === "png" || ext === "gif" || ext === "webp") return `image/${ext}`
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "svg") return "image/svg+xml"
  if (ext === "csv") return "text/csv"
  if (ext === "md" || ext === "markdown") return "text/markdown"
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "json", "yaml", "yml", "toml"].includes(ext)) {
    return "text/plain"
  }
  return "text/plain"
}

function mimeIcon(mime: string, _name: string) {
  if (mime.startsWith("image/")) return ImageIcon
  if (mime === "text/csv") return BarChart2
  if (/(ts|tsx|js|jsx|py|rs|go)$/i.test(_name)) return Code2
  return FileText
}

function resultToArtifact(
  r: { id: string; taskId: string; output: string },
  workspaceId: string,
): Artifact {
  const filename = `${r.taskId}.txt`
  return {
    name: filename,
    mime: guessMime(filename),
    content: r.output,
    workspaceId,
  }
}

// ── Unified diff parser ────────────────────────────────────────────────────
//
// Parses a `diff --git` / `diff -u` patch into the structured DiffLine[] the
// DiffViewer expects. Returns null if the text doesn't look like a unified
// diff (no `--- / +++` header) so callers can fall back to raw text rendering.
//
// We deliberately don't pull in a full diff library — the agent's outputs
// are small and the parser covers the common subset (added/removed/context
// lines and @@ hunk headers). Tabs are expanded to 4 spaces so monospace
// alignment survives in the rendered HTML.
function parseUnifiedDiff(text: string): DiffLine[] | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  // Look for a unified-diff signature: a "--- " line followed by a "+++ " line.
  const hasOldNew = lines.some((l) => l.startsWith("--- ")) && lines.some((l) => l.startsWith("+++ "))
  if (!hasOldNew) return null
  const out: DiffLine[] = []
  let oldNumber = 0
  let newNumber = 0
  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      // Parse "@@ -a,b +c,d @@ optional heading"
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) {
        oldNumber = Number.parseInt(m[1] ?? "0", 10)
        newNumber = Number.parseInt(m[2] ?? "0", 10)
      }
      out.push({ type: "hunk", content: raw.replace(/\t/g, "    ") })
      continue
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      out.push({ type: "info", content: raw.replace(/\t/g, "    ") })
      continue
    }
    if (raw.startsWith("diff --git ") || raw.startsWith("index ") || raw.startsWith("Binary ")) {
      out.push({ type: "info", content: raw.replace(/\t/g, "    ") })
      continue
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({
        type: "add",
        newNumber,
        content: raw.slice(1).replace(/\t/g, "    "),
      })
      newNumber += 1
      continue
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      out.push({
        type: "del",
        oldNumber,
        content: raw.slice(1).replace(/\t/g, "    "),
      })
      oldNumber += 1
      continue
    }
    // Context line (or blank). Only count it if it begins with a space — pure
    // blank lines inside a diff are ambiguous and we leave them as context.
    if (raw.startsWith(" ") || raw === "") {
      out.push({
        type: "context",
        oldNumber,
        newNumber,
        content: raw.replace(/\t/g, "    "),
      })
      oldNumber += 1
      newNumber += 1
      continue
    }
    // Anything else: treat as info so it's still visible but doesn't get
    // counted as a code line.
    out.push({ type: "info", content: raw.replace(/\t/g, "    ") })
  }
  return out
}

// Label inferred from a diff header (--- / +++) or a metadata patchPath.
function diffCaptionFor(text: string): string | undefined {
  const plus = text.split(/\r?\n/).find((l) => l.startsWith("+++ ") || l.startsWith("--- "))
  if (!plus) return undefined
  // Strip the leading marker and any "a/" / "b/" prefixes some diff tools add.
  return plus.replace(/^(\+\+\+|---) /, "").replace(/^[ab]\//, "").trim() || undefined
}

export function OutputPanel({
  workspaceId,
  workspace,
  events,
}: OutputPanelProps) {
  useLocale()
  const results = (workspace?.results ?? []).filter((r) => r.agentRole !== "review")
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const clampedOpenIdx = openIdx !== null && openIdx < results.length ? openIdx : null

  // Detect a unified diff either in the workspace's results (any result with
  // diff-shaped output) or in the events stream (a file-changed event carrying
  // a patch). We surface it as a dedicated "Diff" tab so reviewers don't have
  // to dig through raw output text.
  const diff = useMemo<{ lines: DiffLine[]; caption?: string } | null>(() => {
    for (const r of results) {
      const parsed = parseUnifiedDiff(r.output)
      if (parsed) return { lines: parsed, caption: diffCaptionFor(r.output) }
    }
    if (events) {
      for (const ev of events) {
        const t = (ev as { type?: unknown }).type
        if (typeof t !== "string") continue
        // Best-effort: tolerate `file-changed` / `file_changed` /
        // `diff-applied` event names. Anchored to the full type so
        // unrelated names like `user-patch` or `system-patch` don't
        // false-positive. (Earlier this regex matched any event whose
        // type contained the substring "patch", which silently pulled
        // non-diff events into the Diff tab.)
        if (
          t === "file-changed" ||
          t === "file_changed" ||
          t === "file-change" ||
          t === "diff-applied" ||
          t === "diff_applied"
        ) {
          const patch = (ev as { patch?: unknown }).patch ?? (ev as { diff?: unknown }).diff
          if (typeof patch === "string") {
            const parsed = parseUnifiedDiff(patch)
            if (parsed) return { lines: parsed, caption: diffCaptionFor(patch) }
          }
        }
      }
    }
    return null
  }, [results, events])

  if (results.length === 0 && !diff) {
    return (
      <div className="output-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("output.empty")}
      </div>
    )
  }

  const tabValue = (r: { id: string }, i: number) => `${r.id}::${i}`
  const diffTabValue = "__diff__"
  const active = clampedOpenIdx !== null ? results[clampedOpenIdx] : null

  return (
    <>
      <Tabs
        defaultValue={diff ? diffTabValue : results[0] ? tabValue(results[0], 0) : diffTabValue}
        className="flex-1 flex flex-col px-3 py-2"
      >
        <TabsList className="flex-wrap">
          {diff && (
            <TabsTrigger value={diffTabValue} className="gap-1.5">
              <FileDiff className="w-3.5 h-3.5" />
              Diff
            </TabsTrigger>
          )}
          {results.map((r, i) => {
            const v = tabValue(r, i)
            return (
              <TabsTrigger key={v} value={v}>
                {r.agentRole} #{i + 1}
              </TabsTrigger>
            )
          })}
        </TabsList>
        {diff && (
          <TabsContent value={diffTabValue} className="flex-1 overflow-auto mt-2">
            <DiffViewer lines={diff.lines} mode="unified" caption={diff.caption} />
          </TabsContent>
        )}
        {results.map((r, i) => {
          const v = tabValue(r, i)
          const Icon = mimeIcon(guessMime(`${r.taskId}.txt`), `${r.taskId}.txt`)
          // If the result itself is a diff, render the inline DiffViewer so
          // the user doesn't have to open the dialog to see what changed.
          const inlineDiff = parseUnifiedDiff(r.output)
          return (
            <TabsContent key={v} value={v} className="flex-1 overflow-auto mt-2">
              <div className="artifact-grid grid grid-cols-2 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setOpenIdx(i)}
                  className="artifact-card text-left p-3 rounded-md border border-border hover:bg-muted/40 transition-colors"
                  aria-label={`Open ${r.agentRole} #${i + 1}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-mono truncate flex-1">{r.agentRole}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono tabular-nums">
                    <span>{r.id.slice(0, 8)}</span>
                  </div>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/80 mt-2 max-h-24 overflow-hidden">
                    {r.output}
                  </pre>
                </button>
              </div>
              {inlineDiff && (
                <div className="mt-3">
                  <DiffViewer lines={inlineDiff} mode="unified" caption={diffCaptionFor(r.output)} />
                </div>
              )}
            </TabsContent>
          )
        })}
      </Tabs>

      <Dialog open={clampedOpenIdx !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogTitle>
            {active ? `${active.agentRole} #${(clampedOpenIdx ?? 0) + 1}` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground font-mono">
            {active?.id.slice(0, 12)}
          </DialogDescription>
          {active && <ArtifactPreview artifact={resultToArtifact(active, workspaceId ?? "")} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
