; Desktop shortcut policy: never create a new icon at install time. If the user
; already has one, refresh it so it points at the freshly installed binary.
;
; The default template creates the desktop shortcut for silent installs before
; NSIS_HOOK_POSTINSTALL runs, so PREINSTALL records whether it existed and
; POSTINSTALL removes the newly created one when it did not.

!macro NSIS_HOOK_PREINSTALL
  StrCpy $R9 1
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" leonssh_desktop_pre_done
  StrCpy $R9 0
  leonssh_desktop_pre_done:
  FileOpen $0 "$TEMP\leonssh-desktop-had.tmp" w
  FileWrite $0 "$R9"
  FileClose $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R9 0
  FileOpen $0 "$TEMP\leonssh-desktop-had.tmp" r
  FileRead $0 $R9
  FileClose $0
  Delete "$TEMP\leonssh-desktop-had.tmp"
  StrCmp $R9 "1" leonssh_desktop_refresh
  ; No previous icon: drop the one the silent installer just created.
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  Goto leonssh_desktop_post_done
  leonssh_desktop_refresh:
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  leonssh_desktop_post_done:
!macroend
