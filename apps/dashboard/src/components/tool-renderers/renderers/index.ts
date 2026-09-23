// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Aggregates every per-tool renderer into the RENDERERS table consumed by
 * ../registry.tsx. One entry per ZCode ToolCallBlocks category: a glyph
 * for the collapsed row and a dedicated Body over that tool's extractor.
 * Tools without an entry fall back to the registry's generic view.
 */

import type { ComponentType } from "react"
import type { ToolCallProps, ToolRendererDef } from "../registry"

import { AGENT_GLYPH, AgentBody } from "./agent"
import { ASK_QUESTION_GLYPH, AskQuestionBody } from "./ask-question"
import { CHANGES_GROUP_GLYPH, ChangesGroupBody } from "./groups"
import { CREATE_WORKFLOW_GLYPH, CreateWorkflowBody } from "./create-workflow"
import { CRON_CREATE_GLYPH, CronCreateBody } from "./cron-create"
import { CUA_GROUP_GLYPH, CuaGroupBody } from "./groups"
import { EDIT_INLINE_DIFF_MAX_LINES, EditInlineDiffBody } from "./edit-inline-diff"
import { ESCALATE_GLYPH, EscalateBody } from "./escalate"
import { EVAL_WORKFLOW_SNIPPET_GLYPH, EvalWorkflowSnippetBody } from "./eval-workflow-snippet"
import { EXECUTE_GROUP_GLYPH, ExecuteGroupBody } from "./groups"
import { EXPLORE_GLYPH, ExploreBody } from "./explore"
import { GET_WORKFLOW_RUN_GLYPH, GetWorkflowRunBody } from "./get-workflow-run"
import { GET_WORKFLOW_RUN_ROSTER_GLYPH, GetWorkflowRunRosterBody } from "./get-workflow-run-roster"
import {
  GET_WORKFLOW_RUN_SITUATION_GLYPH,
  GetWorkflowRunSituationBody,
} from "./get-workflow-run-situation"
import { GOAL_GLYPH, GoalBody } from "./goal"
import { LIST_MODELS_GLYPH, ListModelsBody } from "./list-models"
import { LIST_SAVED_WORKFLOWS_GLYPH, ListSavedWorkflowsBody } from "./list-saved-workflows"
import { LIST_WORKFLOW_RUNS_GLYPH, ListWorkflowRunsBody } from "./list-workflow-runs"
import { MCP_GLYPH, McpBody } from "./mcp"
import { NODE_REPL_GLYPH, NodeReplBody } from "./node-repl"
import { NODE_REPL_IMAGE_GRID_GLYPH, NodeReplImageGridBody } from "./node-repl-image-grid"
import { OFFPEAK_CREATE_GLYPH, OffpeakCreateBody } from "./offpeak-create"
import { PLAN_GUIDANCE_GLYPH, PlanGuidanceBody } from "./plan-guidance"
import { READ_SESSION_CONTEXT_GLYPH, ReadSessionContextBody } from "./read-session-context"
import { RESPOND_TO_COORDINATOR_GLYPH, RespondToCoordinatorBody } from "./respond-to-coordinator"
import {
  RESOLVE_WORKFLOW_QUESTION_GLYPH,
  ResolveWorkflowQuestionBody,
} from "./resolve-workflow-question"
import { RESUME_WORKFLOW_RUN_GLYPH, ResumeWorkflowRunBody } from "./resume-workflow-run"
import { SAVE_WORKFLOW_GLYPH, SaveWorkflowBody } from "./save-workflow"
import { SEARCH_GLYPH, SearchBody } from "./search"
import { SEND_MESSAGE_GLYPH, SendMessageBody } from "./send-message"
import { SKILL_GLYPH, SkillBody } from "./skill"
import { SUBMIT_RESULT_GLYPH, SubmitResultBody } from "./submit-result"
import { SWITCH_MODE_GLYPH, SwitchModeBody } from "./switch-mode"
import { TASK_GLYPH, TaskBody } from "./task"
import { TASK_OUTPUT_GLYPH, TaskOutputBody } from "./task-output"
import { TASK_STOP_GLYPH, TaskStopBody } from "./task-stop"
import { TODO_GLYPH, TodoBody } from "./todo"
import { WEBFETCH_GLYPH, WebfetchBody } from "./webfetch"
import { WORKFLOW_DIAGNOSTICS_GLYPH, WorkflowDiagnosticsBody } from "./workflow-diagnostics"

export type { ToolCallProps, ToolRendererDef }

