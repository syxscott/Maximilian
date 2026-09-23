// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ArtifactsExplorer (P7) — the workspace file browser (ZCode
 * workspace-file-tree + resource-manager borrowing) over the artifact
 * API: flat artifact names grouped into a directory tree client-side,
 * each leaf opening in the existing ArtifactPreview.
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { chatApi } from "@/api"
import { buildArtifactTree, type ArtifactTreeNode } from "@/lib/artifact-tree"
import { ArtifactPreview } from "./_helpers/ArtifactPreview"

export function ArtifactsExplorer({ workspaceId }: { workspaceId?: string }) {
  useLocale()
  const { data, isLoading } = useQuery({
    queryKey: ["artifacts", workspaceId ?? "none"],
    queryFn: ({ signal }) => chatApi.listArtifacts(workspaceId!, signal),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
  })
  const tree = useMemo(() => buildArtifactTree(data?.artifacts ?? []), [data])
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <Card data-testid="artifacts-explorer">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("artifacts.title")}
          <span className="ml-2 text-xs text-muted-foreground">{data?.artifacts.length ?? 0}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!workspaceId ? (
          <p className="text-xs text-muted-foreground">{t("artifacts.noWorkspace")}</p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : tree.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("artifacts.empty")}</p>
        ) : (
          <div className="space-y-2">
            <TreeNodeList nodes={tree} depth={0} onSelect={setSelected} selected={selected} />
            {selected && <ArtifactView workspaceId={workspaceId} name={selected} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ArtifactView({ workspaceId, name }: { workspaceId: string; name: string }) {
  useLocale()
  const { data, isLoading, error } = useQuery({
    queryKey: ["artifact-content", workspaceId, name],
    queryFn: () => chatApi.readArtifact(workspaceId, name),
    staleTime: 60_000,
  })
  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
  }
  if (error) {
    return <p className="text-xs text-destructive">{t("artifacts.loadFailed")}</p>
  }
  return (
    <div className="rounded-md border p-2" data-testid="artifact-view">
      <p className="mb-1 font-mono text-[10px] text-muted-foreground">{name}</p>
      <ArtifactPreview
        artifact={{ name, mime: guessMime(name), content: data ?? "", workspaceId }}
      />
    </div>
  )
}

const MIME_BY_EXT: Array<[string, string]> = [
  [".md", "text/markdown"],
  [".json", "application/json"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".js", "text/plain"],
  [".mjs", "text/plain"],
  [".css", "text/plain"],
  [".html", "text/plain"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]

function guessMime(name: string): string {
  const lower = name.toLowerCase()
  for (const [ext, mime] of MIME_BY_EXT) {
    if (lower.endsWith(ext)) return mime
  }
  return "text/plain"
}

function TreeNodeList({
  nodes,
  depth,
  onSelect,
  selected,
}: {
  nodes: ArtifactTreeNode[]
  depth: number
  onSelect: (path: string) => void
  selected: string | null
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  return (
    <ul className={depth === 0 ? "space-y-0.5" : "space-y-0.5 border-l border-border/60 pl-3"}>
      {nodes.map((node) => {
        const key = node.artifactPath ?? node.name
        const isDir = node.artifactPath === undefined
        const isCollapsed = collapsed.has(key)
        return (
          <li key={key}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-full justify-start px-1 font-mono text-xs"
              onClick={() =>
                isDir ? setCollapsed(toggle(collapsed, key)) : onSelect(node.artifactPath!)
              }
              aria-expanded={isDir ? !isCollapsed : undefined}
            >
              <span className="mr-1 text-muted-foreground">
                {isDir ? (isCollapsed ? "▸" : "▾") : "·"}
              </span>
              <span className={selected === node.artifactPath ? "font-semibold" : ""}>
                {node.name}
              </span>
            </Button>
            {isDir && !isCollapsed && node.children.length > 0 && (
              <TreeNodeList
                nodes={node.children}
                depth={depth + 1}
                onSelect={onSelect}
                selected={selected}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
