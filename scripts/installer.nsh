; Keep build versions internal and show only the product name to users.
!macro customHeader
  BrandingText "${PRODUCT_NAME}"
!macroend

!macro customInstall
  ; This value is only the version displayed in Windows Installed Apps.
  ; Package metadata remains available for future builds and diagnostics.
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
!macroend
