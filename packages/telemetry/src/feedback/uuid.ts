// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * UUID v4 without a node: or npm dependency.
 *
 * Borrowing: OpenHands uses `randomUUID()` per feedback submission so the
 * distinct_id can never be correlated with an email address
 * (OpenHands src/services/telemetry.ts:977). Dashboard hosts may run on
 * insecure origins where `crypto.randomUUID` is unavailable, so fall back to
 * `getRandomValues` and finally `Math.random`.
 */

const HEX = "0123456789abcdef"

function byteToHex(byte: number): string {
  return HEX[(byte >> 4) & 0x0f]! + HEX[byte & 0x0f]!
}

/** Random RFC 4122 version-4 UUID string. */
export function randomUuid(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // version 4 + variant bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  let hex = ""
  for (const byte of bytes) hex += byteToHex(byte)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
