// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * FileChangesPanel — the diff review flow (ZCode GUI borrowing: the git
 * action menu / workspace file-changes view). Lists every edit/write tool
 * call from the workspace event stream, each expandable into the same
 * DiffPreview the permission dialog uses — one extraction path, so the
 * review view and the approval view can never disagree about a diff.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { deriveFileChanges } from "@/lib/agent-events"
import { extractChange, DiffPreview } from "@/components/_helpers/DiffPreview"
import type { RuntimeEvent } from "@/api"

export function FileChangesPanel({ events }: { events: RuntimeEvent[] }) {
  useLocale()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const changes = useMemo(() => {
    return deriveFileChanges(events)
      .map((change) => ({ ...change, extracted: extractChange(change.tool, change.input) }))
      .filter((change) => change.extracted !== null)
  }, [events])

  const target = (input: unknown): string => {
    const obj = (input ?? {}) as Record<string, unknown>
    const p = obj.file_path ?? obj.path ?? obj.filePath
    return typeof p === "string" ? p : t("files.unknownTarget")
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t("files.title")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {changes.length} {t("files.changeCount")}
        </span>
      </CardHeader>
      <CardContent>
        {changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("files.empty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="file-changes-list">
            {changes.map((change, i) => (
              <li key={i} className="rounded-md border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start font-mono text-xs"
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                >
                  <span className="mr-2 text-muted-foreground">
                    {change.tool === "edit" ? "±" : "+"}
                  </span>
                  <span className="truncate">{target(change.input)}</span>
                  <span className="ml-auto text-muted-foreground">{change.taskId}</span>
                </Button>
                {openIndex === i && change.extracted && (
                  <div className="px-2 pb-2">
                    <DiffPreview tool={change.tool} input={change.input} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
