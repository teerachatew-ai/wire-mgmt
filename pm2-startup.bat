@echo off
set PATH=C:\Program Files\nodejs;C:\Users\ngd58004\AppData\Roaming\npm;%PATH%
cd /d "D:\Claude Code\wire-mgmt"
call pm2 resurrect
