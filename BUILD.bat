@echo off
setlocal
echo ========================================================
echo [Tinix Inbox] Running Build and Validation Suite...
echo ========================================================

cd /d "%~dp0"

echo [Tinix Inbox] 1. Checking TypeScript types...
call npm run typecheck
if %errorlevel% neq 0 (
    echo [ERROR] Typecheck failed! Build aborted.
    exit /b %errorlevel%
)

echo [Tinix Inbox] 2. Running test suite...
call npm test
if %errorlevel% neq 0 (
    echo [ERROR] Test suite failed! Build aborted.
    exit /b %errorlevel%
)

echo ========================================================
echo [SUCCESS] All checks passed! Build and validation ready.
echo ========================================================
exit /b 0
