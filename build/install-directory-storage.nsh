!include "LogicLib.nsh"
!include "FileFunc.nsh"

; Updates and ordinary uninstall remove program files only. Dependencies and personal data
; belong to the installation, but must survive replacing its executable/resources.
!macro customRemoveFiles
  Var /GLOBAL tcPiEntry
  Var /GLOBAL tcPiSearch
  SetOutPath "$TEMP"
  FindFirst $tcPiSearch $tcPiEntry "$INSTDIR\*"
  ${DoWhile} $tcPiEntry != ""
    ${If} $tcPiEntry != "."
    ${AndIf} $tcPiEntry != ".."
    ${AndIf} $tcPiEntry != "data"
    ${AndIf} $tcPiEntry != "runtimes"
      ${GetFileAttributes} "$INSTDIR\$tcPiEntry" "DIRECTORY" $R2
      ${If} $R2 == 1
        RMDir /r "$INSTDIR\$tcPiEntry"
      ${Else}
        Delete "$INSTDIR\$tcPiEntry"
      ${EndIf}
    ${EndIf}
    FindNext $tcPiSearch $tcPiEntry
  ${Loop}
  FindClose $tcPiSearch
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\runtimes"
!macroend

; Explicit opt-in for administrators/scripts; normal uninstall keeps both directories.
!macro customUnInstallSection
  Section "TC-Pi local data"
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--delete-local-data" $R1
    ${IfNot} ${Errors}
      ${IfNot} ${isUpdated}
        RMDir /r "$INSTDIR\data"
        RMDir /r "$INSTDIR\runtimes"
        RMDir "$INSTDIR"
      ${EndIf}
    ${EndIf}
  SectionEnd
!macroend
