@echo off
setlocal

set "TASK_NAME=Bot WhatsApp API"
set "STARTUP_SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Bot WhatsApp API.lnk"

echo Removendo inicializacao automatica do Bot WhatsApp...
schtasks /Delete /TN "%TASK_NAME%" /F

if exist "%STARTUP_SHORTCUT%" del "%STARTUP_SHORTCUT%"

echo.
echo Tarefa removida, se ela existia.
pause
