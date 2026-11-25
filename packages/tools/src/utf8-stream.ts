// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) OpenCode packages/core/src/shell.ts:1134-1149 — one
// StringDecoder per output stream holds an incomplete multi-byte UTF-8
// sequence across chunk boundaries instead of replacing it with U+FFFD
// on every chunk.

import { StringDecoder } from "node:string_decoder"

export interface Utf8StreamDecoder {
  /** Decode one chunk; an incomplete trailing sequence is held back. */
  push(chunk: Buffer): string
  /** Flush at stream end; a truncated tail becomes U+FFFD. */
  end(): string
}

/**
 * Create a decoder that owns the cross-chunk state for a single stream.
 * A reader must call {@link Utf8StreamDecoder.push} for every chunk and
 * {@link Utf8StreamDecoder.end} once the stream closes.
 */
export function createUtf8StreamDecoder(): Utf8StreamDecoder {
  const decoder = new StringDecoder("utf8")
  return {
    push: (chunk: Buffer) => decoder.write(chunk),
    end: () => decoder.end(),
  }
}
