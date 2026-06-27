@echo off
echo ===================================================
echo  ระบบบริหารงานจ้างเหมาตัดสายไฟ - วิสาหกิจชุมชน
echo ===================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] ยังไม่ได้ติดตั้ง Node.js
    echo กรุณาดาวน์โหลดจาก https://nodejs.org แล้วรันไฟล์นี้ใหม่
    pause
    exit /b 1
)

:: Install backend deps if needed
if not exist "node_modules" (
    echo [1/2] กำลังติดตั้ง Backend dependencies...
    npm install
)

:: Install frontend deps if needed
if not exist "client\node_modules" (
    echo [2/2] กำลังติดตั้ง Frontend dependencies...
    cd client && npm install && cd ..
)

echo.
echo กำลังเริ่มระบบ...
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo กด Ctrl+C เพื่อหยุดระบบ
echo.

:: Start backend and frontend concurrently
start "Backend" cmd /k "cd /d %~dp0 && npx ts-node-dev --respawn --transpile-only server/index.ts"
timeout /t 3 /nobreak >nul
start "Frontend" cmd /k "cd /d %~dp0\client && npx vite"
timeout /t 3 /nobreak >nul
start http://localhost:5173
