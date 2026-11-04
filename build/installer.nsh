; Installer look and words (included by electron-builder's NSIS template)

!macro customHeader
  ; soft pink pages to go with the sidebar artwork
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "FFF5F9"
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "3F3852"
  !ifndef BUILD_UNINSTALLER
    !define MUI_FINISHPAGE_TITLE "千绘莉已经搬进来啦"
    !ifdef CHIERI_FULL
      ; the full edition carries the voice model (installer-full.nsh defines this)
      !define MUI_FINISHPAGE_TEXT "安装完成。$\r$\n$\r$\n她可以待在主窗口里，也可以单独站在你的桌面上。摸摸头、戳戳脸、拉拉尾巴都行，在设置里接上 AI 之后还能和她聊天。$\r$\n$\r$\n鼠标太久不动的话，她会自己睡着哦。$\r$\n$\r$\n内置声线：感谢模型提供者，B站id：雪村落雪提供的模型。"
    !else
      !define MUI_FINISHPAGE_TEXT "安装完成。$\r$\n$\r$\n她可以待在主窗口里，也可以单独站在你的桌面上。摸摸头、戳戳脸、拉拉尾巴都行，在设置里接上 AI 之后还能和她聊天。$\r$\n$\r$\n鼠标太久不动的话，她会自己睡着哦。"
    !endif
    !define MUI_FINISHPAGE_RUN_TEXT "现在就去见她"
  !endif
!macroend

; A local voice server (python.exe running voice\chieri_server.py) still loading when the old version was
; closed keeps files in the install folder open, and an update then cannot replace them (the old model
; stays, or old and new files get mixed). Stop any before installing or uninstalling (python processes
; only: the PowerShell doing it has the file name in its own command line).
!macro chieriStopVoice
  Push $0   ; kept for the code around (nsExec leaves its exit code on the stack)
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -like 'python*' -and $$_.CommandLine -like '*chieri_server.py*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Pop $0
!macroend
!macro customInit
  !insertmacro chieriStopVoice
!macroend
!macro customUnInit
  !insertmacro chieriStopVoice
!macroend

; "开机自动启动" is a Run value named after the AppUserModelId (electron/main.js); Task Manager keeps its
; on / off next to it in StartupApproved. Remove both on a real uninstall, not when an update runs the old uninstaller.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.lizitcxyz.nekomimi"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.lizitcxyz.nekomimi"
  ${endIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎来到千绘莉的小窝"
  !define MUI_WELCOMEPAGE_TEXT "接下来会把猫耳少女「雪村千绘莉」安装到这台电脑上。$\r$\n$\r$\n她是一只 Live2D 风格的桌面宠物：会眨眼、呼吸、东张西望，被拽耳朵会生气，被摸头会呼噜呼噜。$\r$\n$\r$\n点「下一步」继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
