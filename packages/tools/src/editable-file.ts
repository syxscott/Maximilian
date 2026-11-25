// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) OpenCode packages/core/src/file-mutation.ts:49-73 — text
// that is about to be rewritten must pass a UTF-8 validity gate first.
// Node's utf-8 decoding silently replaces every invalid byte with U+FFFD,
// so decoding and writing back would permanently destroy the original bytes.

import { isUtf8 } from "node:buffer"
import { readFile } from "node:fs/promises"
import { ToolFailure } from "@max/llm"

/**
 * Read a file that will be rewritten as text. Throws a {@link ToolFailure}
 * when the file is not valid UTF-8; the caller must leave it untouched.
 */
export async function readEditableText(filePath: string): Promise<string> {
  return decodeEditableText(filePath, await readFile(filePath))
}

/** Decode bytes that will be rewritten as text, refusing invalid UTF-8. */
function decodeEditableText(filePath: string, bytes: Uint8Array): string {
  if (!isUtf8(bytes)) {
    throw new ToolFailure({
      message:
        `Refusing to rewrite ${filePath}: it is not valid UTF-8. ` +
        "Rewriting it as text would replace every invalid byte with U+FFFD and permanently lose the original data. " +
        "Use a tool that preserves the bytes, or convert the file to UTF-8 first.",
      metadata: { path: filePath },
    })
  }
  return Buffer.from(bytes).toString("utf-8")
}
