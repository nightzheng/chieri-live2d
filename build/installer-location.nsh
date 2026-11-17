; Recognize an old installation even if its registration was lost.
; Never run executables found in the selected directory.
!macro chieriDetectPayload DIR OUT
  StrCpy ${OUT} 0
  ${If} ${FileExists} "${DIR}\${APP_EXECUTABLE_FILENAME}"
  ${AndIf} ${FileExists} "${DIR}\resources\app.asar"
  ${AndIf} ${FileExists} "${DIR}\resources.pak"
    StrCpy ${OUT} 1
  ${EndIf}
!macroend

!macro chieriResolveInstallLocation
Function ChieriReadPreviousDir
  ReadRegStr $ChieriPreviousDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $ChieriPreviousDir != ""
    GetFullPathName $ChieriPreviousDir "$ChieriPreviousDir\."
  ${EndIf}
  GetFullPathName $INSTDIR "$INSTDIR\."
FunctionEnd

Function ChieriPrepareInstallDir
  Call ChieriReadPreviousDir
  Call ChieriCheckInstallDir
  ${If} $2 != 1
    ; Use the builder's usual application subfolder rule for fresh locations.
    Call instFilesPre
  ${EndIf}
FunctionEnd

; $2 = 1 for an existing Chieri location, 0 for empty, 2 for unrelated files.
Function ChieriCheckInstallDir
  ${If} $ChieriPreviousDir == $INSTDIR
    StrCpy $2 1
    Return
  ${EndIf}
  !insertmacro chieriDetectPayload "$INSTDIR" $2
  ${If} $2 == 1
    Return
  ${EndIf}
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  ${IfNot} ${Errors}
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        StrCpy $2 2
        ${ExitDo}
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
FunctionEnd
!macroend
