// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Validator registry (borrowing MiniMax-Provider-Verifier verify.py:33-39
 * `VALIDATOR_REGISTRY` + verify.py:397-415 check_type dispatch).
 *
 * `resolve(checkTypes)` implements the dispatch: a case's `checkType`
 * array names the validators to run; an empty/absent array falls back to
 * the registry's default list (verify.py:413-415), and an unregistered
 * check type warns and DEGRADES to the default list instead of silently
 * running nothing.
 */

import type { CaseValidator } from "./types.js"

export interface ResolveOptions {
  /** Warn sink for unregistered check types (default: console.warn). */
  onUnknownCheckType?: (checkType: string) => void
}

export class ValidatorRegistry {
  private readonly byName = new Map<string, CaseValidator>()
  private readonly defaults: readonly CaseValidator[]

  constructor(...defaults: CaseValidator[]) {
    this.defaults = defaults
    for (const v of defaults) this.byName.set(v.name, v)
  }

  register(validator: CaseValidator): this {
    this.byName.set(validator.name, validator)
    return this
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  get(name: string): CaseValidator | undefined {
    return this.byName.get(name)
  }

  /**
   * Dispatch one case's checkType array to validators, in order, deduped
   * by validator name. Known types resolve to their validator; unknown
   * types warn and contribute the DEFAULT list (degradation). No check
   * types at all → the default list (possibly empty when the registry was
   * constructed without defaults).
   */
  resolve(checkTypes: readonly string[] | undefined, opts: ResolveOptions = {}): CaseValidator[] {
    const warn =
      opts.onUnknownCheckType ?? ((t: string) => console.warn(`Unknown check_type: ${t}`))
    if (!checkTypes || checkTypes.length === 0) return [...this.defaults]

    const out: CaseValidator[] = []
    const seen = new Set<string>()
    let degraded = false
    for (const checkType of checkTypes) {
      const validator = this.byName.get(checkType)
      if (validator) {
        if (!seen.has(validator.name)) {
          seen.add(validator.name)
          out.push(validator)
        }
      } else {
        warn(checkType)
        degraded = true
      }
    }
    if (degraded) {
      // Unregistered check type → fall back to the default validators so
      // the case is still measured by something (spec: 告警降级默认).
      for (const v of this.defaults) {
        if (!seen.has(v.name)) {
          seen.add(v.name)
          out.push(v)
        }
      }
    }
    return out
  }
}
