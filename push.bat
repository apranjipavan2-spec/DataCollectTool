@echo off
cd /d C:\Life\DataCollectTool
echo.
echo === DataCollectTool Auto Push ===
echo.
git add -A
git status --short
echo.
set /p MSG="Commit message (or press Enter for default): "
if "%MSG%"=="" set MSG=Auto update
git commit -m "%MSG%"
git push origin main
echo.
echo Done!
pause
