import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { AppSettings, AssigneeGroup, AssigneePerson, Category, Note, SortMode, Status } from '../types';

interface AppStore {
  notes: Note[];
  categories: Category[];
  statuses: Status[];
  assigneeGroups: AssigneeGroup[];
  assigneePersons: AssigneePerson[];
  settings: AppSettings;
  selectedCategoryId: string | null;
  searchQuery: string;
  openWindowIds: Set<string>;

  load: () => Promise<void>;
  reopenSavedWindows: () => Promise<void>;

  // Notes
  createNote: (title?: string) => Promise<Note>;
  updateNote: (note: Note) => void;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<Note>;
  openNote: (note: Note) => Promise<void>;
  trackWindowClose: (noteId: string) => Promise<void>;
  reorderNotes: (ids: string[]) => void;

  // Categories
  saveCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (ids: string[]) => void;

  // Statuses
  saveStatus: (s: Status) => Promise<void>;
  deleteStatus: (id: string) => Promise<void>;

  // Assignee groups
  saveAssigneeGroup: (g: AssigneeGroup) => Promise<void>;
  deleteAssigneeGroup: (id: string) => Promise<void>;
  saveAssigneePerson: (p: AssigneePerson) => Promise<void>;
  deleteAssigneePerson: (id: string) => Promise<void>;

  // Settings
  saveSettings: (s: AppSettings) => Promise<void>;

  // UI state
  setSelectedCategory: (id: string | null) => void;
  setSearchQuery: (q: string) => void;

  // Derived
  filteredNotes: () => Note[];
}

const DEFAULT_SETTINGS: AppSettings = {
  sort_mode: 'manual',
  feature_status: true,
  feature_assignee: true,
  feature_date: true,
  feature_memo: true,
  feature_priority: true,
  active_group_id: null,
  deadline_warn_days: 3,
  priority_mode: 'hml' as const,
};

function now() {
  return new Date().toISOString();
}

function sorted(notes: Note[], mode: SortMode, categories: Category[] = []): Note[] {
  const arr = [...notes];
  switch (mode) {
    case 'name_asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    case 'name_desc':
      return arr.sort((a, b) => b.title.localeCompare(a.title, 'ja'));
    case 'created_asc':
      return arr.sort((a, b) => (a.created_at || a.updated_at).localeCompare(b.created_at || b.updated_at));
    case 'created_desc':
      return arr.sort((a, b) => (b.created_at || b.updated_at).localeCompare(a.created_at || a.updated_at));
    case 'group_asc': {
      const catMap = new Map(categories.map(c => [c.id, c.name]));
      return arr.sort((a, b) => (catMap.get(a.category_id ?? '') ?? '').localeCompare(catMap.get(b.category_id ?? '') ?? '', 'ja'));
    }
    case 'group_desc': {
      const catMap = new Map(categories.map(c => [c.id, c.name]));
      return arr.sort((a, b) => (catMap.get(b.category_id ?? '') ?? '').localeCompare(catMap.get(a.category_id ?? '') ?? '', 'ja'));
    }
    default: // 'manual'
      return arr.sort((a, b) => a.sort_order - b.sort_order);
  }
}

async function persistOpenWindows(ids: Set<string>) {
  try {
    await invoke('set_kv_setting', {
      key: 'open_windows',
      value: JSON.stringify([...ids]),
    });
  } catch { /* ignore */ }
}

