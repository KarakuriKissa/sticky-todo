// Custom hook — registers the Tauri onCloseRequested handler ONCE for the
// lifetime of a note window. Handles:
//   1. Flush items to SQLite with up to 3 retries
//   2. Confirm with the user if all retries fail
//   3. Persist window geometry (best-effort, never blocks close)
//   4. Notify the launcher we are closing
//   5. appWin.destroy() to actually close
import { useEffect, MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Note } from '../../types';
import { log } from '../../utils/log';

// Minimal subset of the Tauri window API we actually use here. Letting the
// caller pass either Window or WebviewWindow without forcing an import.
interface AppWindow {
  onCloseRequested: (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => Promise<() => void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  outerSize: () => Promise<{ width: number; height: number }>;
  scaleFactor: () => Promise<number>;
  destroy: () => Promise<void>;
}

interface Args {
  appWin: AppWindow;
  noteRef: MutableRefObject<Note | null>;
  closingRef: MutableRefObject<boolean>;
  noteId: string;
  flush: () => Promise<void>;
  updateNote: (n: Note) => void;
  trackWindowClose: (id: string) => Promise<void>;
  setClosingOverlay: (s: null | 'saving' | 'failed') => void;
}

export function useCloseHandler({
  appWin, noteRef, closingRef, noteId,
  flush, updateNote, trackWindowClose, setClosingOverlay,
}: Args) {
  useEffect(() => {
    const unlisten = appWin.onCloseRequested(async (event) => {
      if (closingRef.current) return;
      event.preventDefault();
      closingRef.current = true;
      setClosingOverlay('saving');

      // 1. Flush with up to 3 retries
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await flush();
          saved = true;
          break;
        } catch (e) {
          log.error(`flush attempt ${attempt + 1} failed:`, e);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!saved) {
        setClosingOverlay('failed');
        const ok = window.confirm(
          '保存に失敗しました。\nこのまま閉じると最後の変更が失われる可能性があります。\nそれでも閉じますか？',
        );
        if (!ok) {
          closingRef.current = false;
          setClosingOverlay(null);
          return;
        }
      }

      // 2. Persist window geometry (best-effort)
      const currentNote = noteRef.current;
      if (currentNote) {
        try {
          const pos = await appWin.outerPosition();
          const size = await appWin.outerSize();
          const scale = await appWin.scaleFactor();
          const updated: Note = {
            ...currentNote,
            window_x: pos.x / scale,
            window_y: pos.y / scale,
            window_width: size.width / scale,
            window_height: size.height / scale,
          };
          updateNote(updated);
          await invoke('save_note', { note: updated });
        } catch (posErr) {
          log.warn('Could not save window geometry:', posErr);
        }
      }

      try { await trackWindowClose(noteId); } catch { /* ignore */ }
      appWin.destroy();
    });
    return () => { unlisten.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
