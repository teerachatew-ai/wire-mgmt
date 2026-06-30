@echo off
chcp 65001 >/dev/null
cd /d %~dp0
set PATH=C:\Program Files\nodejs;%PATH%
node cloud-backup.js
