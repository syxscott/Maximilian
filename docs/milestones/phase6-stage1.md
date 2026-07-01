# Phase 6 — Stage 1: Capability Discovery

**Date**: 2026-06-22
**Status**: ✅ Completed

## Deliverable

`CapabilityDiscoveryEngine` mines signals for missing capabilities.

## Heuristics

- `KNOWN_KEYWORDS` map: text → capability short-circuit (e.g., "react" → "frontend")
- `GAP_PATTERNS` regex array: text → proposed capability (mobile, blockchain, game, llm_engineering, etc.)
- `minFrequency = 2` — need at least 2 signals to propose

## Tests

8 unit tests covering: mobile discovery, blockchain discovery, skip-known, min-frequency, persistence, evidence capture, source ranking, keyword short-circuit.

## Bugs Fixed

- Syntax error: `for (const [capabilityId, { displayName, signals }]) of candidateMap)` → `for (const [capabilityId, { displayName, signals }] of candidateMap)`
- Removed `mobile_app_development` from `KNOWN_CAPABILITIES` (was conflicting with GAP pattern)