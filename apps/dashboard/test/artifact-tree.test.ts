// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect } from "vitest"
import { buildArtifactTree } from "../src/lib/artifact-tree"

describe("buildArtifactTree", () => {
  it("groups flat artifact names into a sorted directory tree", () => {
    const tree = buildArtifactTree([
      "src/components/Button.tsx",
      "src/lib/util.ts",
      "README.md",
      "src/api.ts",
    ])
    // Directories sort before files at each level, alphabetical within.
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"])
    const dirNode = tree[0]!
    expect(dirNode.artifactPath).toBeUndefined()
    expect(dirNode.children.map((n) => n.name)).toEqual(["components", "lib", "api.ts"])
    const components = dirNode.children.find((n) => n.name === "components")!
    expect(components.children[0]).toMatchObject({
      name: "Button.tsx",
      artifactPath: "src/components/Button.tsx",
    })
  })

  it("handles empty input and duplicate-free single files", () => {
    expect(buildArtifactTree([])).toEqual([])
    const tree = buildArtifactTree(["a.md"])
    expect(tree[0]).toMatchObject({ name: "a.md", artifactPath: "a.md", children: [] })
  })
})
