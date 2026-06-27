@echo off
chcp 65001 >nul
title ระบบบริหารงานจ้างเหมาตัดสายไฟ
set PATH=C:\Program Files\nodejs;C:\Users\ngd58004\AppData\Roaming\npm;%PATH%
cd /d %~dp0

echo.
echo  ========================================
echo   ระบบบริหารงานจ้างเหมาตัดสายไฟ
echo   วิสาหกิจชุมชน
echo  ========================================
echo.
echo  [1/2] ตรวจสอบ PM2...

:: Check if PM2 is already running
pm2 list 2>nul | findstr /i "wire-backend" >nul
if %ERRORLEVEL%==0 (
    echo  PM2 ทำงานอยู่แล้ว กำลังรีสตาร์ท tunnel...
    pm2 restart wire-tunnel >nul 2>&1
) else (
    echo  เริ่ม PM2...
    del /q "%~dp0tunnel.log" >nul 2>&1
    pm2 start ecosystem.config.js >nul 2>&1
)
pm2 save >nul 2>&1

echo  [2/2] รอ link ออนไลน์ (20 วินาที)...
timeout /t 20 /nobreak >nul

:: เปิด Browser
start http://localhost:3001

echo.
echo  ========================================
echo   ✅ ระบบพร้อมใช้งาน
echo.
echo   💻 เปิดในคอม:
echo      http://localhost:3001
echo.
echo   📱 LINK สำหรับมือถือ:
for /f "tokens=*" %%i in ('findstr /i "trycloudflare.com" "%~dp0tunnel.log" 2^>nul') do (
    echo      %%i
)
echo  ========================================
echo.
echo  *** ระบบจะทำงานตลอดโดยอัตโนมัติ ***
echo  *** ไม่ต้องกังวลถ้าปิดหน้าต่างนี้ ***
echo.
pause
