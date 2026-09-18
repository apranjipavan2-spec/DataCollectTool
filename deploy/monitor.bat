@echo off
title FieldGovern Deploy Monitor
echo.
echo   FieldGovern Deploy Monitor
echo   ────────────────────────────
echo   Starting local server at http://localhost:4747
echo   Press Ctrl+C to stop.
echo.
node "%~dp0monitor.js"
pause
