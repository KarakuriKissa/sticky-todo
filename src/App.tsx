import { useEffect } from 'react';
import { Launcher } from './windows/Launcher';
import { NoteWindow } from './windows/Note';
import { useAppStore } from './store/appStore';
import { initLanguageFromInstall } from './i18n';

export function App() {
  const load = useAppStore((s) => s.load);

  const params = new URLSearchParams(window.location.search);
  const windowType = params.get('window') ?? 'launcher';
  const noteId = params.get('id');

  // Preload global state for note windows too (for statuses/settings)
  useEffect(() => {
    load();
  }, []);

  // First-launch only: adopt the language chosen in the installer (see
  // src/i18n.ts). No-op on every later launch / launch of a second window.
  useEffect(() => {
    initLanguageFromInstall();
  }, []);

  if (windowType === 'note' && noteId) {
    return <NoteWindow noteId={noteId} />;
  }

  return <Launcher />;
}
