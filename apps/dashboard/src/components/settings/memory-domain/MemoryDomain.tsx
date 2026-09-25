// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MemoryDomain — per-role memory viewer over the existing
 * GET /api/evolution/agents surface (facade.profiles). Role selector on
 * top, then one expandable card per memory bucket: full entry list with
 * per-entry full content, the efficacy ledger (injectedCount / deltaSum /
 * mean) and the gating inference badge ("would be skipped under enforce",
 * same thresholds as @max/evolution gatingDecisions) — clicking the badge
 * opens an inline tooltip with the decision's mean and sample count, read
 * straight off the ledger. Each bucket carries its own glyph. A search box
 * filters entries across buckets. The active role's memory can be exported
 * as JSON (Blob download, clipboard fallback) and a validated JSON file can
 * be imported back through POST /evolution/agents/{role}/memory-import after
 * an explicit confirm dialog.
 */

import { useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Download, FileUp, MessageSquare, ClipboardCheck, AlertTriangle, Star } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import {
  SUBAGENTS_QUERY_KEY,
  useMemoryImport,
  useSubagentProfiles,
} from "@/hooks/useSettingsQueries"
import { useQueryClient } from "@tanstack/react-query"
import {
  MEMORY_BUCKETS,
  buildMemoryExportEnvelope,
  entryPreview,
  exportFileName,
  parseMemoryImportFile,
  pickRole,
  searchRoleEntries,
  toMemoryRoleViews,
  type EfficacyLedgerView,
  type MemoryBucketName,
  type MemoryBucketView,
  type MemoryExportEntry,
  type MemoryImportParseError,
  type MemoryImportParseResult,
} from "./model"

type ExportState =
  { kind: "idle" } | { kind: "download"; file: string } | { kind: "clipboard" } | { kind: "error" }

/** Sentinel for "no pending import" (the parse union has no null member). */
const NO_PENDING_IMPORT: MemoryImportParseResult = {
  ok: false,
  error: { code: "emptyImport" },
}

