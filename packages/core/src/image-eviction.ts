// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Image eviction policy (hermes borrowing: image_eviction_policy.py).
 *
 * Two wire constraints exist simultaneously:
 *  - a provider HARD CAP on image count (e.g. Anthropic rejects whole
 *    requests above ~20 images with a strict 2000px rule), and
 *  - a byte budget for the request body.
 *
 * The borrowed insight is about EVICTION SHAPE: evicting keep-newest-N
 * re-edits already-cached history on EVERY new image (each new image
 * pushes one more old image out → full prefix miss each round). Instead,
 * compute a single BATCH eviction that brings the request under BOTH
 * constraints at once and then stays stable while the count is under the
 * cap — zero cost within limits.
 *
 * Pure policy: takes image descriptors, returns which indices to drop.
 * The caller applies the plan to its wire format.
 */

export interface ImageDescriptor {
  /** Stable identity of the message/index carrying the image. */
  index: number
  sizeBytes: number
  /** Optional position marker; eviction prefers the OLDEST first. */
  seq?: number
}

export interface EvictionPlan {
  /** Indices (from the input) to drop from the request. */
  evict: number[]
  /** Indices kept. */
  keep: number[]
  /** true when the input already satisfied both constraints. */
  noop: boolean
}

export function planImageEviction(
  images: ImageDescriptor[],
  opts: { maxCount: number; maxTotalBytes: number },
): EvictionPlan {
  const maxCount = Math.max(0, opts.maxCount)
  const maxBytes = Math.max(0, opts.maxTotalBytes)

  const totalBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0)
  const overCount = images.length > maxCount
  const overBytes = totalBytes > maxBytes
  if (!overCount && !overBytes) {
    return { evict: [], keep: images.map((i) => i.index), noop: true }
  }

  // Oldest first (smallest seq first, ties by input order).
  const order = images
    .map((img, position) => ({ img, position }))
    .sort((a, b) => (a.img.seq ?? a.position) - (b.img.seq ?? b.position))

  const evict: number[] = []

  // Walk OLDEST → newest, evicting until the survivors fit both constraints.
  // The newest image is never evicted (it is usually the current turn).
  // Batch shape: everything needed is dropped in one pass instead of
  // trimming one per new image (which would churn the cached prefix every
  // round).
  const lastPosition = order.length - 1
  let keptCount = images.length
  let keptBytes = totalBytes
  for (const { img, position } of order) {
    if (keptCount <= maxCount && keptBytes <= maxBytes) break
    if (position === lastPosition) continue // never evict the newest
    evict.push(img.index)
    keptCount -= 1
    keptBytes -= img.sizeBytes
  }

  const evictSet = new Set(evict)
  return {
    evict,
    keep: images.filter((img) => !evictSet.has(img.index)).map((img) => img.index),
    noop: false,
  }
}
