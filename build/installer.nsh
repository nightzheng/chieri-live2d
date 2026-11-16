; Installer look and words (included by electron-builder's NSIS template)

!macro customHeader
  !insertmacro chieriCloseFunction
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

; Run the same native check for setup and uninstall. The previous install path is
; taken from electron-builder's existing per-user registry key, even when $INSTDIR changed.
!ifdef BUILD_UNINSTALLER
  !define CHIERI_SCOPE "un."
!else
  !define CHIERI_SCOPE ""
  Var ChieriPreviousDir
!endif

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $ChieriPreviousDir HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $ChieriPreviousDir != ""
    ${AndIf} $ChieriPreviousDir != $INSTDIR
      Push $ChieriPreviousDir
      Call ChieriClose
    ${EndIf}
  !endif
  !ifndef BUILD_UNINSTALLER
    ${If} $ChieriPreviousDir != $INSTDIR
      FindFirst $0 $1 "$INSTDIR\*"
      ${DoWhile} $1 != ""
        ${If} $1 != "."
        ${AndIf} $1 != ".."
          FindClose $0
          MessageBox MB_OK|MB_ICONEXCLAMATION "所选的新安装目录已有文件。请重新运行安装程序并选择空目录。" /SD IDOK
          SetErrorLevel 2
          Quit
        ${EndIf}
        FindNext $0 $1
      ${Loop}
      FindClose $0
    ${EndIf}
  !endif
  Push $INSTDIR
  Call ${CHIERI_SCOPE}ChieriClose
!macroend

!macro chieriBusy FILE
  ${If} ${FileExists} "${FILE}"
    System::Call 'kernel32::CreateFileW(w "${FILE}", i 0x40000000, i 0, p 0, i 3, i 0x80, p 0) p.r3'
    ${If} $3 == -1
      StrCpy $7 1
    ${Else}
      System::Call 'kernel32::CloseHandle(p r3)'
    ${EndIf}
  ${EndIf}
!macroend

!macro chieriCloseFunction
Function ${CHIERI_SCOPE}ChieriClose
  Pop $8
  StrCpy $9 "$8\${APP_EXECUTABLE_FILENAME}"
chieri_retry:
  StrCpy $0 0
  StrCpy $7 0
  ${Do}
    FindWindow $0 "Chrome_WidgetWin_1" "" 0 $0
    ${If} $0 == 0
      ${ExitDo}
    ${EndIf}
    System::Call 'user32::GetWindowThreadProcessId(p r0, *i.r1)'
    System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r1) p.r2'
    ${If} $2 != 0
      StrCpy $4 ${NSIS_MAX_STRLEN}
      System::Call 'kernel32::QueryFullProcessImageNameW(p r2, i 0, w .r3, *i r4) i.r5'
      System::Call 'kernel32::CloseHandle(p r2)'
      ${If} $5 != 0
      ${AndIf} $3 == $9
        System::Call 'user32::PostMessageW(p r0, i 0x0010, p 0, p 0)'
        StrCpy $7 1
      ${EndIf}
    ${EndIf}
  ${Loop}
  ${If} $7 == 1
    Sleep 3500
    StrCpy $7 0
  ${EndIf}
  !insertmacro chieriBusy "$9"
  !insertmacro chieriBusy "$8\resources\app.asar"
  !insertmacro chieriBusy "$8\resources\voice\chieri_server.py"
  !insertmacro chieriBusy "$8\resources\voice\Chieri_GPTSoVITS_20261103\delivery\chieri-gpt.ckpt"
  !insertmacro chieriBusy "$8\resources\voice\Chieri_GPTSoVITS_20261103\delivery\chieri-sovits.pth"
  ${If} $7 == 1
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "千绘莉或本地语音文件还在使用。请从系统托盘退出千绘莉，等待语音进程关闭，再点重试。" /SD IDCANCEL IDRETRY chieri_retry
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd
!macroend

; Block the template's optional destructive argument in both binaries.
!macro chieriRejectDeleteAppData
  ${If} ${isDeleteAppData}
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装和卸载会保留个人数据。请不带删除数据的参数重新运行。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
!macro customInit
  !insertmacro chieriRejectDeleteAppData
!macroend
!macro customUnInit
  !insertmacro chieriRejectDeleteAppData
!macroend

!macro customInstall
  ${If} $ChieriPreviousDir != ""
  ${AndIf} $ChieriPreviousDir != $INSTDIR
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.lizitcxyz.nekomimi"
    StrCpy $1 '"$ChieriPreviousDir\${APP_EXECUTABLE_FILENAME}" --autostart'
    ${If} $0 == $1
      StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.lizitcxyz.nekomimi" $1
    ${EndIf}
  ${EndIf}
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
