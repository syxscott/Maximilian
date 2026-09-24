/**
 * Workflow routes — multi-step LLM pipelines through the journal-based
 * WorkflowEngine (ZCode dynamic-workflow minimal port).
 *
 *   POST /api/workflows/run      run (or resume) a workflow
 *   GET  /api/workflows/:runId   progress of a run (this process)
 *
 * Each step carries a prompt template; `{input}` is replaced with the
 * chained output of the previous step (or the initial input). The engine
 * short-circuits journaled steps on resume and refuses a changed script
 * (byte-identical resume discipline) — a changed step set answers 409.
 *
 * Journal scope (honest boundary): entries live in a per-process Map, so
 * resume survives retries and page refreshes within THIS api process but
 * not a restart. A SQLite-backed WorkflowJournalPort (session-store
 * events table) is the follow-up when cross-restart resume is needed.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import {
  WorkflowEngine,
  WorkflowScriptChangedError,
  type JournalEntry,
  type WorkflowJournalPort,
} from "@max/workflow-engine"
import type { Provider } from "@max/providers"
import { getLogger } from "@max/telemetry"
import { ErrorSchema } from "../schemas.js"

const log = getLogger("workflows")

const StepSchema = z.object({
  siteId: z.string().min(1),
  phase: z.string().optional(),
  description: z.string().optional(),
  /** Prompt template; `{input}` is replaced with the chained input. */
  prompt: z.string().min(1),
})

const RunRequestSchema = z.object({
  runId: z.string().min(1).optional(),
  steps: z.array(StepSchema).min(1).max(32),
  /** Initial input fed to the first step. */
  input: z.string().default(""),
  /** Chain step outputs (default true). */
  chain: z.boolean().default(true),
})

export type RunRequest = z.infer<typeof RunRequestSchema>

export const workflowRunRoute = createRoute({
  method: "post",
  path: "/workflows/run",
  tags: ["workflows"],
  request: {
    body: { content: { "application/json": { schema: RunRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Workflow report",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    409: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Workflow script changed since the run started",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const workflowListRoute = createRoute({
  method: "get",
  path: "/workflows",
  tags: ["workflows"],
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Known runs in this process (journal summaries)",
    },
  },
})

export const workflowGetRoute = createRoute({
  method: "get",
  path: "/workflows/:runId",
  tags: ["workflows"],
  request: {
    params: z.object({ runId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Run progress (steps completed in this process)",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown run" },
  },
})

/** In-process journal + report registry. See the honest boundary above. */
const journals = new Map<string, JournalEntry[]>()
const reports = new Map<string, unknown>()

function journalFor(runId: string): WorkflowJournalPort {
  const entries = journals.get(runId) ?? []
  journals.set(runId, entries)
  return {
    append: async (_runId, entry) => {
      entries.push(entry)
    },
    readAll: async (_runId) => [...entries],
  }
}

function makeExecutor(provider: Provider) {
  return {
    async executeStep(step: { siteId: string; prompt?: string }, input: unknown): Promise<string> {
      const template = step.prompt ?? String(input ?? "")
      const prompt = template.replaceAll("{input}", String(input ?? ""))
      const res = await provider.chat([{ role: "user", content: prompt }])
      return res.content
    },
  }
}

export function workflowRoutes(deps: { getDefaultProvider: () => Provider }) {
  return {
    list: async (c: Context) => {
      const runs = [...journals.entries()].map(([runId, entries]) => {
        const stepEntries = entries.filter((e) => e.siteId !== "__script_hash__")
        const hashEntry = entries.find((e) => e.siteId === "__script_hash__")
        return {
          runId,
          completedSteps: stepEntries.filter((e) => e.ok).length,
          failedSteps: stepEntries.filter((e) => !e.ok).length,
          totalEntries: entries.length,
          scriptHash:
            typeof hashEntry?.output === "string" ? hashEntry.output.slice(0, 12) : undefined,
        }
      })
      return c.json({ runs })
    },

    run: async (c: Context) => {
      const body = c.req.valid("json" as never) as RunRequest
      const runId = body.runId ?? `wf-${randomUUID().slice(0, 8)}`
      const scriptHash = createHash("sha256").update(JSON.stringify(body.steps)).digest("hex")

      const engine = new WorkflowEngine(journalFor(runId), makeExecutor(deps.getDefaultProvider()))
      try {
        const report = await engine.run(
          runId,
          {
            scriptHash,
            steps: body.steps.map((s) => ({
              siteId: s.siteId,
              phase: s.phase,
              description: s.description,
            })),
          },
          body.input,
          { chain: body.chain },
        )
        reports.set(runId, report)
        return c.json(report as unknown as Record<string, unknown>)
      } catch (err) {
        if (err instanceof WorkflowScriptChangedError) {
          return c.json({ error: (err as Error).message }, 409)
        }
        log.error({ err, runId }, "workflow run failed")
        return c.json({ error: (err as Error).message }, 500)
      }
    },

    get: async (c: Context) => {
      const runId = c.req.param("runId") ?? ""
      const report = reports.get(runId)
      if (report === undefined) {
        const entries = journals.get(runId)
        if (!entries) return c.json({ error: "unknown run" }, 404)
        return c.json({
          runId,
          completed: entries.filter((e) => e.siteId !== "__script_hash__" && e.ok).length,
          entries: entries.length,
        })
      }
      return c.json(report as unknown as Record<string, unknown>)
    },
  }
}
