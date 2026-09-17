@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set "PORT=3003"
set "HOST=127.0.0.1"
rem Fixed whitelisted admin credentials requested for HAMU MASTER.
rem Note: this BAT contains the admin password in plain text, so keep the folder private.
set "HM_ADMIN_PASSWORD=Iloveu@143143"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js 20+ with npm included.
  pause
  exit /b 1
)
if not exist package.json (
  echo package.json not found. Start this BAT from the HAMU MASTER project folder.
  pause
  exit /b 1
)
if not exist node_modules\ws\package.json (
  echo.
  echo Installing HAMU MASTER server dependency: ws...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try start.bat again.
    pause
    exit /b 1
  )
)
rem Keep the server visible and do not force-kill processes on a port.
rem The server opens the browser only after it has successfully started.
set "HM_OPEN_BROWSER=1"
echo.
echo HAMU MASTER V24 - WINDOWS STARTUP AND LOGIN FIX
echo Server: http://localhost:%PORT%
echo Keep this window open while playing. Press Ctrl+C to stop safely.
echo If an older game server is running, stop that server first.
echo.
node server\server.js
set "GAME_EXIT=%ERRORLEVEL%"
if not "%GAME_EXIT%"=="0" (
  echo.
  echo Game could not start. Read the error above.
  echo Do not delete your account data or the HamuMaster folder.
  echo See WINDOWS-START-FIX-V24.txt for help.
  pause
)
exit /b %GAME_EXIT%
