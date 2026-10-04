@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo [Tinix Inbox] Restarting Service
echo ========================================================

echo [Tinix Inbox] 1. Stopping existing backend process on port 3182...
call "%~dp0STOP.bat" >nul 2>&1

:: Wait for port 3182 to be fully released
echo [Tinix Inbox] 2. Waiting for port release...
ping -n 2 127.0.0.1 >nul

set /a WAIT_COUNT=0
:WAIT_PORT_FREE
set "PORT_CHECK="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3182" ^| findstr "LISTENING"') do (
    set "PORT_CHECK=%%a"
)
if "%PORT_CHECK%"=="" goto PORT_IS_FREE
set /a WAIT_COUNT+=1
if %WAIT_COUNT% geq 5 (
    echo [WARN] Port 3182 is still in use by PID %PORT_CHECK%. Forcing termination...
    taskkill /f /pid %PORT_CHECK% >nul 2>&1
    ping -n 2 127.0.0.1 >nul
    goto PORT_IS_FREE
)
ping -n 2 127.0.0.1 >nul
goto WAIT_PORT_FREE

:PORT_IS_FREE
:: Ensure Chatwoot is running
curl.exe -s -f http://127.0.0.1:3180/ -o nul 2>nul
if %errorlevel% neq 0 (
    echo [Tinix Inbox] Chatwoot is not running. Starting Chatwoot stack...
    docker compose -f "%~dp0poc\chatwoot-v418\compose.yaml" up -d >nul 2>&1
)

echo [Tinix Inbox] 3. Starting backend server in background...
if not exist "data" mkdir data
start /b "TinixInboxServer" node --experimental-strip-types src/index.ts > data\server.log 2>&1

echo [Tinix Inbox] 4. Verifying runtime health...
set /a HEALTH_RETRIES=0

:CHECK_HEALTH
ping -n 2 127.0.0.1 >nul
curl.exe -s -f http://127.0.0.1:3182/health >nul 2>&1
if %errorlevel% equ 0 goto HEALTH_PASSED

set /a HEALTH_RETRIES+=1
if %HEALTH_RETRIES% lss 8 goto CHECK_HEALTH

echo [ERROR] Server failed to pass health check within 8 seconds!
if exist "data\server.log" (
    echo.
    echo [LOG] Last lines of data\server.log:
    type "data\server.log"
)
exit /b 1

:HEALTH_PASSED
echo [SUCCESS] Tinix Inbox restarted and healthy.
echo.
call "%~dp0STATUS.bat"
exit /b 0
