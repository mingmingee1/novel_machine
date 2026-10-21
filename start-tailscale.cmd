@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.19 이상을 설치한 뒤 다시 실행하세요: https://nodejs.org/
  pause
  exit /b 1
)
node scripts/start-tailscale.mjs
pause
