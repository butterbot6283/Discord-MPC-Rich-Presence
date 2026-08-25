Option Explicit

Dim shell, fso, scriptDir, nodeCmd, jsPath, env
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
jsPath = fso.BuildPath(scriptDir, "menu.js")

shell.CurrentDirectory = scriptDir
Set env = shell.Environment("PROCESS")
env("MPC_UI") = "winforms"

nodeCmd = "node.exe --no-warnings """ & jsPath & """"

' 0 = hide Node console; False = do not wait.
shell.Run nodeCmd, 0, False

Set env = Nothing
Set fso = Nothing
Set shell = Nothing
