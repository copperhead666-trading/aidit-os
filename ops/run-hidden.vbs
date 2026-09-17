' run-hidden.vbs — Jalankan perintah tanpa jendela console (window style 0).
' Digunakan oleh scheduled task Aidit OS agar tidak flash setiap 5 menit.
' Pemakaian: wscript.exe //B "D:\path\to\run-hidden.vbs" "exe" "arg1" "arg2" ...
'            atau   wscript.exe "D:\path\to\run-hidden.vbs" "full command line"
' Versi sederhana: argumen pertama executable, sisanya argumen.
Dim strArgs, i
strArgs = ""
For i = 0 To WScript.Arguments.Count - 1
  strArgs = strArgs & Chr(34) & WScript.Arguments(i) & Chr(34) & " "
Next
If Len(strArgs) > 0 Then
  CreateObject("WScript.Shell").Run Trim(strArgs), 0, False
End If