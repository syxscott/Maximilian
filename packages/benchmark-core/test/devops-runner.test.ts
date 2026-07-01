/**
 * Phase 9 — DevOps Runner tests.
 *
 * Tests real bash execution in isolated temp directories.
 * No mocks — actual file system and process execution.
 */

import { describe, it, expect } from "vitest";
import { DevOpsRunner } from "../src/runners/devops-runner.js";
import type { DevOpsTaskContext } from "../src/types.js";

describe("DevOpsRunner", () => {
  const runner = new DevOpsRunner();

  it("executes a simple script and checks file existence", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "output.txt", check: "exists" }],
    };
    const result = runner.executeScript("echo hello > output.txt && echo done", ctx);
    expect(result.passed).toBe(true);
    expect(result.quality).toBe(1);
    expect(result.assertionsPassed).toBe(1);
    expect(result.assertionsTotal).toBe(1);
    expect(result.output).toContain("done");
  });

  it("fails when assertion is not met", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "missing.txt", check: "exists" }],
    };
    const result = runner.executeScript("echo ok", ctx);
    expect(result.passed).toBe(false);
    expect(result.quality).toBe(0);
    expect(result.assertionsPassed).toBe(0);
  });

  it("checks file content with contains assertion", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "out.txt", check: "contains", value: "hello world" }],
    };
    const result = runner.executeScript("echo 'hello world' > out.txt", ctx);
    expect(result.passed).toBe(true);
    expect(result.assertionsPassed).toBe(1);
  });

  it("checks file content with matches (regex) assertion", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "out.json", check: "matches", value: '"count":\\s*\\d+' }],
    };
    const result = runner.executeScript("echo '{\"count\": 42}' > out.json", ctx);
    expect(result.passed).toBe(true);
    expect(result.assertionsPassed).toBe(1);
  });

  it("checks not_exists assertion", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "should-not-exist.txt", check: "not_exists" }],
    };
    const result = runner.executeScript("echo ok", ctx);
    expect(result.passed).toBe(true);
  });

  it("checks executable assertion", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "run.sh", check: "executable" }],
    };
    const result = runner.executeScript("echo '#!/bin/bash' > run.sh && chmod +x run.sh", ctx);
    expect(result.passed).toBe(true);
  });

  it("handles script execution failure", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [],
    };
    const result = runner.executeScript("exit 1", ctx);
    // Script fails but no assertions means quality=1 (vacuously true).
    // However, execSync throws on non-zero exit, so we get an error result.
    expect(result.error).toBeDefined();
  });

  it("writes initial files to sandbox", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {
        "input.txt": "initial content",
        "subdir/nested.txt": "nested content",
      },
      assertions: [
        { path: "input.txt", check: "contains", value: "initial content" },
        { path: "subdir/nested.txt", check: "exists" },
      ],
    };
    const result = runner.executeScript("cat input.txt", ctx);
    expect(result.passed).toBe(true);
    expect(result.assertionsPassed).toBe(2);
  });

  it("handles timeout", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [],
    };
    const result = runner.executeScript("sleep 30", ctx);
    // Should timeout after 10s and return error.
    expect(result.error).toBeDefined();
  }, 15000);

  it("tracks files created by script", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [{ path: "new-file.txt", check: "exists" }],
    };
    const result = runner.executeScript("echo new > new-file.txt", ctx);
    expect(result.filesCreated).toContain("new-file.txt");
  });

  it("returns quality=1 when all assertions pass", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: { "base.txt": "base" },
      assertions: [
        { path: "base.txt", check: "exists" },
        { path: "new.txt", check: "exists" },
        { path: "new.txt", check: "contains", value: "created" },
      ],
    };
    const result = runner.executeScript("echo created > new.txt", ctx);
    expect(result.quality).toBe(1);
    expect(result.assertionsPassed).toBe(3);
  });

  it("returns partial quality when some assertions fail", () => {
    const ctx: DevOpsTaskContext = {
      initialFiles: {},
      assertions: [
        { path: "exists.txt", check: "exists" },
        { path: "missing.txt", check: "exists" },
      ],
    };
    const result = runner.executeScript("echo ok > exists.txt", ctx);
    expect(result.quality).toBe(0.5);
    expect(result.assertionsPassed).toBe(1);
    expect(result.assertionsTotal).toBe(2);
  });
});
