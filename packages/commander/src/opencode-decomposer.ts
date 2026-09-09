// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * OpencodeDecomposer — Phase 3c: commander LLM + opencode preflight (借鉴 opencode).
 *
 * Flow:
 *   1. Run the planner LLM to decompose `userRequest` into a Plan
 *      (rationale + tasks + tracks).
 *   2. Materialize each task into a full `Task` (deterministic ids).
 *   3. Route every task through `OpencodeExecutor.executeTask()` as a
 *      pre-flight probe. The executor returns a real `Result` from
 *      opencode serve; we cache the trimmed output + sessionId in
 *      `task.metadata.preflightResult`.
 *   4. Aggregate executor failures / empty outputs into `PreflightIssue[]`
 *      and return the enriched plan with `preflight: { passed, issues }`.
 *
 * Rationale (借鉴 opencode - server-side plan validation):
 *   opencode has been moving its planning primitives server-side so the
 *   executor can sanity-check each task before the client commits. We
 *   mirror that with `OpencodeDecomposer`: the planner LLM proposes a
 *   plan, but opencode gets the last word.
 *
 * Constraints:
 *   - Native fetch + zod. No extra deps.
 *   - Type-safe (z.infer-validated shapes).
 *   - Self-contained: does NOT depend on `Commander` in `index.ts`, so the
 *     Commander class stays unchanged and existing tests stay green.
 */

import { z } from "zod";
import type { Provider, ChatMessage } from "@max/providers";
import type { OpencodeExecutor, Task, AgentRole } from "@max/core";
import { getLogger } from "@max/telemetry";

const log = getLogger("commander:opencode-decomposer");

/** Timeout for planner LLM calls in milliseconds. */
const LLM_TIMEOUT_MS = 60_000;

/**
 * Planner system prompt.
 * Mirrors `Commander.PLANNER_SYSTEM_PROMPT` in `index.ts` (kept in sync
 * manually — both files describe the same planner role. We duplicate
 * here to keep the modules decoupled).
 */
const PLANNER_SYSTEM_PROMPT = `You are the Commander (planner) of a multi-agent system.

Given a user request, decompose it into a sequence of tasks. Each task must be
assigned to one of these roles based on the agent's declared capabilities.

## Available agents and their capabilities

- "backend": server-side code generation.
  Strengths: REST APIs, DB schemas, auth, business logic, migrations, integrations.
  Use for: any server-side / API / database request.
- "frontend": client-side code generation.
  Strengths: HTML/CSS/JS, UI components, single-file demos, browser interaction.
  Use for: any UI / page / user-facing request.
- "general": anything else (configs, docs, scripts, plain text).
  Default fallback when neither backend nor frontend clearly fits.
- "review": critique-only; reviews all prior outputs and returns a JSON verdict.
  ALWAYS last; depends on every prior task.

## Task fields

For each task, output:
- "agentRole": one of "backend" | "frontend" | "general" (review is appended automatically if missing)
- "description": self-contained task description (the agent sees only its own description + prior results)
- "dependsOn": array of task-ids this task depends on (empty if no dependency)
- "estimatedComplexity": "simple" | "medium" | "complex"
  - simple: a one-line change, rename, trivial fix (< 80 chars description OR explicit keywords like "fix typo", "rename")
  - complex: refactor, migration, performance, security, architecture (> 500 chars OR keywords like "refactor", "migrate", "design system")
  - medium: anything in between
- "preferredCapabilities": array of capability tags this task needs (free-form strings drawn from the agent's strength list above; e.g. ["api-design", "auth"], ["ui-rendering"], ["docs"])
- "ownedFiles" (optional): array of file paths this task exclusively owns (借鉴 parallel-feature-development). When set, no other task should modify these files.
- "condition" (optional): a string describing what state must be true before this task runs (借鉴 autogen DiGraph condition). The condition is checked by the runtime against prior task outputs.

Also output a top-level "tracks" field (optional): array of track objects describing phased work (借鉴 conductor tracks.md):
- "id": unique track identifier
- "name": display name
- "description": what this track covers
- "phases": array of phase names/descriptions

Always end with a "review" task that depends on all prior tasks (the runtime appends it automatically if missing).

Output MUST be a single JSON object (no markdown fences) with this exact shape:
{
  "rationale": "<one paragraph explaining the plan and why these capabilities/agents fit>",
  "tasks": [
    {
      "agentRole": "backend" | "frontend" | "general",
      "description": "<clear, actionable task description>",
      "dependsOn": ["<task-id>"],
      "estimatedComplexity": "simple" | "medium" | "complex",
      "preferredCapabilities": ["<capability-tag>", ...]
    },
    ...
  ]
}

Rules:
1. 1 to 5 production tasks maximum (excluding review).
2. Each task description is self-contained.
3. Match each task's agentRole to the agent whose declared capability best fits the task.
4. The "preferredCapabilities" tags should describe what kind of work the task needs (drawn from the agent's strength list, e.g. ["api-design"], ["ui-rendering"]).
5. The "estimatedComplexity" guides model selection — be honest about task difficulty.
6. For a typical "build a Todo web app" request: 1 backend + 1 frontend + 1 review.
7. For pure-doc requests: 1 general + 1 review.
`;