export const useAppStore = create<AppStore>((set, get) => ({
  notes: [],
  categories: [],
  statuses: [],
  assigneeGroups: [],
  assigneePersons: [],
  settings: DEFAULT_SETTINGS,
  selectedCategoryId: null,
  searchQuery: '',
  openWindowIds: new Set(),

  load: async () => {
    const [notes, categories, statuses, assigneeGroups, assigneePersons, settings] =
      await Promise.all([
        invoke<Note[]>('get_all_notes'),
        invoke<Category[]>('get_categories'),
        invoke<Status[]>('get_statuses'),
        invoke<AssigneeGroup[]>('get_assignee_groups'),
        invoke<AssigneePerson[]>('get_assignee_persons'),
        invoke<AppSettings>('get_settings').catch(() => DEFAULT_SETTINGS),
      ]);
    set({ notes, categories, statuses, assigneeGroups, assigneePersons, settings });
  },

  reopenSavedWindows: async () => {
    try {
      const json = await invoke<string | null>('get_kv_setting', { key: 'open_windows' });
      if (!json) return;
      const ids: string[] = JSON.parse(json);
      const { notes } = get();
      const opened = new Set<string>();
      for (const id of ids) {
        const note = notes.find((n) => n.id === id);
        if (note) {
          await invoke('open_note_window', {
            noteId: id,
            x: note.window_x,
            y: note.window_y,
            width: note.window_width,
            height: note.window_height,
          }).catch(() => { /* skip if fails */ });
          opened.add(id);
        }
      }
      set({ openWindowIds: opened });
    } catch { /* ignore */ }
  },

  createNote: async (title = '新しいリスト') => {
    const { selectedCategoryId } = get();
    const note = await invoke<Note>('create_note', {
      title,
      categoryId: selectedCategoryId,
    });
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  updateNote: (note: Note) => {
    const updated = { ...note, updated_at: now(), dirty: true };
    set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? updated : n)) }));
    debouncedSaveNote(updated);
    emit('note-updated', { id: updated.id, title: updated.title, color: updated.color }).catch(() => {});
  },

  deleteNote: async (id: string) => {
    await invoke('close_note_window', { noteId: id }).catch(() => {});
    await invoke('delete_note', { id });
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      openWindowIds: new Set([...s.openWindowIds].filter((wid) => wid !== id)),
    }));
  },

  duplicateNote: async (id: string) => {
    const note = await invoke<Note>('duplicate_note', { sourceId: id });
    set((s) => ({ notes: [...s.notes, note] }));
    return note;
  },

  openNote: async (note: Note) => {
    await invoke('open_note_window', {
      noteId: note.id,
      x: note.window_x,
      y: note.window_y,
      width: note.window_width,
      height: note.window_height,
    });
    set((s) => {
      const next = new Set([...s.openWindowIds, note.id]);
      persistOpenWindows(next);
      return { openWindowIds: next };
    });
  },

  trackWindowClose: async (noteId: string) => {
    set((s) => {
      const next = new Set([...s.openWindowIds].filter((id) => id !== noteId));
      persistOpenWindows(next);
      return { openWindowIds: next };
    });
  },

  reorderNotes: (ids: string[]) => {
    set((s) => {
      const map = new Map(s.notes.map((n) => [n.id, n]));
      const reordered = ids
        .map((id, i) => {
          const n = map.get(id);
          if (!n) return null;
          return { ...n, sort_order: i, dirty: true };
        })
        .filter(Boolean) as Note[];
      reordered.forEach((n) => invoke('save_note', { note: n }).catch(console.error));
      return { notes: reordered };
    });
  },

  saveCategory: async (category: Category) => {
    await invoke('save_category', { category });
    set((s) => {
      const exists = s.categories.find((c) => c.id === category.id);
      return {
        categories: exists
          ? s.categories.map((c) => (c.id === category.id ? category : c))
          : [...s.categories, category],
      };
    });
  },

  deleteCategory: async (id: string) => {
    await invoke('delete_category', { id });
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
  },

  reorderCategories: (ids: string[]) => {
    set((s) => {
      const map = new Map(s.categories.map((c) => [c.id, c]));
      const reordered = ids
        .map((id, i) => {
          const c = map.get(id);
          if (!c) return null;
          return { ...c, sort_order: i };
        })
        .filter(Boolean) as Category[];
      reordered.forEach((c) => invoke('save_category', { category: c }).catch(console.error));
      return { categories: reordered };
    });
  },

  saveStatus: async (status: Status) => {
    await invoke('save_status', { status });
    set((s) => {
      const exists = s.statuses.find((st) => st.id === status.id);
      return {
        statuses: exists
          ? s.statuses.map((st) => (st.id === status.id ? status : st))
          : [...s.statuses, status],
      };
    });
  },

  deleteStatus: async (id: string) => {
    await invoke('delete_status', { id });
    set((s) => ({ statuses: s.statuses.filter((st) => st.id !== id) }));
  },

  saveAssigneeGroup: async (group: AssigneeGroup) => {
    await invoke('save_assignee_group', { group });
    set((s) => {
      const exists = s.assigneeGroups.find((g) => g.id === group.id);
      return {
        assigneeGroups: exists
          ? s.assigneeGroups.map((g) => (g.id === group.id ? group : g))
          : [...s.assigneeGroups, group],
      };
    });
  },

  deleteAssigneeGroup: async (id: string) => {
    await invoke('delete_assignee_group', { id });
    set((s) => ({
      assigneeGroups: s.assigneeGroups.filter((g) => g.id !== id),
      assigneePersons: s.assigneePersons.filter((p) => p.group_id !== id),
    }));
  },

  saveAssigneePerson: async (person: AssigneePerson) => {
    await invoke('save_assignee_person', { person });
    set((s) => {
      const exists = s.assigneePersons.find((p) => p.id === person.id);
      return {
        assigneePersons: exists
          ? s.assigneePersons.map((p) => (p.id === person.id ? person : p))
          : [...s.assigneePersons, person],
      };
    });
  },

  deleteAssigneePerson: async (id: string) => {
    await invoke('delete_assignee_person', { id });
    set((s) => ({ assigneePersons: s.assigneePersons.filter((p) => p.id !== id) }));
  },

  saveSettings: async (settings: AppSettings) => {
    await invoke('save_settings', { settings });
    set({ settings });
  },

  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  filteredNotes: () => {
    const { notes, selectedCategoryId, searchQuery, settings, categories } = get();
    let result = notes;
    if (selectedCategoryId) {
      result = result.filter((n) => n.category_id === selectedCategoryId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(q));
    }
    // Normalize legacy 'name' sort mode to 'name_asc'
    const mode = (settings.sort_mode === 'name' ? 'name_asc' : settings.sort_mode) as SortMode;
    return sorted(result, mode, categories);
  },
}));

// ── Debounced save ────────────────────────────────────────────────────────────
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debouncedSaveNote(note: Note) {
  const prev = saveTimers.get(note.id);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    note.id,
    setTimeout(() => {
      invoke('save_note', { note }).catch(console.error);
      saveTimers.delete(note.id);
    }, 500),
  );
}
