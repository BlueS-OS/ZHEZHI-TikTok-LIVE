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
"%NODE%" -e "for (const name of ['ws', 'msedge-tts', 'tiktok-live-connector']) require.resolve(name)" >nul 2>nul
if errorlevel 1 (
  echo Faltan dependencias. Ejecutando el instalador...
  call "%~dp0Instalar Zhezhi.bat"
  if errorlevel 1 exit /b 1
  exit /b 0
)
powershell.exe -NoProfile -Command "try { $p=(Get-Content 'config.json' -Raw | ConvertFrom-Json).port; if (-not $p) { $p=5180 }; $u='http://127.0.0.1:'+$p+'/'; $r=Invoke-RestMethod ($u+'api/health') -TimeoutSec 2; if ($r.ok -and $r.version) { Start-Process $u; exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Zhezhi ya esta abierto. Abriendo el panel en el navegador...
  exit /b 0
)
set "ZHEZHI_OPEN_BROWSER=1"
"%NODE%" server.js
if errorlevel 1 pause