// ============================================================================
// Preflight Issue (借鉴 opencode - server preflight validation)
// ============================================================================

export const PreflightSeveritySchema = z.enum(["error", "warning"]);
export type PreflightSeverity = z.infer<typeof PreflightSeveritySchema>;

export const PreflightIssueSchema = z.object({
  severity: PreflightSeveritySchema,
  /** Which task surfaced this issue. */
  taskId: z.string(),
  /** Short machine-readable code (e.g. "EXECUTOR_FAILURE", "EMPTY_OUTPUT"). */
  code: z.string(),
  /** Human-readable message. */
  message: z.string(),
});
export type PreflightIssue = z.infer<typeof PreflightIssueSchema>;

export const PreflightReportSchema = z.object({
  /** True iff no `error`-severity issues were raised. */
  passed: z.boolean(),
  issues: z.array(PreflightIssueSchema),
});
export type PreflightReport = z.infer<typeof PreflightReportSchema>;

// ============================================================================
// OpencodePlannerOutput — PlannerOutput + preflight (借鉴 opencode - plan validation payload)
// ============================================================================

export const OpencodePlannerOutputSchema = z.object({
  rationale: z.string(),
  tasks: z.array(
    z.object({
      agentRole: z.enum(["frontend", "backend", "review", "general"]),
      description: z.string(),
      dependsOn: z.array(z.string()),
      estimatedComplexity: z.enum(["simple", "medium", "complex"]).optional(),
      preferredCapabilities: z.array(z.string()).optional(),
      ownedFiles: z.array(z.string()).optional(),
      condition: z.string().optional(),
      /** Cached preflight output (sessionId, executor, outputPreview, durationMs). */
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  tracks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        phases: z.array(z.string()),
      }),
    )
    .optional(),
  /** (借鉴 opencode) Preflight report populated from opencode executor runs. */
  preflight: PreflightReportSchema,
});
export type OpencodePlannerOutput = z.infer<typeof OpencodePlannerOutputSchema>;

// ============================================================================
// OpencodeDecomposer
// ============================================================================

/**
 * Di definition for `OpencodeDecomposer`. The executor is mandatory: every
 * `decompose` call routes each task through it. The planner LLM is required
 * too — we don't fall back to a heuristic plan here (the Commander owns that
 * fallback path).
 */
export interface OpencodeDecomposerOptions {
  executor: OpencodeExecutor;
  plannerLlm: Provider;
}

/**
 * Planner-with-preflight.
 *
 * Usage:
 *   const decomposer = new OpencodeDecomposer({ executor, plannerLlm })
 *   const out = await decomposer.decompose("build a todo app", "ws-42")
 *   if (!out.preflight.passed) console.warn(out.preflight.issues)
 */
export class OpencodeDecomposer {
  constructor(private readonly opts: OpencodeDecomposerOptions) {}

