@echo off
REM One click: write the workspace bundle to the Desktop as a zip.
REM Everything the other machine needs that git does not carry.
setlocal
cd /d "%~dp0"
node scripts\workspace-export.mjs --zip %*
echo.
pause
