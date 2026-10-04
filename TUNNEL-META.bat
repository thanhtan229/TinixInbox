@echo off
setlocal
title Tinix Inbox - Cloudflare Tunnel (Meta Facebook Webhook)
echo =====================================================================
echo  [Tinix Inbox] Starting Cloudflare HTTPS Tunnel for Meta Webhook
echo  Target: webhook-only relay http://127.0.0.1:3184
echo =====================================================================
echo.
echo  Cloudflare Tunnel se cap cho ban mot dia chi HTTPS cong khai
echo  (vi du: https://xyz-abc.trycloudflare.com).
echo.
echo  CACH SU DUNG VOI META / FACEBOOK MESSENGER:
echo  1. Copy duong link HTTPS ben duoi (dang https://...trycloudflare.com)
echo  2. Vao Meta for Developers ^> Messenger ^> Webhooks:
echo     Callback URL: https://[LINK-CLOUDFLARE]/webhooks/inbox/meta/[CONNECTION_ID]
echo     Verify Token: [Chuoi token ban da dat, vd: tinix_verify_2026]
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

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-meta-relay.ps1"
if errorlevel 1 exit /b 1
%CLOUDFLARED_EXE% tunnel --url http://127.0.0.1:3184
