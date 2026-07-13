import { useState } from "react"
import { useLocale, t } from "@max/i18n"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FileText, Image as ImageIcon, BarChart2, Code2 } from "lucide-react"
import { ArtifactPreview, type Artifact } from "./_helpers/ArtifactPreview"
import type { Workspace, RuntimeEvent } from "../api"

export interface OutputPanelProps {
  workspaceId?: string
  workspace: Workspace | null
  events?: RuntimeEvent[]
}

function guessMime(name: string): string {
  const lower = name.toLowerCase()
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  ) {
    return `image/${lower.split(".").pop() === "svg" ? "svg+xml" : lower.split(".").pop() === "jpg" ? "jpeg" : lower.split(".").pop()}`
  }
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown"
  if (/\.(ts|tsx|js|jsx|py|rs|go|json|yaml|yml|toml)$/i.test(name)) return "text/plain"
  return "text/plain"
}

function mimeIcon(mime: string, name: string) {
  if (mime.startsWith("image/")) return ImageIcon
  if (mime === "text/csv" || name.endsWith(".csv")) return BarChart2
  if (/(ts|tsx|js|jsx|py|rs|go)$/i.test(name)) return Code2
  return FileText
}

function resultToArtifact(r: { id: string; taskId: string; output: string }): Artifact {
  const filename = `${r.taskId}.txt`
  return {
    name: filename,
    mime: guessMime(filename),
    content: r.output,
    workspaceId: "",
  }
}

export function OutputPanel({
  workspaceId: _workspaceId,
  workspace,
  events: _events,
}: OutputPanelProps) {
  useLocale()
  const results = (workspace?.results ?? []).filter((r) => r.agentRole !== "review")
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  // Clamp `openIdx` to the current `results` range. The previous version
  // passed the raw state through, so a workspace switch that yielded
  // fewer results left `openIdx` pointing past the end of the new
  // array — the dialog then opened with an undefined `active` and
  // rendered an empty title / blank body. Reset to null when out of
  // range so the dialog closes cleanly on a new (shorter) workspace.
  const clampedOpenIdx = openIdx !== null && openIdx < results.length ? openIdx : null

  if (results.length === 0) {
    return (
      <div className="output-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("output.empty")}
      </div>
    )
  }

  const tabValue = (r: { id: string }, i: number) => `${r.id}::${i}`
  const active = clampedOpenIdx !== null ? results[clampedOpenIdx] : null

  return (
    <>
      <Tabs defaultValue={tabValue(results[0]!, 0)} className="flex-1 flex flex-col px-3 py-2">
        <TabsList className="flex-wrap">
          {results.map((r, i) => {
            const v = tabValue(r, i)
            return (
              <TabsTrigger key={v} value={v}>
                {r.agentRole} #{i + 1}
              </TabsTrigger>
            )
          })}
        </TabsList>
        {results.map((r, i) => {
          const v = tabValue(r, i)
          const Icon = mimeIcon(guessMime(`${r.taskId}.txt`), `${r.taskId}.txt`)
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
          {active && <ArtifactPreview artifact={resultToArtifact(active)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
