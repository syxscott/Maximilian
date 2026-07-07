#!/usr/bin/env bash
# scripts/check-license-headers.sh
#
# Verify that source files (.ts, .tsx, .js, .mjs) carry the standard
# Maximilian license header. Used by CI to prevent accidental license
# drift on new files.
#
# Usage:
#   ./scripts/check-license-headers.sh                  # check entire repo
#   ./scripts/check-license-headers.sh --staged         # only files staged for commit
#   ./scripts/check-license-headers.sh --new-only       # only files NOT yet tracked by git
#   ./scripts/check-license-headers.sh --fix            # prepend header to missing files (use with care)
#
# Exits 0 on success, 1 if any file is missing the header (in check mode).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEADER_FILE="$ROOT/.license-header.txt"
MODE="all"
FIX=0

for arg in "$@"; do
  case "$arg" in
    --staged)   MODE="staged" ;;
    --new-only) MODE="new-only" ;;
    --fix)      FIX=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$HEADER_FILE" ]]; then
  echo "error: $HEADER_FILE not found" >&2
  exit 2
fi

HEADER_HASH="$(sha256sum "$HEADER_FILE" | awk '{print $1}')"

# Discover files
case "$MODE" in
  all)
    mapfile -t FILES < <(find "$ROOT" \
      \( -path '*/node_modules' -o -path '*/dist' -o -path '*/coverage' -o -path '*/.turbo' \) -prune -o \
      -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) -print)
    ;;
  staged)
    mapfile -t FILES < <(git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|mjs)$' || true)
    ;;
  new-only)
    mapfile -t FILES < <(git -C "$ROOT" ls-files --others --exclude-standard | grep -E '\.(ts|tsx|js|mjs)$' || true)
    ;;
esac

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "no files to check"
  exit 0
fi

MISSING=()
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue

  # First 20 lines — header is always at the top
  if head -20 "$f" | grep -q "SPDX-License-Identifier: MIT"; then
    continue
  fi

  if [[ $FIX -eq 1 ]]; then
    TMP="$(mktemp)"
    cat "$HEADER_FILE" "$f" > "$TMP"
    mv "$TMP" "$f"
    echo "fixed: $f"
  else
    MISSING+=("$f")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "files missing license header:" >&2
  for f in "${MISSING[@]}"; do
    echo "  $f" >&2
  done
  echo >&2
  echo "run with --fix to prepend the header, or add it manually:" >&2
  echo "  $(cat "$HEADER_FILE")" >&2
  exit 1
fi

echo "all ${#FILES[@]} files have license headers"