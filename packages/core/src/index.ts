// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

export * from "./types.js"
export * from "./agent.js"
export * from "./runtime.js"
export * from "./steering.js"
export * from "./prompt-queue.js"
export * from "./file-memory-store.js"
export * from "./tool-integration.js"
export { Container, TOKENS, type Lifecycle } from "./di.js"
export * from "./model-router.js"
export * from "./embedding-router.js"
export * from "./cost-control.js"
export * from "./selector-adapter.js"
export * from "./routing-bootstrap.js"
export {
  Flow,
  type FlowResult,
  type FlowStatus,
  type StepFn,
  type StepContext,
  type StepOptions,
} from "./flow.js"
export {
  EventBus,
  type EventFilter,
  type EventCallback,
  type SubscriptionHandle,
} from "./event-bus.js"
export {
  StallDetector,
  type StallDetectorOptions,
  type ProgressSnapshot,
  type StallInfo,
  type ReplanStrategy,
} from "./stall-detection.js"
// 借鉴 opencode - DOOM_LOOP 同工具循环拦截
export { DOOM_LOOP_THRESHOLD, type ToolLoopInfo } from "./stall-detection.js"
// Session Status FSM (借鉴 opencode - SessionStatus)
export {
  SessionStatusTracker,
  canTransition as canTransitionSessionStatus,
  type SessionStatus,
  type SessionStatusState,
  type RetryAction,
} from "./session-status.js"
// TodoList state machine (借鉴 opencode - SessionTodo)
export { TodoStore } from "./todo.js"
// OpencodeExecutor: Phase 2 — Maximilian Task → opencode serve 适配器
export {
  OpencodeExecutor,
  type OpencodeExecutorOptions,
  type ExecuteResult,
} from "./opencode-executor.js"
// SkillDiscovery (借鉴 opencode - SkillDiscovery)
export {
  pullSkillIndex,
  downloadFile,
  discoverSkills,
  DEFAULT_SKILL_CACHE_DIR,
  CACHE_TTL_MS,
  SKILL_CONCURRENCY,
  FILE_CONCURRENCY,
  type PullOptions,
  type SkillIndex,
  type SkillIndexEntry,
} from "./skill-discovery.js"
export {
  EventStore,
  type StoredEvent,
  type EventReducer,
  workspaceStatusReducer,
} from "./event-sourcing.js"
export {
  PluginManager,
  type Plugin,
  type HookName,
  type HookFn,
  type PluginContext,
} from "./plugin-system.js"
export {
  createGeologicalEngineeringPlugin,
  type DomainToolCollection,
  type DomainToolSpec,
} from "./domain-plugins.js"
export {
  PermissionAuditLog,
  type PermissionAuditEntry,
  type PermissionAuditQuery,
  type PermissionAuditDecision,
} from "./permission-audit.js"
export {
  sanitizeDisplayLabel,
  DEFAULT_LABEL_MAX_LENGTH,
  type SanitizeLabelOptions,
} from "./validation/sanitize-label.js"
export {
  reviewPlan,
  PLAN_REVIEW_DIMENSIONS,
  PLAN_PASS_THRESHOLDS,
  type PlanLike,
  type PlanLikeTask,
  type PlanReview,
  type PlanReviewOptions,
  type PlanReviewDimension,
  type DimensionScorer,
} from "./validation/plan-reviewer.js"
export {
  detectFailures,
  type FailureDetectionResult,
  type FailureMode,
  type FailureSignal,
  type FailureDetectorOptions,
} from "./validation/failure-detector.js"
export {
  SafetyGuardrails,
  type SafetyGuardrailsOptions,
  type SafetyIncident,
  type RiskLevel,
  type ViolationType,
  type ResourceLimits,
} from "./safety/guardrails.js"
export {
  ReproducibilityManager,
  hashObject,
  type ReproducibilityOptions,
  type ReproducibilityReport,
  type EnvironmentSnapshot,
} from "./safety/reproducibility.js"
// Phase + Profile (借鉴 ChatDev / Open Interpreter)
export {
  PhaseRunner,
  defaultGate,
  BUILT_IN_PHASES,
  type Phase,
  type PhaseContext,
  type PhaseVerdict,
  type PhaseResult,
  type Artifact,
  type ChatMessage,
  type PhaseEvent,
} from "./phase.js"
export {
  ProfileRegistry,
  BUILT_IN_PROFILES,
  type AgentProfile,
  type RoleRegistry,
  type ToolRegistry,
} from "./profile.js"
// Sandbox multi-backend (借鉴 OpenHands + Open Interpreter)
export {
  SandboxServiceBase,
  LocalSandboxService,
  DockerSandboxService,
  MacSandboxExecService,
  ProcessSandboxService,
  type SandboxBackend,
  type SandboxOptions,
  type SandboxResult,
  // Legacy interface (backward compat)
  type SandboxStatus,
  type SandboxInfo,
  type SandboxCommandResult,
  type SandboxService,
} from "./sandbox.js"
// SandboxProfile abstraction (借鉴 grok-build sandbox profiles)
export {
  SandboxProfileName,
  SANDBOX_PROFILES,
  SandboxManager,
  isSandboxActive,
  shouldAutoAllowBash,
  getSandboxManager,
  createSandboxBackend,
  isPathAllowed,
} from "./sandbox-profile.js"
export type {
  SandboxProfile,
  PathPolicy,
  NetworkPolicy,
  SandboxViolation,
} from "./sandbox-profile.js"
// ACP protocol + ExecutionBackend abstraction (mirrors OpenHands Workspace/Sandbox layer)
export * from "./acp/index.js"
export * from "./acp/backend.js"
export type { FailoverReason, ClassifiedError } from "./failover-reason.js"
export { classifyTaskError } from "./failover-reason.js"
export {
  PolicyDeniedError,
  POLICY_DENIED_PREFIX,
  isPolicyDeniedError,
  isPolicyDeniedMessage,
} from "./policy-error.js"
// Reminder system (借鉴 grok-build Reminder trait)
export {
  ReminderCollector,
  DEFAULT_REMINDER_POLICY,
  createDefaultSystemReminders,
  createRepeatedCommandReminder,
  createFileEditVerificationReminder,
  createSecurityReminder,
  createBuildTestReminder,
  formatReminder,
  formatReminders,
  toReminderInjection,
  type Reminder,
  type ReminderType,
  type ReminderPriority,
  type ReminderPolicy,
  type ReminderCollector as ReminderCollectorInterface,
  type SystemReminder,
} from "./reminder.js"
// Claude Code skills loader
export {
  loadClaudeSkills,
  createClaudeSkillsProvider,
  resolveClaudeSkillsDir,
  hasClaudeSkillsDir,
  renderClaudeSkillsPrelude,
  DEFAULT_CLAUDE_SKILLS_DIR,
  type ClaudeSkillsLoaderOptions,
} from "./claude-skills.js"
// Production-hardening utilities (borrowed from Shannon, myclaude, agentos).
export {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  type CircuitBreakerOptions,
  type CircuitBreakerStats,
} from "./circuit-breaker.js"
// Multi-provider failover engine (borrowed from kyegomez/swarms + VRSEN/agency-swarm).
export {
  ProviderFailoverOrchestrator,
  ProviderExhaustedError,
  type ProviderFailoverConfig,
  type LLMProvider,
  type ProviderEntry,
  type FailoverEvent,
} from "./provider-failover.js"
export { maskHeaders, maskBody, maskString } from "./log-mask.js"
export {
  HotReloadConfig,
  type ConfigListener,
  type HotReloadConfigOptions,
} from "./hot-reload-config.js"
export {
  BatchedPersister,
  type BatchedPersisterOptions,
  type BatchedPersisterStats,
} from "./batched-persist.js"
// ROMA pattern — immutable TaskNode + validated state machine + depth guard
// (borrowed from sentient-agi/ROMA task_node.py + atomizer.py).
export {
  TaskStatus,
  NodeType,
  TaskType,
  TaskNodeImpl,
  IllegalTransitionError,
  createTaskNode,
  transition,
  withResult,
  withError,
  withChild,
  withDependency,
  shouldForceExecute,
  canTransition,
  isTerminal,
  terminalStates,
} from "./task-node.js"
export type { TaskNode, TaskNodeOptions, StateTransition } from "./task-node.js"
export {
  atomizeTask,
  buildSubTasks,
  attachSubTasks,
  aggregateResults,
  defaultAtomize,
} from "./atomizer.js"
export type { AtomizeFn, AtomizeDecision, SubTaskSpec, BuildDagResult } from "./atomizer.js"
// ROMA recursive decomposition runner (borrowed from sentient-agi/ROMA
// solve.py + atomizer.py + runtime.py). Opt-in via RecursivePhaseRunner.
export {
  RecursivePhaseRunner,
  type RecursivePhaseDeps,
  type RecursiveStats,
  type RecursiveRunResult,
  type RecursiveRunnerEvent,
} from "./recursive-phase-runner.js"
// Teams-First orchestration engine (borrowed from Yeachan-Heo/oh-my-claudecode
// teams-first architecture: shared memory per team, delegation with readable IDs,
// fallback chains across teams, human escalation when all exhausted).
export { TeamOrchestrator, generateReadableId } from "./team-orchestrator.js"
export type {
  Team,
  TeamMemory,
  FactRecord,
  DecisionRecord,
  DelegationRequest,
  DelegationResult,
  TeamOrchestratorOptions,
  TeamOrchestratorEvent,
} from "./team-orchestrator.js"

// Session export (borrowed from pi export-html template)
export { exportSessionToHtml } from "./session-export.js"
export type { ExportSessionOptions } from "./session-export.js"
