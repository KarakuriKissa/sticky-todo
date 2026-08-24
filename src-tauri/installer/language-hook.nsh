; NSIS installer hook — records the language chosen in the installer's
; language-selector dialog (tauri.conf.json: bundle.windows.nsis.languages +
; displayLanguageSelector) so the app can adopt it as its starting language
; on first launch. See src-tauri/src/commands.rs::get_install_language and
; src/i18n.ts::initLanguageFromInstall.
;
; $LANGUAGE holds the numeric Windows LCID of the language picked in the
; installer's selector dialog. Only Japanese (1041) and English-US (1033)
; are offered (see tauri.conf.json), so any other value falls back to "ja"
; — this app is Japanese-first.
;
; Deliberately written with plain StrCmp instead of LogicLib's ${If}: the hook
; is injected into Tauri's own installer.nsi, and relying on that template
; happening to include LogicLib.nsh would make the build fail for a reason
; that is hard to trace. StrCmp is a built-in instruction and needs nothing.
;
; $0 is a shared scratch register, so it is saved and restored around the hook
; to avoid clobbering whatever the surrounding template is holding in it.
!macro NSIS_HOOK_PREINSTALL
  Push $0
  StrCpy $0 "ja"
  StrCmp $LANGUAGE 1033 0 +2
    StrCpy $0 "en"
  WriteRegStr HKCU "Software\KarakuriKissa\StickyTodo" "Language" "$0"
  Pop $0
!macroend
