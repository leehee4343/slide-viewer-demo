@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 슬라이드 뷰어를 시작합니다... (잠시 후 브라우저가 자동으로 열립니다)
node server.js
pause
