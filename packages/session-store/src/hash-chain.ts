// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Message hash chain (minimax-code incremental SHA-256 borrowing).
 *
 * Each chained message commits to `seq + sessionId + role + content +
 * prevHash`, so the per-session rows form a tamper-evident chain: editing
 * or removing any chained row invalidates every link after it. The chain
 * is the "incremental" part — an entry's hash summarizes the whole prior
 * history transitively, exactly like the reference implementation's
 * streaming digest, but persisted per row so verification can be resumed
 * from any database state without rehashing anything but the rows themselves.
 *
 * Serialization is canonical (length-prefixed variable-length fields), the
 * same ambiguity-proof framing as minimax-code's semantic-identity encoder:
 * `sid=3:abc|role=4:user` can never parse as two different field splits, so
 * distinct entries always hash differently.
 */

import { createHash } from "node:crypto"

/**
 * prev_hash of the FIRST chained entry in a session. A fixed sentinel so a
 * legacy segment (hash IS NULL) followed by chained rows verifies exactly
 * like a chain that starts at the session's first message.
 */
export const GENESIS_HASH = "0".repeat(64)

/** One chained entry's hash input, in canonical field order. */
export interface MessageChainEntry {
  /** 1-based position of this message within the session's chain. */
  seq: number
  sessionId: string
  role: string
  content: string
  /** Hash of the previous chained entry (GENESIS_HASH for the first). */
  prevHash: string
}

/**
 * Canonical serialization of a chain entry. Length-prefixing the three
 * variable-length strings makes the encoding injective: no two distinct
 * (seq, sessionId, role, content, prevHash) tuples serialize alike.
 */
export function serializeChainEntry(entry: MessageChainEntry): string {
  return (
    `v1|seq=${entry.seq}` +
    `|sid=${entry.sessionId.length}:${entry.sessionId}` +
    `|role=${entry.role.length}:${entry.role}` +
    `|content=${entry.content.length}:${entry.content}` +
    `|prev=${entry.prevHash}`
  )
}

/** SHA-256 hex digest of one chain entry. */
export function messageChainHash(entry: MessageChainEntry): string {
  return createHash("sha256").update(serializeChainEntry(entry)).digest("hex")
}
