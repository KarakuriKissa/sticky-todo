import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';

// Detects file-system paths so we can open them in Explorer / Finder.
const WIN_DRIVE = /^[A-Za-z]:[\\/]/;       // C:\Users\... or C:/Users/...
const UNC_PATH = /^\\\\[^\\]+\\/;          // \\server\share
const UNIX_PATH = /^\/[^\s/][^\s]*$/;      // /Users/... (avoid matching "//")

export function looksLikePath(s: string): boolean {
  return WIN_DRIVE.test(s) || UNC_PATH.test(s) || UNIX_PATH.test(s);
}

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

// Open a URL or filesystem path with the OS.
//  - URLs honor the user's "preferred browser" setting (falls back to default).
//  - Paths open in the OS file manager / default app.
export async function openExternal(target: string): Promise<void> {
  if (isUrl(target)) {
    const browser = useAppStore.getState().settings.browser_path;
    if (browser && browser.trim()) {
      try {
        await invoke('open_url_with', { url: target, browser });
        return;
      } catch {
        /* fall through to default browser */
      }
    }
    shellOpen(target).catch(() => {});
    return;
  }
  // File / folder path → Explorer (Windows), Finder (macOS), xdg-open (Linux).
  shellOpen(target).catch(() => {});
}
