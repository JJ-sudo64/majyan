@echo off

rem Online play (ranked, gacha, friend rooms) needs the game server
rem (packages/server, port 8787) in addition to the web dev server.
rem Start it in its own window unless it is already running, so its
rem logs stay visible and closing that window stops it.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo Game server already running.
) else (
  echo Starting the game server in a separate window...
  start "majyan game server" /d "%~dp0" cmd /k "npm run dev:server"
)

cd /d "%~dp0packages\web"

rem If a dev server is already listening on 5173 (e.g. previous window
rem was closed without stopping it), skip starting a new one (which
rem would just fail with "port already in use") and open the browser
rem straight to the existing server instead.
rem The browser is the OS default (currently Avast Secure Browser).
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo Server already running. Opening in the default browser...
  start "" http://localhost:5173/
) else (
  rem Fire off a delayed browser-open in the background (giving the dev
  rem server a couple seconds to actually start listening) while the
  rem server itself runs in this window so its logs stay visible.
  start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:5173/"
  call npm run dev
  pause
)
