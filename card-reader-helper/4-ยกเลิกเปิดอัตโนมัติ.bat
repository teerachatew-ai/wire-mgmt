@echo off
chcp 65001 >nul
title ยกเลิกเปิดอัตโนมัติ - ตัวช่วยอ่านบัตร

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\ตัวช่วยอ่านบัตรประชาชน (เปิดอัตโนมัติ).bat"

if exist "%LAUNCHER%" (
    del "%LAUNCHER%"
    echo ยกเลิกการเปิดอัตโนมัติแล้ว ✅
    echo (ต่อไปต้องดับเบิลคลิก "2-เปิดตัวช่วยอ่านบัตร.bat" เองก่อนใช้งาน)
) else (
    echo ยังไม่เคยตั้งค่าเปิดอัตโนมัติไว้ในเครื่องนี้
)
echo.
pause
