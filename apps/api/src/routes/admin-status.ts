// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Admin system routes — read-only status surfaces for the settings
 * center: credential-vault state and the curated oracle-lessons corpus.
 * Neither endpoint ever returns secret material.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getConfig } from "@max/config"
import { Vault } from "@max/core"
import type { EvolutionFacade } from "@max/evolution"
import { sessionStoreStatusHandler } from "./system.js"
import { ErrorSchema } from "../schemas.js"

// ── Vault status ────────────────────────────────────────────────────────────

const vaultStatusRoute = createRoute({
  method: "get",
  path: "/system/vault",
  tags: ["system"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            configured: z.boolean(),
            path: z.string().nullable(),
            open: z.boolean(),
            /** Entry metadata only — titles and timestamps, never secrets. */
            entries: z.array(
              z.object({
                title: z.string(),
                createdAt: z.string(),
                providerPreset: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "Credential vault status (no secrets)",
    },
  },
})

export function vaultStatusHandler() {
  return async (c: Context) => {
    const config = getConfig()
    const vaultPath = config.MAXIMILIAN_VAULT_PATH ?? null
    if (!vaultPath || !config.MAXIMILIAN_VAULT_PASSPHRASE) {
      return c.json({ configured: false, path: null, open: false, entries: [] })
    }
    try {
      const vault = new Vault(vaultPath, config.MAXIMILIAN_VAULT_PASSPHRASE)
      await vault.load()
      const entries = vault.list().map((e) => ({
        title: e.title,
        createdAt: e.createdAt,
        providerPreset: e.title.startsWith("provider:") ? e.title.slice("provider:".length) : null,
      }))
      return c.json({ configured: true, path: vaultPath, open: true, entries })
    } catch {
      // Wrong passphrase or unreadable file — report configured-but-closed
      // so the settings UI can prompt without leaking the failure mode.
      return c.json({ configured: true, path: vaultPath, open: false, entries: [] })
    }
  }
}

// ── Oracle lessons browser ──────────────────────────────────────────────────

const oracleLessonsRoute = createRoute({
  method: "get",
  path: "/evolution/oracle-lessons",
  tags: ["evolution"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            configured: z.boolean(),
            dir: z.string().nullable(),
            lessons: z.array(
              z.object({
                role: z.string(),
                content: z.string(),
                bytes: z.number(),
              }),
            ),
          }),
        },
      },
      description: "Curated oracle lessons (read-only corpus browser)",
    },
  },
})

export function oracleLessonsHandler() {
  return async (c: Context) => {
    const config = getConfig()
    const dir = config.EVOLUTION_ORACLE_LESSONS_DIR ?? null
    if (!dir) return c.json({ configured: false, dir: null, lessons: [] })
    let names: string[] = []
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md")).sort()
    } catch {
      return c.json({ configured: true, dir, lessons: [] })
    }
    const lessons = await Promise.all(
      names.map(async (name) => {
        const content = await fs.readFile(path.join(dir, name), "utf8")
        return { role: name.replace(/\.md$/, ""), content, bytes: Buffer.byteLength(content) }
      }),
    )
    return c.json({ configured: true, dir, lessons })
  }
}

export { vaultStatusRoute, oracleLessonsRoute }

// ── Migration candidates status ─────────────────────────────────────────────

const migrationsStatusRoute = createRoute({
  method: "get",
  path: "/system/migrations",
  tags: ["system"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            api: z.object({
              /** Routes in the contract snapshot; null when unreadable. */
              openapiRoutes: z.number().int().nonnegative().nullable(),
            }),
            sessionStore: z.object({
              available: z.boolean(),
              schemaVersion: z.number().int().nonnegative().nullable(),
              tables: z.record(z.string(), z.number().int().nonnegative().nullable()),
            }),
            i18n: z.object({
              /** Locale JSON files found in packages/i18n; null when unreadable. */
              locales: z.number().int().nonnegative().nullable(),
              /** Keys in the core en-US dictionary; null when unreadable. */
              coreKeys: z.number().int().nonnegative().nullable(),
            }),
          }),
        },
      },
      description: "Migration-candidate sizing (contract routes / store schema / i18n core)",
    },
  },
})

export interface MigrationsStatusDeps {
  /** The live SessionStore, or undefined when the side store is disabled. */
  store?: unknown
}

