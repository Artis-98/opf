Option Explicit
Dim shell, files, script, root
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
script = files.BuildPath(root, "scripts\launch.cjs")
shell.CurrentDirectory = root
shell.Run "node.exe " & Chr(34) & script & Chr(34) & " --quiet", 0, False