  /**
   * Run the planner LLM, materialize tasks, then route each task through
   * `OpencodeExecutor.executeTask` for preflight validation.
   *
   * @param userRequest Free-form user request.
   * @param workspaceId Used by the executor to bucket opencode sessions.
   * @returns PlannerOutput-shaped object plus a populated `preflight` block.
   */
  async decompose(
    userRequest: string,
    workspaceId: string,
  ): Promise<OpencodePlannerOutput> {
    const planner = await this.callPlanner(userRequest);

    // Materialise tasks with deterministic sequential ids (`task-1`, `task-2`, ...).
    const materialised: Task[] = planner.tasks.map((raw, i) => {
      const meta: Record<string, unknown> = {};
      if (raw.estimatedComplexity) meta.estimatedComplexity = raw.estimatedComplexity;
      if (raw.preferredCapabilities && raw.preferredCapabilities.length > 0) {
        meta.preferredCapabilities = raw.preferredCapabilities;
      }
      if (raw.ownedFiles && raw.ownedFiles.length > 0) {
        meta.ownedFiles = raw.ownedFiles;
      }
      if (raw.condition) meta.condition = raw.condition;
      return {
        id: `task-${i + 1}`,
        agentRole: raw.agentRole as AgentRole,
        description: raw.description,
        status: "pending" as const,
        dependsOn: raw.dependsOn,
        ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      };
    });

    // 借鉴 opencode - run each task through the executor and aggregate findings.
    const issues: PreflightIssue[] = [];
    for (const task of materialised) {
      try {
        const { result, sessionId, durationMs } = await this.opts.executor.executeTask(
          task,
          workspaceId,
        );

        // Cache the preflight result on the task metadata. Trim the output
        // so the plan object doesn't bloat with multi-KB strings.
        const baseMeta = (task.metadata ?? {}) as Record<string, unknown>;
        baseMeta.preflightResult = {
          sessionId,
          executor: "opencode",
          durationMs,
          outputPreview: result.output.slice(0, 500),
        };
        task.metadata = baseMeta;

        // Warn (not error) on empty output — empty doesn't necessarily
        // mean failure (e.g. a pure-critique task may legitimately have
        // an empty body) but it's worth surfacing.
        if (!result.output || result.output.trim().length === 0) {
          issues.push({
            severity: "warning",
            taskId: task.id,
            code: "EMPTY_OUTPUT",
            message: `Task "${task.id}" returned an empty output from opencode.`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ taskId: task.id, err: message }, "preflight executor failure");
        issues.push({
          severity: "error",
          taskId: task.id,
          code: "EXECUTOR_FAILURE",
          message: `Task "${task.id}" failed in opencode preflight: ${message}`,
        });
      }
    }

    // Reconstitute the PlannerOutput-shaped `tasks` array with the cached
    // metadata attached. We rebuild from `materialised` so the IDs and
    // metadata stay consistent with what the executor saw.
    const outTasks: OpencodePlannerOutput["tasks"] = materialised.map((t) => {
      const out: OpencodePlannerOutput["tasks"][number] = {
        agentRole: t.agentRole,
        description: t.description,
        dependsOn: t.dependsOn,
        ...(t.metadata?.estimatedComplexity
          ? { estimatedComplexity: t.metadata.estimatedComplexity as "simple" | "medium" | "complex" }
          : {}),
        ...(Array.isArray(t.metadata?.preferredCapabilities)
          ? { preferredCapabilities: t.metadata.preferredCapabilities as string[] }
          : {}),
        ...(Array.isArray(t.metadata?.ownedFiles)
          ? { ownedFiles: t.metadata.ownedFiles as string[] }
          : {}),
        ...(typeof t.metadata?.condition === "string"
          ? { condition: t.metadata.condition }
          : {}),
        ...(t.metadata ? { metadata: t.metadata } : {}),
      };
      return out;
    });

    return {
      rationale: planner.rationale,
      tasks: outTasks,
      ...(planner.tracks && planner.tracks.length > 0 ? { tracks: planner.tracks } : {}),
      preflight: {
        // 借鉴 opencode - opencode server-side preflight passes when no
        // error-severity issues were raised. Warnings don't block.
        passed: issues.every((i) => i.severity !== "error"),
        issues,
      },
    };
  }

  /**
   * Internal: invoke the planner LLM and parse JSON. Mirrors
   * `Commander.callPlanner` semantics (jsonMode + 60s timeout + auto-append
   * review task). Self-contained so this module doesn't pull in `Commander`.
   */
  private async callPlanner(
    userRequest: string,
  ): Promise<{
    rationale: string;
    tasks: Array<{
      agentRole: AgentRole;
      description: string;
      dependsOn: string[];
      estimatedComplexity?: "simple" | "medium" | "complex";
      preferredCapabilities?: string[];
      ownedFiles?: string[];
      condition?: string;
    }>;
    tracks?: Array<{ id: string; name: string; description: string; phases: string[] }>;
  }> {
    // Sanitise: strip CRs, escape backticks + ${} to keep prompt formatting
    // intact (matches Commander.sanitizeUserInput).
    const sanitized = userRequest
      .replace(/\r\n/g, "\n")
      .replace(/`/g, "\\`")
      .replace(/\${/g, "\\${")
      .slice(0, 10_000);

    const messages: ChatMessage[] = [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: sanitized },
    ];

    const response = await Promise.race([
      this.opts.plannerLlm.chat(messages, {
        temperature: 0.3,
        maxTokens: 1500,
        jsonMode: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Planner LLM call timed out")),
          LLM_TIMEOUT_MS,
        ),
      ),
    ]);

    const raw = response.content;
    const json = extractJson(raw);
    if (!json) throw new Error("Planner produced no JSON");

    const parsed = JSON.parse(json) as {
      rationale?: string;
      tasks: Array<{
        agentRole: AgentRole;
        description: string;
        dependsOn: string[];
        estimatedComplexity?: "simple" | "medium" | "complex";
        preferredCapabilities?: string[];
        ownedFiles?: string[];
        condition?: string;
      }>;
      tracks?: Array<{ id: string; name: string; description: string; phases: string[] }>;
    };

    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      throw new Error("Planner JSON missing 'tasks'");
    }

    // Auto-append a review task if the LLM forgot one (matches Commander).
    const last = parsed.tasks[parsed.tasks.length - 1];
    if (!last || last.agentRole !== "review") {
      const reviewDependsOn = parsed.tasks.map((_, i) => `task-${i + 1}`);
      parsed.tasks.push({
        agentRole: "review",
        description: "Review all generated artifacts",
        dependsOn: reviewDependsOn,
      });
    }

    return {
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      tasks: parsed.tasks,
      tracks: parsed.tracks,
    };
  }
}

/**
 * Extract a JSON object from a possibly-padded string.
 * Mirrors the helper used by `Commander` (kept inline to avoid a
 * circular import).
 */
function extractJson(text: string): string | null {
  try {
    JSON.parse(text);
    return text;
  } catch {
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) return null;

    let depth = 0;
    let endBrace = -1;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) {
          endBrace = i;
          break;
        }
      }
    }
    if (endBrace === -1) return null;
    const jsonStr = text.slice(firstBrace, endBrace + 1);
    try {
      JSON.parse(jsonStr);
      return jsonStr;
    } catch {
      return null;
    }
  }
}
