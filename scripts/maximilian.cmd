@echo off
REM Maximilian launcher (Windows / cmd.exe / Windows Terminal).
REM
REM Boots the TUI against a running API. Honors the same MAXIMILIAN_TUI_DIST
REM env var as the .sh launcher for parity.
REM
REM Notes for Win 11:
REM   - Run this from cmd.exe, Windows Terminal, or PowerShell (`.\maximilian.cmd`).
REM   - Use `maximilian.ps1` for stricter PowerShell integration.
REM   - Node 20+ must be on PATH (`node --version` to verify).
REM   - For ANSI colors, enable Windows Terminal or run inside ConEmu/cmder.
REM     Plain cmd.exe on Win 11 22H2+ supports ANSI by default; older builds
REM     need `reg add HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1`.

setlocal

if defined MAXIMILIAN_TUI_DIST (
  node "%MAXIMILIAN_TUI_DIST%" %*
  goto :eof
)

REM Prefer the workspace @max/tui dev entry when running from a clone.
if exist "%~dp0apps\tui\src\index.tsx" (
  call pnpm --filter @max/tui dev -- %*
  goto :eof
)

if exist "%~dp0apps\tui\dist\index.js" (
  node "%~dp0apps\tui\dist\index.js" %*
  goto :eof
)

echo maximilian.cmd: could not locate TUI entry. Set MAXIMILIAN_TUI_DIST or run from the repo root. 1>&2
exit /b 1
