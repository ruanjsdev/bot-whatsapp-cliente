@echo off
setlocal

set "TASK_NAME=Bot WhatsApp API"
set "SCRIPT=%~dp0start-bot-api-hidden.vbs"
set "TR=wscript.exe \"%SCRIPT%\""

echo Instalando inicializacao automatica do Bot WhatsApp...
echo.

schtasks /Create /TN "%TASK_NAME%" /SC ONLOGON /TR "%TR%" /F

if errorlevel 1 (
  echo.
  echo Nao foi possivel criar a tarefa automatica.
  echo Tente executar este arquivo como administrador.
  pause
  exit /b 1
)

echo.
echo Pronto. O servidor do bot vai iniciar automaticamente quando o Windows entrar na conta deste usuario.
echo.
echo Testando inicio agora...
wscript.exe "%SCRIPT%"
echo.
echo Se o Windows pedir permissao de firewall para o Node.js, clique em Permitir acesso.
echo Logs:
echo   logs\bot-api.log
echo   logs\bot-api-startup.log
echo.
pause
