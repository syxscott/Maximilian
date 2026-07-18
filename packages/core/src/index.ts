// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

export * from "./types.js";
export * from "./agent.js";
export * from "./runtime.js";
export * from "./file-memory-store.js";
export * from "./tool-integration.js";
export { Container, TOKENS, type Lifecycle } from "./di.js";
export * from "./model-router.js";
export * from "./embedding-router.js";
export * from "./cost-control.js";
export * from "./selector-adapter.js";
export * from "./routing-bootstrap.js";
export { Flow, type FlowResult, type FlowStatus, type StepFn, type StepContext, type StepOptions } from "./flow.js";
export { StallDetector, type StallDetectorOptions, type ProgressSnapshot, type StallInfo, type ReplanStrategy } from "./stall-detection.js";
export { EventStore, type StoredEvent, type EventReducer, workspaceStatusReducer } from "./event-sourcing.js";
export { PluginManager, type Plugin, type HookName, type HookFn, type PluginContext } from "./plugin-system.js";
export { createGeologicalEngineeringPlugin, type DomainToolCollection, type DomainToolSpec } from "./domain-plugins.js";
export { PermissionAuditLog, type PermissionAuditEntry, type PermissionAuditQuery, type PermissionAuditDecision } from "./permission-audit.js";
export { sanitizeDisplayLabel, DEFAULT_LABEL_MAX_LENGTH, type SanitizeLabelOptions } from "./validation/sanitize-label.js";
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
} from "./phase.js";
export {
  ProfileRegistry,
  BUILT_IN_PROFILES,
  type AgentProfile,
  type RoleRegistry,
  type ToolRegistry,
} from "./profile.js";
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
} from "./sandbox.js";
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
} from "./sandbox-profile.js";
export type {
  SandboxProfile,
  PathPolicy,
  NetworkPolicy,
  SandboxViolation,
} from "./sandbox-profile.js";
// ACP protocol + ExecutionBackend abstraction (mirrors OpenHands Workspace/Sandbox layer)
export * from "./acp/index.js";
export * from "./acp/backend.js";
export type { FailoverReason, ClassifiedError } from "./failover-reason.js";
export { classifyTaskError } from "./failover-reason.js";
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
} from "./reminder.js";
// Claude Code skills loader
export {
  loadClaudeSkills,
  createClaudeSkillsProvider,
  resolveClaudeSkillsDir,
  hasClaudeSkillsDir,
  renderClaudeSkillsPrelude,
  DEFAULT_CLAUDE_SKILLS_DIR,
  type ClaudeSkillsLoaderOptions,
} from "./claude-skills.js";
