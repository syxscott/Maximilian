// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * i18n coverage test — the CI-facing gate over the same analysis that
 * `node scripts/i18n-audit.mjs` reports on the command line.
 *
 * Locks in, for every ts/tsx file under apps/dashboard/src:
 *   1. every string-literal key passed to t() / tn() / ts() resolves in the
 *      merged (core @max/i18n + feature-domain) dictionary for BOTH zh-CN
 *      and en-US — no missing keys, no silent raw-key fallbacks;
 *   2. the zh-CN and en-US merged key sets are identical, so a key added to
 *      one language without the other fails here instead of shipping;
 *   3. the merged dictionary keeps its expanded size floor (the audit's
 *      ≥150-key-per-language growth round), so accidental key deletion is
 *      caught too.
 *
 * Unused keys are intentionally NOT asserted — the audit reports them for
 * human review, but prepared keys for in-flight features must not fail CI.
 */
import { describe, it, expect } from "vitest"
import { runAudit, auditIsClean, type AuditReport } from "../../../scripts/i18n-audit.mjs"

// Computed once per suite — the audit reads the workspace from disk.
const report: AuditReport = runAudit()

describe("i18n coverage — merged core + domain dictionaries", () => {
  it("scans dashboard source files", () => {
    expect(report.scannedFiles).toBeGreaterThan(50)
    expect(report.usedKeyCount).toBeGreaterThan(300)
  })

  it("has no missing keys: every t() literal resolves in zh-CN and en-US", () => {
    for (const locale of report.locales) {
      const missing = report.perLocale[locale].missing
      expect(
        missing,
        `missing keys for ${locale}:\n${missing.map((m) => `  ${m.key}  ←  ${m.refs.join(", ")}`).join("\n")}`,
      ).toEqual([])
    }
  })

  it("keeps the zh-CN and en-US key sets identical", () => {
    expect(report.keySetDiff.onlyInZh).toEqual([])
    expect(report.keySetDiff.onlyInEn).toEqual([])
  })

  it("holds the expanded dictionary size floor (≥1400 keys per locale)", () => {
    for (const locale of report.locales) {
      expect(
        report.perLocale[locale].dictSize,
        `${locale} dictionary shrank below the audit-expansion floor`,
      ).toBeGreaterThanOrEqual(1400)
    }
  })

  it("is clean end-to-end (CLI exit-code parity)", () => {
    // Mirrors the exit code of `node scripts/i18n-audit.mjs` so the test
    // and the CLI can never disagree about what "clean" means.
    expect(auditIsClean(report)).toBe(true)
  })
})
