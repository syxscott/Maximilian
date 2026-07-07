#!/usr/bin/env bash
# scripts/render-architecture.sh
#
# Extract every ```mermaid block from docs/**/*.md and render it to a
# PNG/SVG in docs/architecture/diagrams/<doc-slug>-<n>.{png,svg}.
#
# Requirements:
#   - node + npx (mermaid-cli is invoked via `npx -y @mermaid-js/mermaid-cli`)
#   - chromium / chrome (mmdc uses puppeteer)
#
# Usage:
#   ./scripts/render-architecture.sh                 # render everything
#   ./scripts/render-architecture.sh docs/architecture/agent-lifecycle.md   # one file
#   ./scripts/render-architecture.sh --check         # fail if any source is newer than its PNG
#
# The --check mode is used by CI to verify that diagrams have been
# re-rendered after a source change.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/docs/architecture/diagrams"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: npx is required (Node.js)" >&2
  exit 1
fi

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
  shift
fi

if [[ $# -eq 0 ]]; then
  # Find all .md under docs/ that contain mermaid
  mapfile -t FILES < <(grep -rl --include='*.md' '^```mermaid' "$ROOT/docs")
else
  FILES=("$@")
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "no mermaid diagrams found"
  exit 0
fi

render_one() {
  local src="$1"
  local rel="${src#"$ROOT/"}"
  local slug
  slug="$(echo "$rel" | tr '/' '-' | sed 's/\.md$//')"

  # Split out each mermaid block to a temp file
  awk '
    /^```mermaid$/ { in_block=1; n++; out=sprintf("%s/%s-%02d.mmd", "'"$TMP_DIR"'", "'"$slug"'", n); print "" > out; next }
    /^```$/ && in_block { in_block=0; close(out); next }
    in_block { print > out }
  ' "$src"

  local count=0
  for mmd in "$TMP_DIR/$slug"-*.mmd; do
    [[ -f "$mmd" ]] || continue
    count=$((count + 1))
    local base
    base="$(basename "$mmd" .mmd)"
    local png="$OUT_DIR/$base.png"
    local svg="$OUT_DIR/$base.svg"

    if [[ $CHECK_ONLY -eq 1 ]]; then
      if [[ ! -f "$png" || "$src" -nt "$png" ]]; then
        echo "stale: $rel -> $base.png" >&2
        exit 1
      fi
      continue
    fi

    # Render via mermaid-cli. Use a stable puppeteer config to avoid
    # downloading a fresh chromium on every run.
    export PUPPETEER_CONFIG="${PUPPETEER_CONFIG:-$ROOT/.mermaid-config.json}"
    if [[ ! -f "$PUPPETEER_CONFIG" ]]; then
      cat > "$PUPPETEER_CONFIG" <<'CFG'
{ "args": ["--no-sandbox", "--disable-setuid-sandbox"] }
CFG
    fi

    npx -y @mermaid-js/mermaid-cli@latest \
      --input "$mmd" \
      --output "$png" \
      --outputFormat png \
      --puppeteerConfigFile "$PUPPETEER_CONFIG" \
      --quiet \
      2>/dev/null

    npx -y @mermaid-js/mermaid-cli@latest \
      --input "$mmd" \
      --output "$svg" \
      --outputFormat svg \
      --puppeteerConfigFile "$PUPPETEER_CONFIG" \
      --quiet \
      2>/dev/null

    echo "rendered: $rel -> diagrams/$base.{png,svg}"
  done

  if [[ $count -eq 0 ]]; then
    echo "warn: no mermaid blocks in $rel" >&2
  fi
}

for f in "${FILES[@]}"; do
  render_one "$f"
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  echo "all diagrams are up to date"
fi