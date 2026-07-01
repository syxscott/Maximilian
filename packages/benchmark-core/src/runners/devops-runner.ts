/**
 * Phase 9 — DevOps Benchmark Runner.
 *
 * Executes agent-generated bash/shell scripts in an isolated temporary
 * directory. Asserts final file system state against expected conditions.
 * No mocks — real file system, real process execution.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DevOpsTaskContext } from "../types.js";

export interface DevOpsExecutionResult {
  passed: boolean;
  quality: number;
  output: string;
  filesCreated: string[];
  filesModified: string[];
  assertionsPassed: number;
  assertionsTotal: number;
  error?: string;
}

export interface FileAssertion {
  path: string;
  check: "exists" | "not_exists" | "contains" | "matches" | "executable";
  value?: string;
}

export class DevOpsRunner {
  /**
   * Execute a bash script in an isolated sandbox and assert final state.
   */
  executeScript(script: string, context: DevOpsTaskContext): DevOpsExecutionResult {
    const sandboxDir = mkdtempSync(join(tmpdir(), "max-devops-"));

    try {
      // 1. Write initial files to sandbox.
      for (const [relPath, content] of Object.entries(context.initialFiles)) {
        const fullPath = join(sandboxDir, relPath);
        // Ensure parent directory exists for nested paths.
        const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (parentDir && !existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(fullPath, content, "utf-8");
      }

      // 2. Snapshot file list before execution.
      const filesBefore = new Set(listFilesRecursive(sandboxDir));

      // 3. Execute the script.
      let output: string;
      try {
        output = execSync(script, {
          cwd: sandboxDir,
          timeout: 10_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          shell: "/bin/bash",
        });
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        return {
          passed: false,
          quality: 0,
          output: execErr.stdout ?? "",
          filesCreated: [],
          filesModified: [],
          assertionsPassed: 0,
          assertionsTotal: context.assertions.length,
          error: execErr.stderr ?? execErr.message ?? "script execution failed",
        };
      }

      // 4. Snapshot file list after execution.
      const filesAfter = new Set(listFilesRecursive(sandboxDir));
      const filesCreated = [...filesAfter].filter((f) => !filesBefore.has(f));
      const filesModified = [...filesAfter].filter((f) => {
        if (!filesBefore.has(f)) return false;
        // Check if mtime changed (rough heuristic).
        try {
          const stat = statSync(join(sandboxDir, f));
          return stat.mtimeMs > Date.now() - 11_000; // within timeout window
        } catch {
          return false;
        }
      });

      // 5. Run assertions.
      let assertionsPassed = 0;
      for (const assertion of context.assertions) {
        if (this.checkAssertion(sandboxDir, assertion)) {
          assertionsPassed++;
        }
      }

      const quality = context.assertions.length > 0
        ? assertionsPassed / context.assertions.length
        : 1;

      return {
        passed: assertionsPassed === context.assertions.length,
        quality,
        output,
        filesCreated,
        filesModified,
        assertionsPassed,
        assertionsTotal: context.assertions.length,
      };
    } catch (err) {
      return {
        passed: false,
        quality: 0,
        output: "",
        filesCreated: [],
        filesModified: [],
        assertionsPassed: 0,
        assertionsTotal: context.assertions.length,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  private checkAssertion(sandboxDir: string, assertion: FileAssertion): boolean {
    const fullPath = join(sandboxDir, assertion.path);

    switch (assertion.check) {
      case "exists":
        return existsSync(fullPath);

      case "not_exists":
        return !existsSync(fullPath);

      case "contains": {
        if (!existsSync(fullPath)) return false;
        const content = readFileSync(fullPath, "utf-8");
        return assertion.value !== undefined && content.includes(assertion.value);
      }

      case "matches": {
        if (!existsSync(fullPath)) return false;
        const content = readFileSync(fullPath, "utf-8");
        if (assertion.value === undefined) return false;
        const regex = new RegExp(assertion.value, "m");
        return regex.test(content);
      }

      case "executable": {
        if (!existsSync(fullPath)) return false;
        const stat = statSync(fullPath);
        // Check if owner execute bit is set.
        return (stat.mode & 0o100) !== 0;
      }

      default:
        return false;
    }
  }
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...listFilesRecursive(join(dir, entry.name), relPath));
      } else {
        results.push(relPath);
      }
    }
  } catch {
    // Directory might not exist or be unreadable.
  }
  return results;
}
