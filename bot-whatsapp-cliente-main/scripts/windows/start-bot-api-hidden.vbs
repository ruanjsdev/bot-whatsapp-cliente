Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-bot-api.bat")
shell.Run """" & scriptPath & """", 0, False
