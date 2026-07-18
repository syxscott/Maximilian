// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Execution backend abstraction (mirrors OpenHands Workspace interface).
 *
 * Defines the contract for sandbox execution environments.
 * Separates LLM Provider (model routing) from execution runtime.
 *
 * OpenHands references:
 *   https://docs.openhands.dev/openhands/usage/sandboxes/overview
 *   https://github.com/All-Hands-AI/OpenHands/blob/main/docs/architecture/Sandbox.md
 */

export interface BackendCapabilities {
  filesystem: boolean;
  terminal: boolean;
  internet: boolean;
  gpu: boolean;
  /** Agent can spawn subprocesses inside the sandbox. */
  subprocess: boolean;
}

export interface BackendHealth {
  status: "healthy" | "degraded" | "down";
  latencyMs?: number;
  error?: string;
}

export interface BackendSession {
  id: string;
  createdAt: number;
  backendId: string;
}

export interface BackendResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface UploadResult {
  path: string;
  size: number;
}

/**
 * Unified interface for execution backends (Process / Docker / VM / Cloud).
 *
 * Currently Maximilian only has LocalSandboxService (child_process).
 * This abstraction enables future Docker/VM/cloud support without changing agent code.
 */
export interface ExecutionBackend {
  readonly id: string;
  readonly type: "process" | "docker" | "vm" | "cloud";
  readonly capabilities: BackendCapabilities;

  health(): Promise<BackendHealth>;

  /** Start a new session and return its id. */
  createSession(cwd?: string): Promise<BackendSession>;

  /** Execute a command in an existing session. */
  execute(
    sessionId: string,
    command: string,
    timeoutMs?: number,
  ): Promise<BackendResult>;

  /** Upload a file into the session sandbox. */
  uploadFile(sessionId: string, path: string, content: string): Promise<UploadResult>;

  /** Download a file from the sandbox. */
  downloadFile(sessionId: string, path: string): Promise<string>;

  /** Pause a running session (hibernate). */
  pause(sessionId: string): Promise<void>;

  /** Resume a paused session. */
  resume(sessionId: string): Promise<void>;

  /** Permanently destroy a session and release resources. */
  destroy(sessionId: string): Promise<void>;
}
