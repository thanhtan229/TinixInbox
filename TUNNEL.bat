@echo off
setlocal
title Tinix Inbox - Cloudflare Tunnel (Chatwoot Live Bridge)
echo =====================================================================
echo  [Tinix Inbox] Starting Cloudflare HTTPS Tunnel
echo  Target: http://127.0.0.1:3183 (callback-only relay)
echo =====================================================================
echo.
echo  Cloudflare Tunnel se cap cho ban mot dia chi HTTPS cong khai
echo  (vi du: https://xyz-abc.trycloudflare.com).
echo.
echo  HUONG DAN KET NOI VOI CHATWOOT:
echo  First launch CALLBACK-RELAY.bat in a separate terminal.
echo  Then copy the HTTPS link shown below.
echo  In Chatwoot: Settings ^> Inboxes ^> [API Inbox] ^> Configuration
echo  Set Callback Webhook URL to:
echo     https://[TEN-MIEN-CLOUDFLARE].trycloudflare.com/webhooks/chatwoot
echo  Save the Chatwoot API Inbox callback URL before testing.
echo.
echo =====================================================================
echo  Nhan Ctrl + C de dung tunnel khi khong su dung.
echo =====================================================================
echo.

set CLOUDFLARED_EXE="C:\Program Files (x86)\cloudflared\cloudflared.exe"

if not exist %CLOUDFLARED_EXE% (
  where cloudflared >nul 2>&1
  if %errorlevel% neq 0 (
    echo [ERROR] Khong tim thay cloudflared.exe. Vui long kiem tra lai duong dan!
    pause
    exit /b 1
  ) else (
    set CLOUDFLARED_EXE=cloudflared
  )
)

%CLOUDFLARED_EXE% tunnel --url http://127.0.0.1:3183
