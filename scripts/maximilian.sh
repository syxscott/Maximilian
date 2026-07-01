#!/usr/bin/env bash
# Maximilian launcher (POSIX).
#
# Boots the TUI against a running API. Picks the local source by default so
# development works without a `pnpm build` step. Override MAXIMILIAN_TUI_DIST
# to point at a prebuilt bundle.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." &> /dev/null && pwd)"

if [[ -n "${MAXIMILIAN_TUI_DIST:-}" ]]; then
  exec node "${MAXIMILIAN_TUI_DIST}" "$@"
fi

# Prefer the workspace @max/tui dev entry (tsx hot-reloads TSX, no build step).
# Fall back to a built dist/ if present.
if [[ -f "${ROOT_DIR}/apps/tui/src/index.tsx" ]]; then
  exec pnpm --filter @max/tui dev -- "$@"
fi

if [[ -f "${ROOT_DIR}/apps/tui/dist/index.js" ]]; then
  exec node "${ROOT_DIR}/apps/tui/dist/index.js" "$@"
fi

echo "maximilian.sh: could not locate TUI entry. Set MAXIMILIAN_TUI_DIST or run from the repo root." >&2
exit 1
