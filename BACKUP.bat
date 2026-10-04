@echo off
setlocal enabledelayedexpansion

echo [Tinix Inbox] Creating a consistent SQLite snapshot, including committed WAL data...
node --experimental-strip-types scripts\sqlite-backup.mjs backup
if errorlevel 1 exit /b 1
echo [Tinix Inbox] Back up the credential key through the approved secret store separately from this database file.
