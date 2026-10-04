@echo off
setlocal
echo [Tinix Inbox] Stopping Tinix Inbox background processes...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3182" ^| findstr "LISTENING"') do (
    echo [Tinix Inbox] Terminating process on port 3182 with PID: %%a
    taskkill /f /pid %%a >nul 2>&1
)

echo [Tinix Inbox] Tinix Inbox backend stopped.

if /i "%1"=="--all" goto STOP_DOCKER
if /i "%1"=="all" goto STOP_DOCKER

echo [Tinix Inbox] (Note: Chatwoot Docker containers are still running. Run 'STOP.bat --all' to also stop Docker containers.)
echo [Tinix Inbox] Shutdown complete.
exit /b 0

:STOP_DOCKER
echo [Tinix Inbox] Stopping Chatwoot Docker containers...
docker compose -f "%~dp0poc\chatwoot-v418\compose.yaml" stop
echo [Tinix Inbox] All Tinix Inbox and Docker services stopped.
exit /b 0
