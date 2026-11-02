@echo off
setlocal
cd /d "%~dp0"
set "NODE=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Zhezhi necesita Node.js 20 o superior. Instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
  )
)
if not exist "node_modules\ws" (
  echo Faltan las dependencias. Ejecuta "Instalar Zhezhi.bat" primero.
  pause
  exit /b 1
)
set "ZHEZHI_OPEN_BROWSER=1"
"%NODE%" server.js
if errorlevel 1 pause