export const RENDERERS: Record<string, ToolRendererDef> = {
  // pre-existing core tools — glyph-only (generic DefaultBody detail view)
  bash: { glyph: "$" },
  read: { glyph: "›" },
  glob: { glyph: "*" },
  grep: { glyph: "=" },
  permission: { glyph: "-key" },
  lsp: { glyph: "◇" },

  // file changes — inline diff bodies (DiffPreview.extractChange reuse)
  edit: { glyph: "±", Body: EditInlineDiffBody },
  write: { glyph: "+", Body: EditInlineDiffBody },

  // web surface
  webfetch: { glyph: WEBFETCH_GLYPH, Body: WebfetchBody },
  search: { glyph: SEARCH_GLYPH, Body: SearchBody },
  mcp: { glyph: MCP_GLYPH, Body: McpBody },

  // agents & tasks
  agent: { glyph: AGENT_GLYPH, Body: AgentBody },
  task: { glyph: TASK_GLYPH, Body: TaskBody },
  "task-output": { glyph: TASK_OUTPUT_GLYPH, Body: TaskOutputBody },
  "task-stop": { glyph: TASK_STOP_GLYPH, Body: TaskStopBody },
  explore: { glyph: EXPLORE_GLYPH, Body: ExploreBody },
  "plan-guidance": { glyph: PLAN_GUIDANCE_GLYPH, Body: PlanGuidanceBody },

  // coordination
  "ask-question": { glyph: ASK_QUESTION_GLYPH, Body: AskQuestionBody },
  goal: { glyph: GOAL_GLYPH, Body: GoalBody },
  escalate: { glyph: ESCALATE_GLYPH, Body: EscalateBody },
  todo: { glyph: TODO_GLYPH, Body: TodoBody },
  skill: { glyph: SKILL_GLYPH, Body: SkillBody },
  "send-message": { glyph: SEND_MESSAGE_GLYPH, Body: SendMessageBody },
  "submit-result": { glyph: SUBMIT_RESULT_GLYPH, Body: SubmitResultBody },
  "switch-mode": { glyph: SWITCH_MODE_GLYPH, Body: SwitchModeBody },
  "list-models": { glyph: LIST_MODELS_GLYPH, Body: ListModelsBody },
  "read-session-context": { glyph: READ_SESSION_CONTEXT_GLYPH, Body: ReadSessionContextBody },
  "respond-to-coordinator": {
    glyph: RESPOND_TO_COORDINATOR_GLYPH,
    Body: RespondToCoordinatorBody,
  },

  // scheduled work
  "cron-create": { glyph: CRON_CREATE_GLYPH, Body: CronCreateBody },
  "offpeak-create": { glyph: OFFPEAK_CREATE_GLYPH, Body: OffpeakCreateBody },

  // node REPL
  "node-repl": { glyph: NODE_REPL_GLYPH, Body: NodeReplBody },
  "node-repl-image-grid": { glyph: NODE_REPL_IMAGE_GRID_GLYPH, Body: NodeReplImageGridBody },

  // dynamic workflows
  "create-workflow": { glyph: CREATE_WORKFLOW_GLYPH, Body: CreateWorkflowBody },
  "save-workflow": { glyph: SAVE_WORKFLOW_GLYPH, Body: SaveWorkflowBody },
  "get-workflow-run": { glyph: GET_WORKFLOW_RUN_GLYPH, Body: GetWorkflowRunBody },
  "list-saved-workflows": { glyph: LIST_SAVED_WORKFLOWS_GLYPH, Body: ListSavedWorkflowsBody },
  "list-workflow-runs": { glyph: LIST_WORKFLOW_RUNS_GLYPH, Body: ListWorkflowRunsBody },
  "resume-workflow-run": { glyph: RESUME_WORKFLOW_RUN_GLYPH, Body: ResumeWorkflowRunBody },
  "resolve-workflow-question": {
    glyph: RESOLVE_WORKFLOW_QUESTION_GLYPH,
    Body: ResolveWorkflowQuestionBody,
  },
  "get-workflow-run-roster": {
    glyph: GET_WORKFLOW_RUN_ROSTER_GLYPH,
    Body: GetWorkflowRunRosterBody,
  },
  "get-workflow-run-situation": {
    glyph: GET_WORKFLOW_RUN_SITUATION_GLYPH,
    Body: GetWorkflowRunSituationBody,
  },
  "eval-workflow-snippet": { glyph: EVAL_WORKFLOW_SNIPPET_GLYPH, Body: EvalWorkflowSnippetBody },
  "workflow-diagnostics": { glyph: WORKFLOW_DIAGNOSTICS_GLYPH, Body: WorkflowDiagnosticsBody },

  // group renderers — recursive sub-call views
  "execute-group": { glyph: EXECUTE_GROUP_GLYPH, Body: ExecuteGroupBody },
  "changes-group": { glyph: CHANGES_GROUP_GLYPH, Body: ChangesGroupBody },
  "cua-group": { glyph: CUA_GROUP_GLYPH, Body: CuaGroupBody },
}

/** Every tool name with a dedicated renderer (test convenience). */
export const RENDERED_TOOLS: string[] = Object.keys(RENDERERS)

export { EDIT_INLINE_DIFF_MAX_LINES }
