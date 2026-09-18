@echo off
cd /d "%~dp0packages\web"

rem If a dev server is already listening on 5173 (e.g. previous window
rem was closed without stopping it), skip starting a new one (which
rem would just fail with "port already in use") and open the browser
rem straight to the existing server instead.
rem "microsoft-edge:" is a protocol handler that always launches Edge,
rem regardless of whichever browser is set as the OS default (Avast).
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo Server already running. Opening in Edge...
  start microsoft-edge:http://localhost:5173/
) else (
  rem Fire off a delayed browser-open in the background (giving the dev
  rem server a couple seconds to actually start listening) while the
  rem server itself runs in this window so its logs stay visible.
  start "" cmd /c "timeout /t 3 /nobreak >nul & start microsoft-edge:http://localhost:5173/"
  call npm run dev
  pause
)