export function MemoryDomain() {
  useLocale()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({})
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" })
  const [pendingImport, setPendingImport] = useState<MemoryImportParseResult>(NO_PENDING_IMPORT)
  const [importError, setImportError] = useState<string | null>(null)
  const [importOk, setImportOk] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { data, isLoading, isError, refetch, isFetching } = useSubagentProfiles()
  const importMutation = useMemoryImport()

  const roles = useMemo(() => toMemoryRoleViews(data), [data])
  const active = pickRole(roles, selected)
  const hits = useMemo(
    () => (active !== null ? searchRoleEntries(active, query) : { buckets: [], matches: 0 }),
    [active, query],
  )

  const toggleBucket = (name: string) =>
    setOpenBuckets((prev) => ({ ...prev, [name]: !prev[name] }))

  // ── Export: envelope from the RAW profile row, Blob download first ────────
  const rawActiveRow = useMemo(() => {
    if (active === null || data == null || typeof data !== "object") return null
    const profiles = (data as { profiles?: unknown }).profiles
    if (!Array.isArray(profiles)) return null
    return (
      profiles.find((row) => {
        if (row == null || typeof row !== "object") return false
        const r = row as Record<string, unknown>
        return (
          (typeof r.role === "string" ? r.role : typeof r.id === "string" ? r.id : "") ===
          active.role
        )
      }) ?? null
    )
  }, [active, data])

  const handleExport = async () => {
    if (active === null) return
    const exportedAt = new Date().toISOString()
    const envelope = buildMemoryExportEnvelope(active.role, rawActiveRow, exportedAt)
    if (envelope === null) {
      setExportState({ kind: "error" })
      return
    }
    const text = JSON.stringify(envelope, null, 2)
    const file = exportFileName(active.role, exportedAt)
    if (await downloadJson(text, file)) {
      setExportState({ kind: "download", file })
      return
    }
    if (await copyToClipboard(text)) {
      setExportState({ kind: "clipboard" })
      return
    }
    setExportState({ kind: "error" })
  }

  // ── Import: strict client-side parse, confirm dialog, then POST ───────────
  const openImportPicker = () => {
    setImportError(null)
    fileInputRef.current?.click()
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    let text = ""
    try {
      text = await file.text()
    } catch {
      setImportError(t("memory.io.invalidJson"))
      return
    }
    const parsed = parseMemoryImportFile(text)
    if (!parsed.ok) {
      setImportError(importErrorText(parsed.error))
      return
    }
    setImportError(null)
    setPendingImport(parsed)
  }

  const confirmImport = () => {
    if (active === null || !pendingImport.ok) return
    // The UI import is a full replace: buckets missing from the file arrive
    // as empty arrays so the role's memory ends up exactly as exported.
    const buckets: Record<string, MemoryExportEntry[]> = {}
    for (const name of MEMORY_BUCKETS) {
      buckets[name] = pendingImport.buckets[name] ?? []
    }
    importMutation.mutate(
      {
        role: active.role,
        buckets,
        efficacy: pendingImport.efficacy,
        archived: pendingImport.archived,
      },
      {
        onSuccess: (res) => {
          setPendingImport(NO_PENDING_IMPORT)
          setImportOk(res.totalEntries)
          void queryClient.invalidateQueries({ queryKey: SUBAGENTS_QUERY_KEY })
        },
        onError: (err) => {
          setImportError(err.message)
        },
      },
    )
  }

  const importDialogOpen = pendingImport.ok

  return (
    <Card data-testid="settings-memory">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("memory.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("memory.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("memory.state.loading")}</p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("memory.state.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("memory.state.retry")}
            </Button>
          </div>
        ) : roles.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="memory-empty">
            {t("memory.state.empty")}
          </p>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label={t("memory.roleSelector")}
              data-testid="memory-role-selector"
            >
              {roles.map((r) => (
                <Button
                  key={r.role}
                  size="sm"
                  variant={active?.role === r.role ? "default" : "ghost"}
                  className="h-7 px-2 font-mono text-[11px]"
                  onClick={() => setSelected(r.role)}
                  aria-pressed={active?.role === r.role}
                >
                  {r.role}
                </Button>
              ))}
            </div>

            {active !== null && (
              <div className="space-y-2" data-testid={`memory-role-${active.role}`}>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {t("memory.version")} {active.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("memory.totalEntries").replace("{count}", String(active.totalEntries))}
                  </span>
                  {query.trim() !== "" && (
                    <span className="text-xs text-muted-foreground" data-testid="memory-matches">
                      {t("memory.search.matches").replace("{count}", String(hits.matches))}
                    </span>
                  )}
                  {isFetching && (
                    <span className="text-xs text-muted-foreground">
                      {t("memory.state.loading")}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void handleExport()}
                    data-testid="memory-export"
                  >
                    <Download className="mr-1 h-3 w-3" aria-hidden />
                    {t("memory.io.export")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={openImportPicker}
                    data-testid="memory-import"
                  >
                    <FileUp className="mr-1 h-3 w-3" aria-hidden />
                    {t("memory.io.import")}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    data-testid="memory-import-input"
                    onChange={(e) => {
                      void onImportFile(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                </div>

                {exportState.kind === "download" && (
                  <p className="text-xs text-muted-foreground" data-testid="memory-export-status">
                    {t("memory.io.exportSuccessDownload").replace("{file}", exportState.file)}
                  </p>
                )}
                {exportState.kind === "clipboard" && (
                  <p className="text-xs text-muted-foreground" data-testid="memory-export-status">
                    {t("memory.io.exportSuccessClipboard")}
                  </p>
                )}
                {exportState.kind === "error" && (
                  <p className="text-xs text-destructive" data-testid="memory-export-status">
                    {t("memory.io.exportFailed")}
                  </p>
                )}
                {importError !== null && (
                  <p className="text-xs text-destructive" data-testid="memory-import-status">
                    {importError}
                  </p>
                )}
                {importOk !== null && !importDialogOpen && (
                  <p className="text-xs text-muted-foreground" data-testid="memory-import-status">
                    {t("memory.io.importSuccess").replace("{count}", String(importOk))}
                  </p>
                )}

                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("memory.search.placeholder")}
                  aria-label={t("memory.search.label")}
                  className="h-8 text-xs"
                  data-testid="memory-search"
                />

                {hits.buckets.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="memory-search-empty">
                    {t("memory.search.noMatch")}
                  </p>
                ) : (
                  hits.buckets.map((bucket) => (
                    <MemoryBucketCard
                      key={bucket.name}
                      bucket={bucket}
                      efficacy={active.efficacy[bucket.name] ?? null}
                      open={openBuckets[bucket.name] === true}
                      onToggle={() => toggleBucket(bucket.name)}
                      openEntry={openEntry}
                      onToggleEntry={(key) => setOpenEntry((prev) => (prev === key ? null : key))}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open) setPendingImport(NO_PENDING_IMPORT)
        }}
      >
        <DialogContent data-testid="memory-import-dialog">
          <DialogHeader>
            <DialogTitle>{t("memory.io.importConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("memory.io.importConfirmDescription")}</DialogDescription>
          </DialogHeader>
          {pendingImport.ok && (
            <div className="space-y-1" data-testid="memory-import-summary">
              <p className="text-xs font-medium">
                {t("memory.io.importSummaryTotal").replace(
                  "{count}",
                  String(pendingImport.totalEntries),
                )}
              </p>
              <ul className="space-y-0.5">
                {MEMORY_BUCKETS.map((name) => (
                  <li key={name} className="flex items-center justify-between text-xs">
                    <span>{t(`memory.bucket.${name}`)}</span>
                    <span className="font-mono" data-testid={`memory-import-count-${name}`}>
                      {pendingImport.counts[name] ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingImport(NO_PENDING_IMPORT)}
              data-testid="memory-import-cancel"
            >
              {t("memory.io.importCancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={importMutation.isPending}
              onClick={confirmImport}
              data-testid="memory-import-confirm"
            >
              {t("memory.io.importConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/** Map a client-side parse error to its localized message. */
function importErrorText(error: MemoryImportParseError): string {
  const detail = error.detail ?? ""
  switch (error.code) {
    case "invalidJson":
      return t("memory.io.invalidJson")
    case "notObject":
      return t("memory.io.notObject")
    case "missingBuckets":
      return t("memory.io.missingBuckets")
    case "unknownBucket":
      return t("memory.io.unknownBucket").replace("{bucket}", detail)
    case "bucketNotArray":
      return t("memory.io.bucketNotArray").replace("{bucket}", detail)
    case "invalidEntry":
      return t("memory.io.invalidEntry")
        .replace("{bucket}", detail.split(":")[0] ?? "")
        .replace("{index}", detail.split(":")[1] ?? "")
    case "emptyImport":
      return t("memory.io.emptyImport")
  }
}

/**
 * Blob + a[download] save. Returns false when the environment refuses
 * (then the caller falls back to the clipboard).
 */
async function downloadJson(text: string, file: string): Promise<boolean> {
  try {
    const blob = new Blob([text], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = file
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

/** Clipboard fallback for environments without anchor downloads. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** One lucide glyph per memory bucket (decorative — names stay textual). */
const BUCKET_ICONS: Record<MemoryBucketName, typeof MessageSquare> = {
  userFeedback: MessageSquare,
  reviewSuggestions: ClipboardCheck,
  commonErrors: AlertTriangle,
  goodExamples: Star,
}

function MemoryBucketCard(props: {
  bucket: MemoryBucketView
  efficacy: EfficacyLedgerView | null
  open: boolean
  onToggle: () => void
  openEntry: string | null
  onToggleEntry: (key: string) => void
}) {
  const { bucket, efficacy, open, onToggle, openEntry, onToggleEntry } = props
  // Same rule the badge shows, read straight off the ledger the model
  // already derived (no second threshold copy here).
  const skip = efficacy?.wouldSkipUnderEnforce === true
  const [gateOpen, setGateOpen] = useState(false)
  const Icon = BUCKET_ICONS[bucket.name]
  return (
    <div className="rounded border px-2 py-1.5" data-testid={`memory-bucket-${bucket.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <Icon
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
            data-testid={`memory-bucket-icon-${bucket.name}`}
          />
          <p className="text-xs font-medium">{t(`memory.bucket.${bucket.name}`)}</p>
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            {bucket.count}
          </Badge>
          {skip && (
            <button
              type="button"
              className="inline-flex items-center"
              onClick={() => setGateOpen((v) => !v)}
              aria-expanded={gateOpen}
              aria-label={t("memory.gating.showBasis")}
              title={t("memory.gating.basis")}
              data-testid={`memory-gating-${bucket.name}`}
            >
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                {t("memory.gating.wouldSkip")}
              </Badge>
            </button>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1 text-[10px]"
          onClick={onToggle}
          aria-expanded={open}
          data-testid={`memory-bucket-${bucket.name}-toggle`}
        >
          {open ? t("memory.bucket.collapse") : t("memory.bucket.expand")}
        </Button>
      </div>

      {/* Click-to-open tooltip over the gating decision: mean and sample
          count come straight from the efficacy ledger — nothing invented. */}
      {skip && gateOpen && efficacy !== null && (
        <p
          className="mt-1 rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          data-testid={`memory-gating-detail-${bucket.name}`}
        >
          {t("memory.gating.detail", {
            mean: efficacy.mean === null ? "—" : round2(efficacy.mean),
            samples: String(efficacy.injectedCount),
          })}
        </p>
      )}

      {efficacy !== null ? (
        <p
          className="mt-0.5 font-mono text-[10px] text-muted-foreground"
          data-testid={`memory-efficacy-${bucket.name}`}
        >
          {t("memory.efficacy.injectedCount")} {efficacy.injectedCount} ·{" "}
          {t("memory.efficacy.deltaSum")} {round2(efficacy.deltaSum)} · {t("memory.efficacy.mean")}{" "}
          {efficacy.mean === null ? "—" : round2(efficacy.mean)}
        </p>
      ) : (
        bucket.count > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("memory.efficacy.noData")}</p>
        )
      )}

      {!open ? (
        bucket.count === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{t("memory.bucketEmpty")}</p>
        )
      ) : bucket.entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("memory.bucketEmpty")}</p>
      ) : (
        <ul className="mt-1 space-y-1" data-testid={`memory-bucket-${bucket.name}-entries`}>
          {bucket.entries.map((entry, i) => {
            const key = `${bucket.name}:${i}`
            const expanded = openEntry === key
            return (
              <li key={key} className="rounded border border-border/60 px-1.5 py-1">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onToggleEntry(key)}
                  aria-expanded={expanded}
                  data-testid={`memory-entry-${bucket.name}-${i}`}
                >
                  <span className="block break-words text-xs">
                    {expanded ? entry.content : entryPreview(entry.content)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="h-3.5 px-1 font-mono text-[9px]">
                      {entry.mime}
                    </Badge>
                    <span>
                      {t("memory.entry.at")}: {entry.at ?? t("memory.entry.timeUnknown")}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function round2(value: number): string {
  return String(Math.round(value * 100) / 100)
}
