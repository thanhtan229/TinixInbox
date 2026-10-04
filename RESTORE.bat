@echo off
setlocal enabledelayedexpansion

echo [Tinix Inbox] Restore Database from Backup...
echo Stop the Tinix Inbox backend before continuing. Restore refuses invalid or incomplete Tinix snapshots.

if "%~1"=="" (
  echo Usage: RESTORE.bat ^<path_to_backup_file^>
  echo.
  echo Available backups:
  dir /b backups\*.db 2>nul
  exit /b 1
)

set BACKUP_FILE=%~1

if not exist "!BACKUP_FILE!" (
  echo [ERROR] Backup file not found: !BACKUP_FILE!
  exit /b 1
)

node --experimental-strip-types scripts\sqlite-backup.mjs restore "!BACKUP_FILE!" "data\tinix_inbox.db"
if errorlevel 1 exit /b 1
echo [SUCCESS] Restore completed. Start Tinix Inbox and verify /health plus stored connection decryption.
