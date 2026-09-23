// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Artifact tree model (P7) — group flat artifact names into a nested
 * tree so the explorer reads like a file browser (ZCode
 * workspace-file-tree borrowing) over the artifacts the backend already
 * serves. Pure and tested.
 */

export interface ArtifactTreeNode {
  /** Path segment (directory name, or file name for leaves). */
  name: string
  /** Full artifact path for leaves; undefined for directories. */
  artifactPath?: string
  children: ArtifactTreeNode[]
}

export function buildArtifactTree(names: string[]): ArtifactTreeNode[] {
  const root: ArtifactTreeNode[] = []
  for (const name of [...names].sort()) {
    const segments = name.split("/").filter((s) => s.length > 0)
    let level = root
    let accumulated = ""
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      accumulated = accumulated ? `${accumulated}/${segment}` : segment
      const isLeaf = i === segments.length - 1
      let node = level.find(
        (n) =>
          n.name === segment &&
          (isLeaf ? n.artifactPath !== undefined : n.artifactPath === undefined),
      )
      if (!node) {
        node = {
          name: segment,
          ...(isLeaf ? { artifactPath: accumulated } : {}),
          children: [],
        }
        level.push(node)
      }
      if (!isLeaf) level = node.children
    }
  }
  return sortTree(root)
}

function sortTree(nodes: ArtifactTreeNode[]): ArtifactTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    const aDir = a.artifactPath === undefined ? 0 : 1
    const bDir = b.artifactPath === undefined ? 0 : 1
    if (aDir !== bDir) return aDir - bDir // directories first
    return a.name.localeCompare(b.name)
  })
  for (const node of sorted) {
    if (node.children.length > 0) node.children = sortTree(node.children)
  }
  return sorted
}
