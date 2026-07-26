@echo off
setlocal EnableDelayedExpansion
rem ============================================================================
rem run-plan.cmd [maxUnits]
rem Executes PLAN.md one unit at a time via `claude -p "/next-unit"`.
rem   - loops while a run ends in "DONE <n>" (up to maxUnits, default 3)
rem   - stops on ALL-DONE / BLOCKED / SPLIT and names the log to read
rem   - stops (exit 2, no retry) on usage-limit or auth errors: RESUME later
rem All progress state is in PROGRESS.md + git; resuming = re-running this file.
rem ============================================================================

set "MAX=%~1"
if "%MAX%"=="" set "MAX=3"
if not exist logs mkdir logs
set /a COUNT=0

:loop
if !COUNT! GEQ %MAX% (
  echo [run-plan] Reached max units for this invocation ^(%MAX%^). Re-run run-plan.cmd to continue.
  exit /b 0
)

for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "TS=%%t"
set "LOG=logs\unit-run-!TS!.log"
set "RESULT=logs\unit-result-!TS!.txt"

echo [run-plan] Unit run !COUNT!+1 of %MAX% starting. Log: !LOG!
call claude -p "/next-unit" --output-format stream-json --verbose > "!LOG!" 2>&1
set "CLAUDE_EXIT=!ERRORLEVEL!"

node .claude\harness\parse-result.mjs "!LOG!" > "!RESULT!" 2>nul
set "PARSE_EXIT=!ERRORLEVEL!"

if !CLAUDE_EXIT! NEQ 0 goto :hard_error
if !PARSE_EXIT! NEQ 0 goto :hard_error

findstr /B /C:"ALL-DONE" "!RESULT!" >nul
if !ERRORLEVEL! EQU 0 (
  echo [run-plan] ALL-DONE - every eligible unit is complete. Log: !LOG!
  exit /b 0
)

findstr /B /C:"BLOCKED" "!RESULT!" >nul
if !ERRORLEVEL! EQU 0 (
  echo [run-plan] A unit is BLOCKED. Read: !LOG!  ^(summary: !RESULT!^)
  findstr /B /C:"BLOCKED" "!RESULT!"
  exit /b 1
)

findstr /B /C:"SPLIT" "!RESULT!" >nul
if !ERRORLEVEL! EQU 0 (
  echo [run-plan] A unit needs a SPLIT decision. Read: !LOG!  ^(summary: !RESULT!^)
  findstr /B /C:"SPLIT" "!RESULT!"
  exit /b 1
)

findstr /B /C:"DONE " "!RESULT!" >nul
if !ERRORLEVEL! EQU 0 (
  for /f "usebackq delims=" %%d in (`findstr /B /C:"DONE " "!RESULT!"`) do echo [run-plan] %%d  ^(log: !LOG!^)
  set /a COUNT+=1
  goto :loop
)

echo [run-plan] Run finished without a recognized sentinel. Read: !LOG!
exit /b 1

:hard_error
rem Distinguish usage-limit / auth stops (resume later, exit 2, DO NOT retry
rem in a loop) from other failures (exit 1). Patterns per Claude Code headless
rem error messages; scanned only on failed runs so log content can't
rem false-positive a successful one.
findstr /I /C:"usage limit" /C:"session limit" /C:"weekly limit" /C:"hit your" /C:"rate limit" /C:"Credit balance" /C:"Not logged in" /C:"OAuth" /C:"429" "!LOG!" >nul
if !ERRORLEVEL! EQU 0 (
  echo [run-plan] Stopped by a usage-limit or auth error ^(claude exit !CLAUDE_EXIT!^). Log: !LOG!
  echo RESUME: re-run run-plan.cmd later.
  exit /b 2
)
echo [run-plan] claude run failed ^(exit !CLAUDE_EXIT!, parse !PARSE_EXIT!^). Read: !LOG!
echo RESUME: re-run run-plan.cmd after investigating.
exit /b 1
