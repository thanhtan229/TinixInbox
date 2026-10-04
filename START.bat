@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo [Tinix Inbox] Checking Node.js runtime...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    pause
    exit /b 1
)

echo [Tinix Inbox] Ensuring data directories exist...
if not exist "data" mkdir data
if not exist "data\browser_profile" mkdir "data\browser_profile"

echo [Tinix Inbox] Checking Chatwoot Conversation Provider (port 3180)...
curl.exe -s -f http://127.0.0.1:3180/ -o nul 2>nul
if %errorlevel% equ 0 (
    echo [Tinix Inbox] Chatwoot is running and responsive.
    goto CHECK_TINIX_SERVER
)

echo [Tinix Inbox] Chatwoot is not responding. Checking Docker Engine...
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Docker CLI was not found in PATH!
    echo [ERROR] Please install Docker Desktop or add it to PATH.
    pause
    exit /b 1
)

docker info >nul 2>nul
if %errorlevel% neq 0 (
    echo [Tinix Inbox] Docker daemon is not active. Attempting to start Docker Desktop...
    set "DOCKER_DESKTOP_EXE="
    if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe" (
        set "DOCKER_DESKTOP_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    ) else if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_DESKTOP_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    ) else if exist "%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe" (
        set "DOCKER_DESKTOP_EXE=%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe"
    )

    if defined DOCKER_DESKTOP_EXE (
        echo [Tinix Inbox] Launching Docker Desktop...
        start "" "!DOCKER_DESKTOP_EXE!"
        echo [Tinix Inbox] Waiting for Docker engine to initialize (this may take 20-30 seconds)...
        set /a DOCKER_WAIT=0
        :WAIT_DOCKER
        ping -n 3 127.0.0.1 >nul
        docker info >nul 2>nul
        if !errorlevel! equ 0 goto DOCKER_READY
        set /a DOCKER_WAIT+=1
        if !DOCKER_WAIT! lss 30 (
            echo   ... still waiting for Docker daemon [!DOCKER_WAIT!/30]
            goto WAIT_DOCKER
        )
        echo [ERROR] Docker engine did not start in time. Please start Docker Desktop manually.
        pause
        exit /b 1
    ) else (
        echo [ERROR] Docker Desktop executable not found in standard paths.
        echo [ERROR] Please start Docker Desktop manually and run START.bat again.
        pause
        exit /b 1
    )
)

:DOCKER_READY
echo [Tinix Inbox] Docker daemon is active. Starting Chatwoot stack...
docker compose -f "%~dp0poc\chatwoot-v418\compose.yaml" up -d
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start Chatwoot containers via docker compose!
    pause
    exit /b 1
)

echo [Tinix Inbox] Waiting for Chatwoot web service on port 3180...
set /a CHATWOOT_WAIT=0
:WAIT_CHATWOOT
ping -n 3 127.0.0.1 >nul
curl.exe -s -f http://127.0.0.1:3180/ -o nul 2>nul
if %errorlevel% equ 0 (
    echo [Tinix Inbox] Chatwoot is ready and responsive.
    goto CHECK_TINIX_SERVER
)
set /a CHATWOOT_WAIT+=1
if !CHATWOOT_WAIT! lss 25 (
    echo   ... waiting for Chatwoot Rails server to be healthy [!CHATWOOT_WAIT!/25]
    goto WAIT_CHATWOOT
)
echo [WARN] Chatwoot did not respond within timeout, but containers are running. Proceeding with Tinix startup...

:CHECK_TINIX_SERVER
set "RUNNING_PID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3182" ^| findstr "LISTENING"') do (
    set "RUNNING_PID=%%a"
)

if not "%RUNNING_PID%"=="" (
    echo [Tinix Inbox] Backend server is already running on port 3182 [PID: %RUNNING_PID%].
    goto LAUNCH_APP
)

echo [Tinix Inbox] Starting backend server in background...
start /b "TinixInboxServer" node --experimental-strip-types src/index.ts > data\server.log 2>&1

echo [Tinix Inbox] Waiting for server on port 3182...
set /a START_RETRIES=0

:WAIT_SERVER
ping -n 2 127.0.0.1 >nul
curl.exe -s -f http://127.0.0.1:3182/health >nul 2>&1
if %errorlevel% equ 0 goto LAUNCH_APP

set /a START_RETRIES+=1
if %START_RETRIES% lss 8 goto WAIT_SERVER

echo [WARN] Backend server did not respond to health check in time. Launching UI anyway...

:LAUNCH_APP
:: Detect Chrome or Edge
set "BROWSER="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if defined BROWSER (
    echo [Tinix Inbox] Launching Desktop App Mode...
    start "" "%BROWSER%" --app="http://127.0.0.1:3182" --user-data-dir="%CD%\data\browser_profile" --no-first-run --no-default-browser-check
) else (
    echo [Tinix Inbox] Opening default browser...
    start http://127.0.0.1:3182
)

exit /b 0
