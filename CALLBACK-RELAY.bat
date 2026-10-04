@echo off
setlocal
cd /d "%~dp0"
echo [Tinix Inbox] Starting callback-only relay on 127.0.0.1:3183.
echo Only Chatwoot callback POST requests are forwarded to Tinix on port 3182.
node poc\chatwoot-v418\tinix-callback-relay.mjs
