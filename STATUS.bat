@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo [Tinix Inbox] Runtime Status Check
echo ========================================================

echo --- [1/2] Conversation Provider (Chatwoot ^& Docker) ---
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARN] Docker CLI not found in PATH.
) else (
    docker info >nul 2>nul
    if %errorlevel% neq 0 (
        echo [STATUS] Docker daemon is NOT running.
    ) else (
        echo [STATUS] Docker daemon is ACTIVE.
        curl.exe -s -f http://127.0.0.1:3180/ -o nul 2>nul
        if %errorlevel% equ 0 (
            echo [STATUS] Chatwoot web service is RUNNING on port 3180 [OK].
        ) else (
            echo [STATUS] Chatwoot web service on port 3180 is NOT responding.
        )
    )
)
echo.

echo --- [2/2] Tinix Inbox Server (Port 3182) ---
set "PID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3182" ^| findstr "LISTENING"') do (
    set "PID=%%a"
)

if "%PID%"=="" goto NOT_RUNNING

echo [STATUS] Tinix Inbox server is RUNNING.
echo   Port: 3182
echo   PID:  %PID%
echo.
echo [HEALTH] Querying http://127.0.0.1:3182/health ...
curl.exe -s http://127.0.0.1:3182/health
echo.
if %errorlevel% neq 0 (
    echo [WARN] Health endpoint did not respond successfully.
    exit /b 1
)
echo [OK] Server is healthy and responsive.
exit /b 0

:NOT_RUNNING
echo [STATUS] Tinix Inbox server is NOT running [port 3182 is inactive].
if exist "data\server.log" (
    echo.
    echo [LOG] Last lines of data\server.log:
    type "data\server.log"
)
exit /b 1
