import { invoke } from '@tauri-apps/api/core';
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

  load: () => Promise<void>;

  // Notes
  createNote: (title?: string) => Promise<Note>;
  updateNote: (note: Note) => void;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<Note>;
  openNote: (note: Note) => Promise<void>;
  reorderNotes: (ids: string[]) => void;

  // Categories
  saveCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

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
  feature_assignee: false,
  feature_date: true,
  feature_memo: false,
  feature_priority: false,
  active_group_id: null,
};

function now() {
  return new Date().toISOString();
}

function sorted(notes: Note[], mode: SortMode): Note[] {
  const arr = [...notes];
  switch (mode) {
    case 'name':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    case 'manual':
    default:
      return arr.sort((a, b) => a.sort_order - b.sort_order);
  }
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

  createNote: async (title = '新しいリスト') => {
    const note = await invoke<Note>('create_note', {
      title,
      categoryId: get().selectedCategoryId,
    });
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  updateNote: (note: Note) => {
    const updated = { ...note, updated_at: now(), dirty: true };
    set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? updated : n)) }));
    debouncedSaveNote(updated);
  },

  deleteNote: async (id: string) => {
    await invoke('delete_note', { id });
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
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
    const { notes, selectedCategoryId, searchQuery, settings } = get();
    let result = notes;
    if (selectedCategoryId) {
      result = result.filter((n) => n.category_id === selectedCategoryId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(q));
    }
    return sorted(result, settings.sort_mode);
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
