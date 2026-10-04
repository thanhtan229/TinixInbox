@echo off
setlocal
chcp 65001 >nul
title Tinix Inbox - Thêm Fanpage Facebook Mới
cd /d "%~dp0"

echo =====================================================================
echo    TINIX INBOX - KẾT NỐI FANPAGE FACEBOOK MỚI
echo =====================================================================
echo.
echo  Bạn chỉ cần dán Mã truy cập trang (Page Access Token) vừa lấy được.
echo  Hệ thống sẽ tự động:
echo    1. Nhận diện tên Fanpage và Page ID từ Facebook
echo    2. Kích hoạt nhận tin nhắn Webhook
echo    3. Tạo Hộp thư Chatwoot tự động
echo    4. Cập nhật vào Tinix Inbox
echo.
echo =====================================================================
echo.

set /p TOKEN="Dán Page Access Token vào đây rồi nhấn Enter: "

if "%TOKEN%"=="" (
    echo [LỖI] Bạn chưa nhập mã truy cập!
    pause
    exit /b 1
)

echo.
echo Đang xử lý kết nối, vui lòng chờ giây lát...
echo.

node --env-file=.env --experimental-strip-types scripts/add-meta-page.mjs "%TOKEN%"

if %errorlevel% equ 0 (
    echo.
    echo =====================================================================
    echo  KẾT NỐI HOÀN TẤT!
    echo  Bạn có thể mở http://127.0.0.1:3182 để bắt đầu nhận tin nhắn.
    echo =====================================================================
) else (
    echo.
    echo [LỖI] Quá trình kết nối gặp sự cố. Vui lòng kiểm tra lại mã truy cập.
)

echo.
pause
