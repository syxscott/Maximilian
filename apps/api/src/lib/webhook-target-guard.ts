// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Webhook target allowlist (same-source port of
 * `packages/gateway/src/adapters.ts::isAllowedWebhookUrl`).
 *
 * Why duplicated instead of imported: apps/api has no dependency on
 * `@max/gateway`, and moving the guard into a neutral package is outside this
 * change. The two implementations must stay in sync — this copy carries the
 * same escape-hatch name (`allowInsecure`) and the same intent: an attacker
 * who can register a webhook subscription must not be able to pivot to
 * loopback services, RFC 1918/4193 networks, link-local addresses, or the
 * cloud metadata endpoint (`169.254.169.254`).
 *
 * Borrowing note: `isAllowedWebhookUrl` semantics borrowed from
 * packages/gateway/src/adapters.ts (gateway webhook adapter SSRF guard);
 * range coverage extended to CGNAT/documentation/reserved blocks and IPv6
 * equivalents.
 *
 * DNS hostnames are best-effort: this guard sees the URL, not the resolved
 * address, so a name that resolves to a private address (or changes its
 * answer between subscribe time and delivery time — DNS rebinding) cannot be
 * caught here. Callers that need stronger guarantees must re-resolve and
 * re-check immediately before connecting.
 */

import { isIP } from "node:net"

export interface WebhookTargetOptions {
  /**
   * Test/development escape hatch (gateway `allowInsecure` borrowing):
   * accept loopback / private / link-local / metadata targets. NEVER enable
   * in production. Tests pass this to exercise delivery against a local
   * server; `publishEvent` and `createSubscription` forward the flag.
   */
  allowInsecure?: boolean
}

export type WebhookTargetVerdict = { ok: true } | { ok: false; reason: string }

/** Reason the target was rejected, or null when it is allowed. */
export function webhookTargetRejectionReason(
  rawUrl: string,
  opts: WebhookTargetOptions = {},
): string | null {
  if (opts.allowInsecure) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return "url is not parseable"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `scheme ${parsed.protocol} is not allowed`
  }

  const rawHost = parsed.hostname.toLowerCase()
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return `host ${host} is loopback or local`
  }

  const ipVersion = isIP(host)
  if (ipVersion === 4) {
    const octets = parseIpv4(host)
    if (octets) {
      const reason = ipv4Reason(octets)
      if (reason) return reason
    }
    return null
  }
  if (ipVersion === 6) {
    const groups = parseIpv6(host)
    if (!groups) return "host is an unparseable IPv6 literal"
    const reason = ipv6Reason(groups)
    if (reason) return reason
    return null
  }

  // Public DNS name — see the DNS-rebinding caveat above.
  return null
}

export function isAllowedWebhookUrl(
  rawUrl: string,
  opts: WebhookTargetOptions = {},
): WebhookTargetVerdict {
  const reason = webhookTargetRejectionReason(rawUrl, opts)
  return reason === null ? { ok: true } : { ok: false, reason }
}

/** Thrown by `createSubscription` for direct (non-HTTP) callers. */
export class WebhookTargetRejectedError extends Error {
  readonly target: string
  readonly reason: string

  constructor(target: string, reason: string) {
    super(`webhook target rejected: ${reason}`)
    this.name = "WebhookTargetRejectedError"
    this.target = target
    this.reason = reason
  }
}

/** Parse a dotted-quad IPv4 literal strictly (URL parsing normalizes odd forms). */
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".")
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

/** Reject ranges an outbound webhook must never reach (RFC 1918/4193/3927/…). */
function ipv4Reason(octets: number[]): string | null {
  const [a, b, c] = octets as [number, number, number, number]
  if (a === 0) return "reserved (0.0.0.0/8)"
  if (a === 10) return "private network (10.0.0.0/8)"
  if (a === 100 && b >= 64 && b <= 127) return "shared address space (100.64.0.0/10)"
  if (a === 127) return "loopback (127.0.0.0/8)"
  if (a === 169 && b === 254) return "link-local (169.254.0.0/16) — cloud metadata"
  if (a === 172 && b >= 16 && b <= 31) return "private network (172.16.0.0/12)"
  if (a === 192 && b === 168) return "private network (192.168.0.0/16)"
  if (a === 192 && b === 0 && c === 0) return "reserved (192.0.0.0/24)"
  if (a === 192 && b === 0 && c === 2) return "documentation (192.0.2.0/24)"
  if (a === 192 && b === 88 && c === 99) return "reserved (192.88.99.0/24)"
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking (198.18.0.0/15)"
  if (a === 198 && b === 51 && c === 100) return "documentation (198.51.100.0/24)"
  if (a === 203 && b === 0 && c === 113) return "documentation (203.0.113.0/24)"
  if (a >= 224 && a <= 239) return "multicast (224.0.0.0/4)"
  if (a >= 240) return "reserved (240.0.0.0/4)"
  return null
}

/**
 * Expand an IPv6 literal to eight 16-bit groups. Handles "::" compression
 * and an embedded trailing IPv4 dotted quad. Returns null when malformed.
 */
function parseIpv6(input: string): number[] | null {
  // Drop the zone id sometimes attached to link-local literals.
  const addr = input.split("%", 1)[0]!
  let working = addr

  const lastColon = working.lastIndexOf(":")
  const tail = lastColon >= 0 ? working.slice(lastColon + 1) : ""
  if (tail.includes(".")) {
    const parts = tail.split(".")
    if (parts.length !== 4) return null
    const octets = parts.map(Number)
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16)
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16)
    working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const halves = working.split("::")
  if (halves.length > 2) return null
  const groupsOf = (part: string): number[] | null => {
    if (part === "") return []
    const out: number[] = []
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
      out.push(Number.parseInt(group, 16))
    }
    return out
  }

  const left = groupsOf(halves[0]!)
  const right = halves.length === 2 ? groupsOf(halves[1]!) : null
  if (left === null || (halves.length === 2 && right === null)) return null
  if (right === null) {
    return left.length === 8 ? left : null
  }
  const missing = 8 - left.length - right.length
  if (missing < 1) return null // "::" must compress at least one group
  return [...left, ...new Array<number>(missing).fill(0), ...right]
}

function ipv4FromGroupPair(hi: number, lo: number): [number, number, number, number] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
}

function ipv6Reason(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  if (groups.every((group) => group === 0)) return "unspecified (::)"
  if ([g0, g1, g2, g3, g4, g5, g6].every((group) => group === 0) && g7 === 1) {
    return "loopback (::1)"
  }
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d.
  if ([g0, g1, g2, g3, g4].every((group) => group === 0) && (g5 === 0xffff || g5 === 0)) {
    const mapped = ipv4Reason(ipv4FromGroupPair(g6, g7))
    if (mapped) return `${mapped} (IPv4-mapped IPv6)`
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    const mapped = ipv4Reason(ipv4FromGroupPair(g6, g7))
    if (mapped) return `${mapped} (NAT64-mapped IPv6)`
  }
  if ((g0 & 0xfe00) === 0xfc00) return "unique local (fc00::/7)"
  if ((g0 & 0xffc0) === 0xfe80) return "link-local (fe80::/10)"
  if ((g0 & 0xff00) === 0xff00) return "multicast (ff00::/8)"
  if (g0 === 0x2001 && g1 === 0x0db8) return "documentation (2001:db8::/32)"
  return null
}
