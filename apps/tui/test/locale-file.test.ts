/**
 * Tests for file-based locale persistence used by the TUI.
 *
 * We point MAXIMILIAN_STATE_DIR at a tmp directory so we don't pollute the
 * developer's real state dir, and verify the read/write/remove round-trip
 * works as advertised to initLocale({ loadFrom, saveTo, removeOnReset }).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  readLocaleFile,
  writeLocaleFile,
  removeLocaleFile,
  stateDir,
} from "../src/util/locale-file";

let tmpDir: string;
let stateDirPath: string;
const originalStateDir = process.env.MAXIMILIAN_STATE_DIR;

beforeEach(() => {
  // Per-test tmp dir so parallel test files don't collide.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "max-tui-locale-"));
  // Point MAXIMILIAN_STATE_DIR at a *sub* directory so tests can verify
  // that writeLocaleFile() creates the directory on demand (the parent
  // tmpDir itself is created by mkdtempSync).
  stateDirPath = path.join(tmpDir, "maximilian");
  process.env.MAXIMILIAN_STATE_DIR = stateDirPath;
});

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.MAXIMILIAN_STATE_DIR;
  } else {
    process.env.MAXIMILIAN_STATE_DIR = originalStateDir;
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("locale-file — stateDir()", () => {
  it("honors MAXIMILIAN_STATE_DIR when set", () => {
    expect(stateDir()).toBe(stateDirPath);
  });
});

describe("locale-file — writeLocaleFile / readLocaleFile", () => {
  it("round-trips a locale tag", () => {
    expect(readLocaleFile()).toBeUndefined();
    writeLocaleFile("zh-CN");
    expect(readLocaleFile()).toBe("zh-CN");
    writeLocaleFile("en-US");
    expect(readLocaleFile()).toBe("en-US");
  });

  it("creates the state directory if missing", () => {
    expect(fs.existsSync(stateDirPath)).toBe(false);
    writeLocaleFile("en-US");
    expect(fs.existsSync(stateDirPath)).toBe(true);
    expect(fs.existsSync(path.join(stateDirPath, "locale"))).toBe(true);
  });

  it("trims surrounding whitespace on read", () => {
    fs.mkdirSync(stateDirPath, { recursive: true });
    fs.writeFileSync(path.join(stateDirPath, "locale"), "  zh-CN\n", "utf8");
    expect(readLocaleFile()).toBe("zh-CN");
  });

  it("returns undefined for an empty file", () => {
    fs.mkdirSync(stateDirPath, { recursive: true });
    fs.writeFileSync(path.join(stateDirPath, "locale"), "", "utf8");
    expect(readLocaleFile()).toBeUndefined();
  });

  it("returns undefined when the file does not exist (ENOENT)", () => {
    expect(readLocaleFile()).toBeUndefined();
  });
});

describe("locale-file — removeLocaleFile", () => {
  it("deletes the file if present", () => {
    writeLocaleFile("en-US");
    expect(fs.existsSync(path.join(stateDirPath, "locale"))).toBe(true);
    removeLocaleFile();
    expect(fs.existsSync(path.join(stateDirPath, "locale"))).toBe(false);
  });

  it("is a no-op when the file is already missing", () => {
    expect(() => removeLocaleFile()).not.toThrow();
  });
});