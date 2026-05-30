@echo off
setlocal

set "TASK_NAME=Bot WhatsApp API"
set "SCRIPT=%~dp0start-bot-api-hidden.vbs"
set "TR=wscript.exe \"%SCRIPT%\""
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_SHORTCUT=%STARTUP_DIR%\Bot WhatsApp API.lnk"

echo Instalando inicializacao automatica do Bot WhatsApp...
echo.

schtasks /Create /TN "%TASK_NAME%" /SC ONLOGON /TR "%TR%" /RL LIMITED /F

if errorlevel 1 (
  echo.
  echo Nao foi possivel criar a tarefa no Agendador.
  echo Tentando instalar pela pasta Inicializar do usuario...
  echo.

  if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"

  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%STARTUP_SHORTCUT%'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%SCRIPT%\"'; $s.WorkingDirectory='%~dp0..\..'; $s.WindowStyle=7; $s.Description='Inicia o servidor do Bot WhatsApp'; $s.Save()"

  if errorlevel 1 (
    echo.
    echo Nao foi possivel criar o atalho de inicializacao.
    echo Clique com o botao direito neste arquivo e escolha "Executar como administrador".
    pause
    exit /b 1
  )

  echo Inicializacao instalada pela pasta Inicializar.
  goto test_start
)

echo.
echo Pronto. O servidor do bot vai iniciar automaticamente quando o Windows entrar na conta deste usuario.
echo.

:test_start
echo Testando inicio agora...
wscript.exe "%SCRIPT%"
echo.
echo Se o Windows pedir permissao de firewall para o Node.js, clique em Permitir acesso.
echo Logs:
echo   logs\bot-api.log
echo   logs\bot-api-startup.log
echo.
pause
