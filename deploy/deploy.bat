@echo off
setlocal enabledelayedexpansion
title FieldGovern — One-Click Deploy
color 0B

echo.
echo   ╔══════════════════════════════════════╗
echo   ║   FieldGovern — One-Click Deploy     ║
echo   ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0.."

:: ── 1. Check for uncommitted changes ──────────────────────────
echo   [1/5] Checking for changes...
git status --short > nul 2>&1
for /f %%i in ('git status --porcelain ^| find /c /v ""') do set CHANGES=%%i

if "%CHANGES%"=="0" (
    echo         No changes detected. Nothing to deploy.
    echo.
    pause
    exit /b 0
)

echo         Found %CHANGES% changed file(s).
echo.

:: ── 2. Show what changed ──────────────────────────────────────
echo   [2/5] Changed files:
echo   ─────────────────────
git status --short
echo.

:: ── 3. Prompt for commit message ──────────────────────────────
echo   [3/5] Commit message:
set /p COMMIT_MSG="         > "

if "!COMMIT_MSG!"=="" (
    set COMMIT_MSG=Update %date% %time:~0,5%
)

:: ── 4. Stage, commit, push ────────────────────────────────────
echo.
echo   [4/5] Committing and pushing to main...
echo.

git add -A
if errorlevel 1 (
    echo   ERROR: git add failed
    pause
    exit /b 1
)

git commit -m "!COMMIT_MSG!"
if errorlevel 1 (
    echo   ERROR: git commit failed
    pause
    exit /b 1
)

git push origin main
if errorlevel 1 (
    echo   ERROR: git push failed. Check your network or credentials.
    pause
    exit /b 1
)

echo.
echo   [5/5] Push complete! GitHub Actions will now:
echo         • Build Docker image
echo         • Push to GHCR
echo         • Deploy to VPS (178.238.227.32)
echo         • Run DB migrations
echo         • Rebuild tools (TableForge, DataCleaner)
echo         • Restart nginx
echo         • Health check https://app.fieldgovern.com/health
echo.
echo   ── Track deployment ──────────────────────────────
echo   GitHub Actions: https://github.com/apranjipavan2-spec/DataCollectTool/actions
echo   Live app:       https://app.fieldgovern.com
echo   Health check:   https://app.fieldgovern.com/health
echo.

:: ── Optional: open Actions page in browser ────────────────────
choice /C YN /M "   Open GitHub Actions in browser?"
if errorlevel 2 goto :done
start https://github.com/apranjipavan2-spec/DataCollectTool/actions

:done
echo.
echo   Deploy triggered successfully!
echo.
pause
