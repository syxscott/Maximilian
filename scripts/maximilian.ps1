# Maximilian launcher (PowerShell 5+).
#
# Boots the TUI against a running API. Honors MAXIMILIAN_TUI_DIST for parity
# with the .sh and .cmd launchers.
#
# Usage from PowerShell:
#   .\maximilian.ps1
#   $env:MAXIMILIAN_TUI_DIST = 'C:\path\to\dist\index.js'; .\maximilian.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path "$ScriptDir\.."

if ($env:MAXIMILIAN_TUI_DIST) {
  & node $env:MAXIMILIAN_TUI_DIST @args
  exit $LASTEXITCODE
}

$devEntry = Join-Path $RepoRoot 'apps\tui\src\index.tsx'
$distEntry = Join-Path $RepoRoot 'apps\tui\dist\index.js'

if (Test-Path $devEntry) {
  & pnpm --filter @max/tui dev @args
  exit $LASTEXITCODE
}

if (Test-Path $distEntry) {
  & node $distEntry @args
  exit $LASTEXITCODE
}

Write-Error 'maximilian.ps1: could not locate TUI entry. Set $env:MAXIMILIAN_TUI_DIST or run from the repo root.'
exit 1
