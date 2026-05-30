@echo off
setlocal

cd /d "%~dp0..\.."

if not exist "logs" mkdir "logs"

echo [%date% %time%] Iniciando Bot WhatsApp API...>> "logs\bot-api-startup.log"

where node >nul 2>nul
if errorlevel 1 (
  echo [%date% %time%] ERRO: Node.js nao encontrado no PATH.>> "logs\bot-api-startup.log"
  exit /b 1
)

if not exist "node_modules" (
  echo [%date% %time%] Instalando dependencias...>> "logs\bot-api-startup.log"
  call npm install >> "logs\bot-api-startup.log" 2>&1
)

call npm run mobile >> "logs\bot-api.log" 2>&1
