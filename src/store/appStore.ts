import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { AppSettings, AssigneeGroup, AssigneePerson, Category, Note, SortMode, Status } from '../types';
import { log } from '../utils/log';

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

  // Global-search results: notes that have at least one matching task.
  // Updated by Launcher whenever searchQuery changes.
  itemMatchNoteIds: Set<string>;
  itemMatches: { item: any; noteTitle: string }[];

  // Cross-component drag state (NoteList drags note → CategoryList highlights).
  draggingNoteId: string | null;
  noteDropOverCatId: string | null;

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
  reopen_windows_on_start: true,
  reminder_interval_min: 30,
  backup_interval_min: 60,
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

// ── Tutorial seed ─────────────────────────────────────────────────────────────
// Runs ONCE when the app starts on a completely empty DB.
let _seedInProgress = false; // guard against double-invoke (React StrictMode etc.)
async function seedTutorial(categories: Category[], statuses: Status[]) {
  if (_seedInProgress) return;
  _seedInProgress = true;
  try {
    await _doSeedTutorial(categories, statuses);
  } finally {
    // Always reset so a failed seed can be retried on the next launch.
    _seedInProgress = false;
  }
}

async function _doSeedTutorial(categories: Category[], statuses: Status[]) {
  const personalCat = categories.find((c) => c.name === '個人');
  const workCat = categories.find((c) => c.name === '仕事');
  const statusInProgress = statuses.find((s) => s.name === '作業中');
  const statusDone = statuses.find((s) => s.name === '完了');
  const statusRetake = statuses.find((s) => s.name === 'リテイク');
  const today = new Date();
  const days = (n: number) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const isoNow = () => new Date().toISOString();

  type Seed = {
    text: string; indent?: number; checked?: boolean; bold?: boolean;
    locked?: boolean; archived?: boolean; memo?: string | null;
    item_type?: 'normal' | 'heading' | 'separator';
    status?: string | null; priority?: 'high' | 'medium' | 'low' | null;
    limit_date?: string | null;
  };
  const buildItems = (noteId: string, seeds: Seed[]) => seeds.map((s, i) => ({
    id: crypto.randomUUID(),
    note_id: noteId,
    parent_id: null,
    text: s.text,
    checked: s.checked ?? false,
    indent: s.indent ?? 0,
    collapsed: false,
    locked: s.locked ?? false,
    status: s.status ?? null,
    assignees: '[]',
    assignee_person_id: null,
    memo: s.memo ?? null,
    bold: s.bold ?? false,
    priority: s.priority ?? null,
    start_date: null,
    end_date: null,
    limit_date: s.limit_date ?? null,
    item_type: s.item_type ?? 'normal',
    sort_order: i,
    archived: s.archived ?? false,
    updated_at: isoNow(),
    dirty: true,
  }));

  // ── Note 1: tutorial guide ──────────────────────────────────────────────
  const guide = await invoke<Note>('create_note', {
    title: '📚 ようこそ — StickyTodo の使い方',
    categoryId: personalCat?.id ?? null,
  });
  const guideNote: Note = { ...guide, color: '#bfdbfe', warn_days: 3 };
  await invoke('save_note', { note: guideNote });
  const guideItems = buildItems(guide.id, [
    { text: '👋 はじめに',                                              item_type: 'heading' },
    { text: 'これは StickyTodo のチュートリアル付箋です' },
    { text: '☑ チェックボックスで完了マーク (このタスクは完了済み)',     checked: true },
    { text: '',                                                          item_type: 'separator' },

    { text: '✏️ タスクの追加',                                          item_type: 'heading' },
    { text: '上の入力欄に文字を入れて Enter キー' },
    { text: '入力欄で Tab キーを押すとインデント (深い段に)',            indent: 0 },
    { text: '↑ こんな風に階層化できます',                                indent: 1 },
    { text: 'もっと深くもいけます',                                      indent: 2 },
    { text: '右クリックメニューでも「上に追加 / 下に追加」可能' },
    { text: '',                                                          item_type: 'separator' },

    { text: '🔍 検索',                                                  item_type: 'heading' },
    { text: 'Ctrl+F でこのリスト内検索 (黄色マーカーでハイライト)' },
    { text: 'ランチャーの検索欄で「すべてのリスト」を横断検索可能' },
    { text: '',                                                          item_type: 'separator' },

    { text: '🎨 装飾と整理',                                            item_type: 'heading' },
    { text: 'これは太字 (Ctrl+B)',                                      bold: true },
    { text: 'これはロック中 — 編集不可 (Ctrl+L)',                        locked: true },
    { text: '右クリック → アーカイブで隠せる (Ctrl+E)' },
    { text: 'コメントは💬マークが付きます (Ctrl+M)',                     memo: 'マウスホバーでこのコメントが見えます！' },
    { text: '',                                                          item_type: 'separator' },

    { text: '🌐 URL もそのまま使える',                                  item_type: 'heading' },
    { text: 'https://github.com/KarakuriKissa/sticky-todo を貼ってクリック' },
    { text: '',                                                          item_type: 'separator' },

    { text: '⌨ ショートカット (? キーで一覧表示)',                       item_type: 'heading' },
    { text: 'Ctrl+Z / Ctrl+Y — 元に戻す / やり直し' },
    { text: 'Ctrl+A — 全選択, Ctrl+D — 複製, Delete — 削除' },
    { text: 'Shift+Enter — 下に新規, Ctrl+Shift+Enter — 上に新規' },
    { text: 'Tab / Shift+Tab — インデント / アウトデント' },
    { text: '',                                                          item_type: 'separator' },

    { text: '🗂 リストとカテゴリ',                                      item_type: 'heading' },
    { text: 'ランチャー左のカテゴリでリストを分類' },
    { text: 'リストを左カテゴリにドラッグ&ドロップでカテゴリ変更' },
    { text: 'リスト右クリックで「カテゴリを変更」も可能' },

    { text: '✅ アーカイブ済みタスクの例',                               item_type: 'heading' },
    { text: 'これはアーカイブ済み — ツールバーの🗄️ボタンで表示切替',     archived: true, checked: true },
  ]);
  await invoke('save_items', { items: guideItems });

  // ── Note 2: realistic example list ──────────────────────────────────────
  const work = await invoke<Note>('create_note', {
    title: '🎯 サンプル: 今週のタスク',
    categoryId: workCat?.id ?? null,
  });
  const workNote: Note = { ...work, color: '#fed7aa', warn_days: 5 };
  await invoke('save_note', { note: workNote });
  const workItems = buildItems(work.id, [
    { text: '🔥 緊急',                                                  item_type: 'heading' },
    { text: 'クライアント連絡',  priority: 'high',  status: statusInProgress?.id ?? null, limit_date: days(0) },
    { text: '今日中の納品',       priority: 'high',  status: statusInProgress?.id ?? null, limit_date: days(0) },
    { text: '',                                                          item_type: 'separator' },

    { text: '📦 通常',                                                  item_type: 'heading' },
    { text: 'コードレビュー対応', priority: 'medium', status: null,                  limit_date: days(2) },
    { text: 'ドキュメント整備',    priority: 'medium', status: statusRetake?.id ?? null, limit_date: days(3) },
    { text: '会議準備',           priority: 'low',    status: null,                  limit_date: days(5) },
    { text: '',                                                          item_type: 'separator' },

    { text: '🎉 完了済み',                                              item_type: 'heading' },
    { text: '提案書レビュー',    checked: true, status: statusDone?.id ?? null, limit_date: days(-2) },
    { text: 'スプリント計画',    checked: true, status: statusDone?.id ?? null, limit_date: days(-5) },
  ]);
  await invoke('save_items', { items: workItems });

  // ── Note 3: shopping list (light example) ───────────────────────────────
  const shop = await invoke<Note>('create_note', {
    title: '🛒 買い物リスト',
    categoryId: personalCat?.id ?? null,
  });
  const shopNote: Note = { ...shop, color: '#bbf7d0' };
  await invoke('save_note', { note: shopNote });
  const shopItems = buildItems(shop.id, [
    { text: '🥬 食料品',  item_type: 'heading' },
    { text: '牛乳' },
    { text: 'パン' },
    { text: 'コーヒー豆',          checked: true },
    { text: '🧴 日用品',  item_type: 'heading' },
    { text: 'ティッシュ' },
    { text: '洗剤' },
  ]);
  await invoke('save_items', { items: shopItems });

  // ── Assignee groups + persons ───────────────────────────────────────────
  const grp1Id = crypto.randomUUID();
  const grp2Id = crypto.randomUUID();
  await invoke('save_assignee_group', { group: { id: grp1Id, name: '開発チーム', sort_order: 0 } });
  await invoke('save_assignee_group', { group: { id: grp2Id, name: '営業チーム', sort_order: 1 } });
  const devMembers = [
    { id: crypto.randomUUID(), group_id: grp1Id, name: '田中', color: '#6366f1', sort_order: 0 },
    { id: crypto.randomUUID(), group_id: grp1Id, name: '佐藤', color: '#22c55e', sort_order: 1 },
    { id: crypto.randomUUID(), group_id: grp1Id, name: '鈴木', color: '#f59e0b', sort_order: 2 },
  ];
  const salesMembers = [
    { id: crypto.randomUUID(), group_id: grp2Id, name: '山田', color: '#ec4899', sort_order: 0 },
    { id: crypto.randomUUID(), group_id: grp2Id, name: '高橋', color: '#14b8a6', sort_order: 1 },
  ];
  for (const p of [...devMembers, ...salesMembers]) {
    await invoke('save_assignee_person', { person: p });
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
  itemMatchNoteIds: new Set(),
  draggingNoteId: null,
  noteDropOverCatId: null,
  itemMatches: [],

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

    // First-run / fresh-DB tutorial: if there are no notes yet AND we have not
    // already seeded, drop in a couple of demo lists so the user has something
    // to look at and learn from. Subsequent launches skip this entirely.
    if (notes.length === 0 && localStorage.getItem('sticky-todo:tutorial-seeded') !== 'done') {
      try {
        await seedTutorial(categories, statuses);
        localStorage.setItem('sticky-todo:tutorial-seeded', 'done');
        const [reloadedNotes, reloadedGroups, reloadedPersons] = await Promise.all([
          invoke<Note[]>('get_all_notes'),
          invoke<AssigneeGroup[]>('get_assignee_groups'),
          invoke<AssigneePerson[]>('get_assignee_persons'),
        ]);
        set({ notes: reloadedNotes, assigneeGroups: reloadedGroups, assigneePersons: reloadedPersons });
      } catch (e) {
        log.error('[appStore] tutorial seed failed:', e);
      }
    }
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
    const next = new Set([...get().openWindowIds, note.id]);
    set({ openWindowIds: next });
    await persistOpenWindows(next);
  },

  trackWindowClose: async (noteId: string) => {
    // Each window has its own appStore instance, so a note window's
    // openWindowIds doesn't reflect other open windows.
    // Read the authoritative KV state, remove just this note, write back.
    // Must await before the window is destroyed (race vs appWin.destroy()).
    let current: string[] = [];
    try {
      const json = await invoke<string | null>('get_kv_setting', { key: 'open_windows' });
      if (json) current = JSON.parse(json);
    } catch { /* ignore */ }
    const next = new Set(current.filter((id) => id !== noteId));
    set({ openWindowIds: next });
    await persistOpenWindows(next);
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
      reordered.forEach((n) => invoke('save_note', { note: n }).catch((e) => log.error(e)));
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
      reordered.forEach((c) => invoke('save_category', { category: c }).catch((e) => log.error(e)));
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
    emit('statuses-updated', {}).catch(() => {});
  },

  deleteStatus: async (id: string) => {
    await invoke('delete_status', { id });
    set((s) => ({ statuses: s.statuses.filter((st) => st.id !== id) }));
    emit('statuses-updated', {}).catch(() => {});
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
    emit('assignees-updated', {}).catch(() => {});
  },

  deleteAssigneeGroup: async (id: string) => {
    await invoke('delete_assignee_group', { id });
    set((s) => ({
      assigneeGroups: s.assigneeGroups.filter((g) => g.id !== id),
      assigneePersons: s.assigneePersons.filter((p) => p.group_id !== id),
    }));
    emit('assignees-updated', {}).catch(() => {});
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
    emit('assignees-updated', {}).catch(() => {});
  },

  deleteAssigneePerson: async (id: string) => {
    await invoke('delete_assignee_person', { id });
    set((s) => ({ assigneePersons: s.assigneePersons.filter((p) => p.id !== id) }));
    emit('assignees-updated', {}).catch(() => {});
  },

  saveSettings: async (settings: AppSettings) => {
    await invoke('save_settings', { settings });
    set({ settings });
  },

  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  filteredNotes: () => {
    const { notes, selectedCategoryId, searchQuery, settings, categories, itemMatchNoteIds } = get();
    const q = searchQuery.trim().toLowerCase();
    let result = notes;
    // When global-searching, ignore the category filter so cross-category matches are visible.
    if (selectedCategoryId && !q) {
      result = result.filter((n) => n.category_id === selectedCategoryId);
    }
    if (q) {
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || itemMatchNoteIds.has(n.id),
      );
    }
    const mode = ((settings.sort_mode as string) === 'name' ? 'name_asc' : settings.sort_mode) as SortMode;
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
      invoke('save_note', { note }).catch((e) => log.error(e));
      saveTimers.delete(note.id);
    }, 500),
  );
}
