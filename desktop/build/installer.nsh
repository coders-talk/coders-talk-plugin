; Added to the NSIS installer by electron-builder (build/installer.nsh).
;
; The installer keeps a copy of itself in %LOCALAPPDATA%\<name>-updater\installer.exe (about 135 MB): the base the
; app's updates download only the changed blocks against. electron-builder's uninstaller leaves that folder behind, so a
; real uninstall takes it away. An update runs the old version's uninstaller too (isUpdated), and the copy must stay then.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !ifdef APP_INSTALLER_STORE_FILE
      Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    !endif
  ${endIf}
!macroend
