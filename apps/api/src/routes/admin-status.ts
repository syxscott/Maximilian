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
import { getConfig } from "@max/config"
import { Vault } from "@max/core"
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
