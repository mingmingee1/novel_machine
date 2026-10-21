@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 goto folder_error
where.exe node >nul 2>nul
if errorlevel 1 goto node_missing
node "%~dp0scripts\start-tailscale.mjs"
set "NOVEL_START_EXIT=%errorlevel%"
popd
echo.
pause
exit /b %NOVEL_START_EXIT%

:node_missing
echo Please install Node.js 24.19 or newer: https://nodejs.org/
popd
pause
exit /b 1

:folder_error
echo Cannot open the app folder. Extract the ZIP before starting.
pause
exit /b 1
