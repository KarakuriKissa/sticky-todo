import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';

// Detects file-system paths so we can open them in Explorer / Finder.
const WIN_DRIVE = /^[A-Za-z]:[\\/]/;       // C:\Users\... or C:/Users/...
const UNC_PATH = /^\\\\[^\\]+\\/;          // \\server\share
const UNIX_PATH = /^\/[^\s/][^\s]*$/;      // /Users/... (avoid matching "//")
// Any URI scheme:  http://, https://, ftp://, onenote://, myapp://, file:// ...
const ANY_SCHEME = /^[a-z][a-z0-9+.\-]*:\/\//i;

export function looksLikePath(s: string): boolean {
  return WIN_DRIVE.test(s) || UNC_PATH.test(s) || UNIX_PATH.test(s);
}

export function isUrl(s: string): boolean {
  return ANY_SCHEME.test(s);
}
function isHttp(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

// Open a URL or filesystem path with the OS.
//  - http(s) URLs honor the "preferred browser" setting (falls back to default).
//  - Other URI schemes (custom protocols) are handed to the OS handler.
//  - File/folder paths open in Explorer / Finder via a dedicated command so
//    they reliably launch the file manager.
export async function openExternal(target: string): Promise<void> {
  const t = target.trim();
  if (isHttp(t)) {
    const browser = useAppStore.getState().settings.browser_path;
    if (browser && browser.trim()) {
      try { await invoke('open_url_with', { url: t, browser }); return; }
      catch { /* fall through to default browser */ }
    }
    shellOpen(t).catch(() => {});
    return;
  }
  if (isUrl(t)) {
    // Custom protocol (e.g. company tools). Let the OS protocol handler open it.
    shellOpen(t).catch(() => {});
    return;
  }
  // Filesystem path → open the file manager. shellOpen() is unreliable for
  // bare folder paths on Windows, so use our explorer/open/xdg-open command.
  try { await invoke('open_path', { path: t }); }
  catch { shellOpen(t).catch(() => {}); }
}
