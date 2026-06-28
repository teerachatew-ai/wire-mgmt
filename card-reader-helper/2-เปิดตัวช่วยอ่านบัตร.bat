@echo off
chcp 65001 >nul
title ตัวช่วยอ่านบัตรประชาชน - เปิดทิ้งไว้ระหว่างใช้งาน
cd /d %~dp0

if not exist "node_modules\pcsclite" (
    echo [!] ยังไม่ได้ติดตั้ง — กรุณาดับเบิลคลิก "1-ติดตั้งครั้งแรก.bat" ก่อน
    echo.
    pause
    exit /b 1
)

node helper.js
echo.
echo (ตัวช่วยปิดการทำงานแล้ว)
pause
