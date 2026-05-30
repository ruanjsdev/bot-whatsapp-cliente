@echo off
setlocal

set "TASK_NAME=Bot WhatsApp API"

echo Removendo inicializacao automatica do Bot WhatsApp...
schtasks /Delete /TN "%TASK_NAME%" /F

echo.
echo Tarefa removida, se ela existia.
pause
