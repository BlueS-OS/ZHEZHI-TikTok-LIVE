@echo off
setlocal
title Instalar Zhezhi
cd /d "%~dp0"

echo ========================================
echo       ZHEZHI - instalacion inicial
echo ========================================
echo.

set "NODE=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 (
  set "NODE=%ProgramFiles%\nodejs\node.exe"
  if not exist "%ProgramFiles%\nodejs\node.exe" goto :missing_node
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

"%NODE%" -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 goto :old_node

set "NPM=npm.cmd"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  set "NPM=%ProgramFiles%\nodejs\npm.cmd"
  if not exist "%ProgramFiles%\nodejs\npm.cmd" goto :missing_npm
)

echo Instalando dependencias. Esto puede tardar unos minutos...
echo.
if exist "package-lock.json" (
  call "%NPM%" ci --no-audit --no-fund
) else (
  call "%NPM%" install --no-audit --no-fund
)
if errorlevel 1 goto :failed

echo.
echo ========================================
echo  Instalacion completada.
echo  Abre "Iniciar Zhezhi.bat" para empezar.
echo ========================================
pause
exit /b 0

:missing_node
echo No encuentro Node.js. Instala la version LTS desde https://nodejs.org/
echo Despues, vuelve a ejecutar este archivo.
pause
exit /b 1

:old_node
echo Zhezhi necesita Node.js 20 o posterior.
echo Actualiza Node.js desde https://nodejs.org/ y vuelve a intentarlo.
pause
exit /b 1

:missing_npm
echo No encuentro npm. Reinstala Node.js desde https://nodejs.org/
echo Asegurate de incluir npm durante la instalacion.
pause
exit /b 1

:failed
echo.
echo No pude instalar las dependencias. Comprueba tu conexion a Internet
echo y vuelve a ejecutar "Instalar Zhezhi.bat". El error aparece arriba.
pause
exit /b 1