/** Resolve this route file → candidate paths relative to the api package. */
function here(...segments: string[]): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), ...segments)
}

/**
 * First candidate that exists, or null. Deployment shapes differ (tsx from
 * src, tsc into dist, standalone bundle) so several relative anchors are
 * tried — and when none resolves the answer is honestly null, never a
 * guessed constant.
 */
async function firstReadableJson(...candidates: string[]): Promise<unknown | null> {
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, "utf8")
      return JSON.parse(text) as unknown
    } catch {
      // Try the next anchor; fall through to null.
    }
  }
  return null
}

/** Read a directory listing defensively; null when unreadable. */
async function safeReaddir(dir: string): Promise<string[] | null> {
  try {
    return await fs.readdir(dir)
  } catch {
    return null
  }
}

export function migrationsStatusHandler(deps: MigrationsStatusDeps) {
  return async (c: Context) => {
    // API surface size: the checked-in contract snapshot (openapi-paths.json,
    // regenerated by `pnpm --filter @max/api contract:update`). Anchored to
    // this module — routes/ sits one level below the package root in both
    // the tsx/src and tsc/dist layouts — with cwd anchors as fallback.
    const snapshot = (await firstReadableJson(
      here("..", "..", "openapi-paths.json"),
      path.join(process.cwd(), "apps", "api", "openapi-paths.json"),
      path.join(process.cwd(), "openapi-paths.json"),
    )) as string[] | null
    const openapiRoutes = Array.isArray(snapshot) ? snapshot.length : null

    // Session store: reuse the exact query logic of GET /system/session-store
    // by invoking its handler against a minimal json-only context shim —
    // the handler only ever calls c.json(...).
    const storeHandler = sessionStoreStatusHandler({ store: deps.store })
    const storeBody = (await storeHandler({
      json: (body: unknown) => body,
    } as unknown as Context)) as {
      available?: unknown
      schemaVersion?: unknown
      tables?: unknown
    }
    const sessionStore = {
      available: storeBody?.available === true,
      schemaVersion:
        typeof storeBody?.schemaVersion === "number" && storeBody.schemaVersion > 0
          ? storeBody.schemaVersion
          : null,
      tables:
        storeBody?.tables != null && typeof storeBody.tables === "object"
          ? (storeBody.tables as Record<string, number | null>)
          : {},
    }

    // i18n core dictionary: packages/i18n/src/locales lives three/four levels
    // above this file depending on the run layout; a standalone deploy ships
    // neither, and the route then reports null (the UI renders "unknown").
    const localesDirCandidates = [
      here("..", "..", "..", "..", "packages", "i18n", "src", "locales"),
      here("..", "..", "..", "..", "..", "packages", "i18n", "src", "locales"),
      path.join(process.cwd(), "packages", "i18n", "src", "locales"),
      path.join(process.cwd(), "..", "packages", "i18n", "src", "locales"),
    ]
    let localesDir: string | undefined
    for (const dir of localesDirCandidates) {
      if (await dirExists(dir)) {
        localesDir = dir
        break
      }
    }
    let locales: number | null = null
    let coreKeys: number | null = null
    if (localesDir !== undefined) {
      const files = await safeReaddir(localesDir)
      if (files !== null) {
        locales = files.filter((f) => f.endsWith(".json")).length
        const core = (await firstReadableJson(path.join(localesDir, "en-US.json"))) as Record<
          string,
          unknown
        > | null
        if (core !== null) coreKeys = Object.keys(core).length
      }
    }

    return c.json({
      api: { openapiRoutes },
      sessionStore,
      i18n: { locales, coreKeys },
    })
  }
}

/** Async existence probe for a directory. */
async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

export { migrationsStatusRoute }

// ── Role memory import (real write-back over facade.profiles) ───────────────
//
// The dashboard memory domain can export a role's memory JSON; this is the
// matching import endpoint. Validation is strict on purpose — the payload
// replaces live prompt-injection material, so a structurally invalid file is
// rejected with 400 instead of being coerced into the store.

/** The four active memory buckets (mirrors @max/evolution AgentMemory). */
const MEMORY_BUCKET_KEYS = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
] as const

/** Hard per-bucket ceiling — imports are admin maintenance, not bulk loads. */
const MEMORY_IMPORT_BUCKET_CAP = 500

