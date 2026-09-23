// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Mention provider system (ZCode prompt-editor mention borrowing).
 *
 * A provider answers one trigger character ("@" for roles/skills, "#"
 * for workspaces) with a filtered suggestion list. Providers are plain
 * factories taking a translate callback so all user-visible copy keeps
 * flowing through i18n — the model layer itself stays pure and testable.
 */

import type { MentionSuggestion } from "@/hooks/useMention"

export interface MentionProvider {
  id: string
  /** Trigger characters this provider answers to. */
  triggers: string[]
  /** Suggestions for the active token (the text after the trigger). */
  list(token: string): MentionSuggestion[]
}

/** The four static agent roles mentionable with "@". */
export const ROLE_TOKENS = ["planner", "coder", "reviewer", "researcher"] as const

export type Translate = (key: string) => string

/**
 * Roles provider — the static four-role catalog. Descriptions are i18n
 * keys under `mentions.roles.<token>.desc`.
 */
export function createRolesProvider(translate: Translate): MentionProvider {
  return {
    id: "roles",
    triggers: ["@"],
    list: (token) =>
      ROLE_TOKENS.filter((role) => role.startsWith(token.toLowerCase())).map((role) => ({
        token: role,
        description: translate(`mentions.roles.${role}.desc`),
      })),
  }
}

/**
 * Skills provider — a static placeholder catalog. The skill list comes
 * from an injected feature-flag getter; when flags are absent or yield
 * nothing, `list` returns [] and the textarea surfaces the empty-state
 * explanation (mentions.skills.empty).
 */
export function createSkillsProvider(
  translate: Translate,
  getSkills?: () => string[],
): MentionProvider {
  return {
    id: "skills",
    triggers: ["@"],
    list: (token) => {
      let skills: unknown
      try {
        skills = getSkills?.()
      } catch {
        skills = undefined
      }
      if (!Array.isArray(skills)) return []
      const q = token.toLowerCase()
      return skills
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .filter((skill) => skill.toLowerCase().startsWith(q))
        .map((skill) => ({
          token: skill,
          description: translate("mentions.skills.placeholderDesc"),
        }))
    },
  }
}

/** Workspaces injectable into the workspaces provider. */
export interface WorkspaceRef {
  id: string
  name?: string
  path?: string
}

/**
 * Mention tokens are constrained to [a-zA-Z0-9_-] by the completion
 * regex — slugify arbitrary workspace names into that alphabet.
 */
export function workspaceToken(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug
}

/**
 * Workspaces provider — answers "#" with the props-injected workspace
 * list; unknown/malformed entries are skipped.
 */
export function createWorkspacesProvider(
  translate: Translate,
  workspaces: WorkspaceRef[],
): MentionProvider {
  return {
    id: "workspaces",
    triggers: ["#"],
    list: (token) => {
      const q = token.toLowerCase()
      return workspaces
        .filter((w) => w !== null && typeof w === "object" && typeof w.id === "string")
        .map((w) => {
          const name = typeof w.name === "string" && w.name ? w.name : w.id
          const tokenSlug = workspaceToken(name) || workspaceToken(w.id)
          return {
            token: tokenSlug,
            description:
              typeof w.path === "string" && w.path ? w.path : translate("mentions.workspaces.desc"),
          }
        })
        .filter((s) => s.token.length > 0 && s.token.toLowerCase().startsWith(q))
    },
  }
}

/** The active trigger match: which trigger char + the token after it. */
export interface TriggerMatch {
  trigger: string
  token: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Find the trigger+token ending exactly at `caret` — generalized version
 * of useMention's "@"-only scanner for the multi-prefix router.
 */
export function activeTrigger(
  text: string,
  caret: number,
  triggers: string[],
): TriggerMatch | null {
  const before = text.slice(0, caret)
  for (const trigger of triggers) {
    const match = new RegExp(`${escapeRegExp(trigger)}([a-zA-Z0-9_-]*)$`).exec(before)
    if (match) return { trigger, token: match[1] ?? "" }
  }
  return null
}

/** Route a trigger character to its provider (first match). */
export function providerForTrigger(
  providers: MentionProvider[],
  trigger: string,
): MentionProvider | null {
  return providers.find((p) => p.triggers.includes(trigger)) ?? null
}

/** All providers answering a trigger, in registration order. */
export function providersForTrigger(
  providers: MentionProvider[],
  trigger: string,
): MentionProvider[] {
  return providers.filter((p) => p.triggers.includes(trigger))
}

/**
 * Merge every provider answering `trigger` into one suggestion pool:
 * "@" pools roles + skills, "#" pools workspaces. Duplicate tokens keep
 * their first entry.
 */
export function poolForTrigger(
  providers: MentionProvider[],
  trigger: string,
  token: string,
): MentionSuggestion[] {
  const seen = new Set<string>()
  const out: MentionSuggestion[] = []
  for (const provider of providersForTrigger(providers, trigger)) {
    for (const suggestion of provider.list(token)) {
      if (seen.has(suggestion.token)) continue
      seen.add(suggestion.token)
      out.push(suggestion)
    }
  }
  return out
}

/**
 * Insert (or replace) a completed mention for ANY trigger — the
 * generalized counterpart of useMention's "@"-only insertMention.
 */
export function insertTriggerToken(
  text: string,
  caret: number,
  trigger: string,
  token: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret)
  const match = new RegExp(`${escapeRegExp(trigger)}([a-zA-Z0-9_-]*)$`).exec(before)
  if (!match) return { text, caret }
  const start = caret - match[0].length
  const inserted = `${trigger}${token} `
  return {
    text: `${text.slice(0, start)}${inserted}${text.slice(caret)}`,
    caret: start + inserted.length,
  }
}
