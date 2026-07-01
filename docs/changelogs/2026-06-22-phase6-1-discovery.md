# Phase 6.1 — Capability Discovery Engine

**Date**: 2026-06-22
**Status**: Completed

## What

`CapabilityDiscoveryEngine` mines signals (user requests, failure patterns, review suggestions, capability gaps) for missing capabilities.

## Implementation

`packages/meta-system/src/capability-discovery.ts`:

- `KNOWN_CAPABILITIES` set — don't re-propose existing capabilities
- `KNOWN_KEYWORDS` map — keyword → capability short-circuit (e.g., "react" → "frontend")
- `GAP_PATTERNS` array — regex patterns suggesting new capabilities (mobile, blockchain, game, llm_engineering, etc.)
- `discover(signals, knownIds)` → emits a proposal when ≥ `minFrequency` (default 2) signals match the same pattern
- Persists proposals to `<rootDir>/capability-proposals/<id>.json`

## Tests (8 unit tests)

- discovers mobile / blockchain / game capabilities
- skips proposals for known capabilities
- requires minimum frequency
- persists proposals
- captures evidence samples
- ranks `capability_gap` source higher
- ignores keywords mapped to known capabilities

## Bug Fixes During Testing

- Removed `mobile_app_development` from `KNOWN_CAPABILITIES` (it was conflicting with `GAP_PATTERNS`)
- Fixed syntax error in `for-of` destructuring (`{ displayName, signals }])` → `{ displayName, signals }]`)

## Verification

```bash
pnpm --filter @max/meta-system test  # 8/8 pass
```