// Vitest setup — runs before every test file.
// Stubs the Tauri invoke API so the noteStore can run in jsdom.
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === 'get_note_items') return [];
    if (cmd === 'save_items') return undefined;
    if (cmd === 'save_item') return undefined;
    if (cmd === 'delete_item') return undefined;
    return undefined;
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  emitTo: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));
