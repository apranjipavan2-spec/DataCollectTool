@echo off
setlocal enabledelayedexpansion
title FieldGovern — Deploy
color 0B

cd /d "%~dp0.."

echo.
echo   FieldGovern Deploy
echo   ───────────────────
echo.

:: ── 1. Check for changes ──────────────────────────────────────
for /f %%i in ('git status --porcelain ^| find /c /v ""') do set CHANGES=%%i
if "%CHANGES%"=="0" (
    echo   Nothing to deploy.
    timeout /t 3 >nul
    exit /b 0
)

:: ── 2. Auto-generate commit message from changed paths ────────
set "MSG=deploy:"
for /f "tokens=2" %%f in ('git status --porcelain') do (
    for %%d in ("%%f") do (
        set "DIR=%%~nxd"
        echo !MSG! | findstr /C:"!DIR!" >nul 2>&1 || set "MSG=!MSG! !DIR!"
    )
)
set "MSG=!MSG! [%date:~-4%-%date:~4,2%-%date:~7,2%]"

:: ── 3. Stage, commit, push — zero prompts ─────────────────────
echo   %CHANGES% file(s) changed
git status --short
echo.
echo   Committing: !MSG!
echo.

git add -A
git commit -m "!MSG!"
if errorlevel 1 (
    echo   ERROR: commit failed
    timeout /t 5 >nul
    exit /b 1
)

git push origin main
if errorlevel 1 (
    echo   ERROR: push failed
    timeout /t 5 >nul
    exit /b 1
)

echo.
echo   Pushed. Auto-deploy triggered.
echo   Track: https://github.com/apranjipavan2-spec/DataCollectTool/actions
echo.

start https://github.com/apranjipavan2-spec/DataCollectTool/actions
timeout /t 5 >nul
