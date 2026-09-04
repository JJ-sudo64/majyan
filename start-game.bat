@echo off
cd /d "%~dp0packages\web"
call npm run dev -- --open
pause
