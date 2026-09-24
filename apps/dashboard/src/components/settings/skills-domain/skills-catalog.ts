// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Static built-in capability catalog for the skills domain.
 *
 * HONEST DATA-SOURCE NOTE: the backend has NO skills/tool registry HTTP
 * endpoint yet. This list is a hand-maintained snapshot of the tool
 * artifacts shipped in `packages/tools/src` (the @max/tools package the
 * runtime registers via BUILTIN_TOOLS), each with its @max/llm ToolKind.
 * Purposes come from i18n (`skills.tools.<name>`); nothing here is
 * fetched, and no dynamic registry is simulated. When GET /api/skills or
 * a registry endpoint lands, this constant list is replaced by the hook.
 */

export type SkillKind = "read" | "edit" | "search" | "execute"

export interface SkillCatalogEntry {
  name: string
  kind: SkillKind
  /** Source artifact in packages/tools/src — provenance, shown in UI. */
  source: string
  purposeKey: string
}

export const SKILLS_SOURCE_NOTE = "packages/tools/src (BUILTIN_TOOLS snapshot)"

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  { name: "bash", kind: "execute", source: "bash.ts", purposeKey: "skills.tools.bash" },
  {
    name: "bash-stream",
    kind: "execute",
    source: "bash-stream.ts",
    purposeKey: "skills.tools.bashStream",
  },
  { name: "read", kind: "read", source: "read.ts", purposeKey: "skills.tools.read" },
  { name: "write", kind: "edit", source: "write.ts", purposeKey: "skills.tools.write" },
  { name: "edit", kind: "edit", source: "edit.ts", purposeKey: "skills.tools.edit" },
  { name: "glob", kind: "search", source: "glob.ts", purposeKey: "skills.tools.glob" },
  { name: "grep", kind: "search", source: "grep.ts", purposeKey: "skills.tools.grep" },
  { name: "lsp", kind: "read", source: "lsp.ts", purposeKey: "skills.tools.lsp" },
]