const MemoryEntryInputSchema = z.object({
  content: z.string().min(1),
  mime: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
})

const MemoryBucketsInputSchema = z
  .object({
    userFeedback: z.array(MemoryEntryInputSchema).max(MEMORY_IMPORT_BUCKET_CAP).optional(),
    reviewSuggestions: z.array(MemoryEntryInputSchema).max(MEMORY_IMPORT_BUCKET_CAP).optional(),
    commonErrors: z.array(MemoryEntryInputSchema).max(MEMORY_IMPORT_BUCKET_CAP).optional(),
    goodExamples: z.array(MemoryEntryInputSchema).max(MEMORY_IMPORT_BUCKET_CAP).optional(),
  })
  .refine((buckets) => MEMORY_BUCKET_KEYS.some((key) => (buckets[key]?.length ?? 0) > 0), {
    message: "import contains no entries",
  })

const MemoryEfficacyInputSchema = z.record(
  z.object({
    injectedCount: z.number().int().nonnegative(),
    deltaSum: z.number(),
  }),
)

const MemoryImportBodySchema = z
  .object({
    buckets: MemoryBucketsInputSchema,
    /** Optional ledger restore; omitted → the role keeps its current ledger. */
    efficacy: MemoryEfficacyInputSchema.optional(),
    /** Curator quarantine restore; omitted → the role keeps its archive. */
    archived: z.record(z.array(MemoryEntryInputSchema)).optional(),
  })
  .passthrough()

const memoryImportRoute = createRoute({
  method: "post",
  path: "/evolution/agents/{role}/memory-import",
  tags: ["evolution"],
  request: {
    params: z.object({ role: z.string().min(1) }),
    body: { content: { "application/json": { schema: MemoryImportBodySchema } } },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.literal(true),
            role: z.string(),
            imported: z.record(z.string(), z.number()),
            totalEntries: z.number().int().nonnegative(),
          }),
        },
      },
      description: "Memory imported (per-bucket entry counts written)",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid memory structure",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Profile not found for role",
    },
  },
})

export interface MemoryImportDeps {
  facade: EvolutionFacade
}

/**
 * Handler factory for POST /evolution/agents/{role}/memory-import. Bucket
 * semantics: a bucket key present in the body replaces that bucket's entries
 * wholesale; keys left out keep the role's current entries (the dashboard
 * always sends all four, so its import is a full replace — the API stays
 * minimally destructive for partial payloads). `efficacy` / `archived` are
 * restored only when the body carries them; `totalEntries` is recomputed
 * from the resulting buckets.
 */
export function memoryImportHandler(deps: MemoryImportDeps) {
  return async (c: Context) => {
    const role = c.req.param("role")
    if (!role) return c.json({ error: "Missing role" }, 400)

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }
    const parsed = MemoryImportBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue?.path.length ? ` at ${issue.path.join(".")}` : ""
      return c.json({ error: `Invalid memory import: ${issue?.message ?? "unknown"}${where}` }, 400)
    }

    const profile = await deps.facade.profiles.get(role)
    if (!profile) return c.json({ error: "Profile not found" }, 404)

    const buckets = parsed.data.buckets
    const nextMemory = {
      ...profile.memory,
      userFeedback: buckets.userFeedback ?? profile.memory.userFeedback,
      reviewSuggestions: buckets.reviewSuggestions ?? profile.memory.reviewSuggestions,
      commonErrors: buckets.commonErrors ?? profile.memory.commonErrors,
      goodExamples: buckets.goodExamples ?? profile.memory.goodExamples,
      efficacy: parsed.data.efficacy ?? profile.memory.efficacy,
      archived: parsed.data.archived ?? profile.memory.archived,
    }
    nextMemory.totalEntries = MEMORY_BUCKET_KEYS.reduce(
      (sum, key) => sum + nextMemory[key].length,
      0,
    )
    await deps.facade.profiles.save({ ...profile, memory: nextMemory })

    return c.json({
      ok: true as const,
      role,
      imported: Object.fromEntries(
        MEMORY_BUCKET_KEYS.map((key) => [key, buckets[key]?.length ?? 0]),
      ),
      totalEntries: nextMemory.totalEntries,
    })
  }
}

export { memoryImportRoute }
