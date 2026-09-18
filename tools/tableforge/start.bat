@echo off
title TableForge Launcher
echo ============================================
echo   TableForge - Starting servers...
echo ============================================
echo.

REM Default ports
set BACKEND_PORT=8001
set FRONTEND_PORT=5173

REM Check if backend port is occupied, try alternatives
netstat -aon | findstr ":%BACKEND_PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Port %BACKEND_PORT% is busy, trying 8002...
    set BACKEND_PORT=8002
    netstat -aon | findstr ":8002 " | findstr "LISTENING" >nul 2>&1
    if !errorlevel!==0 (
        echo Port 8002 is also busy, trying 8003...
        set BACKEND_PORT=8003
    )
)

REM Check if frontend port is occupied, try alternatives
netstat -aon | findstr ":%FRONTEND_PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Port %FRONTEND_PORT% is busy, trying 5174...
    set FRONTEND_PORT=5174
    netstat -aon | findstr ":5174 " | findstr "LISTENING" >nul 2>&1
    if !errorlevel!==0 (
        echo Port 5174 is also busy, trying 5175...
        set FRONTEND_PORT=5175
    )
)

echo.
echo Backend will run on port: %BACKEND_PORT%
echo Frontend will run on port: %FRONTEND_PORT%
echo.

REM Start backend in background
echo Starting backend...
start "TableForge Backend" cmd /c "cd /d C:\DCT\tableforge && python -m uvicorn backend.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload"

REM Wait for backend to be ready
timeout /t 3 /nobreak >nul

REM Start frontend with correct backend port
echo Starting frontend...
start "TableForge Frontend" cmd /c "cd /d C:\DCT\tableforge\frontend && set BACKEND_PORT=%BACKEND_PORT% && node node_modules/vite/bin/vite.js --host 0.0.0.0 --port %FRONTEND_PORT%"

timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   TableForge is running!
echo   Open: http://localhost:%FRONTEND_PORT%
echo ============================================
echo.
echo Close this window or press Ctrl+C to stop.
pause
