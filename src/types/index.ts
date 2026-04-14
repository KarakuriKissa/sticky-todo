export interface Note {
  id: string;
  title: string;
  category_id: string | null;
  window_x: number;
  window_y: number;
  window_width: number;
  window_height: number;
  always_on_top: boolean;
  color: string;
  sort_order: number;
  updated_at: string;
  dirty: boolean;
}

export type ItemType = 'normal' | 'heading' | 'separator' | 'group';

export interface TodoItem {
  id: string;
  note_id: string;
  parent_id: string | null;
  text: string;
  checked: boolean;
  indent: number;
  collapsed: boolean;
  status: string | null;
  assignees: string; // JSON string: '["Alice"]'
  start_date: string | null;
  end_date: string | null;
  limit_date: string | null;
  item_type: ItemType;
  sort_order: number;
  archived: boolean;
  updated_at: string;
  dirty: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface Status {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export type SortMode = 'manual' | 'deadline' | 'start_date' | 'status' | 'name';

export interface AppSettings {
  sync_enabled: boolean;
  sync_token: string | null;
  sort_mode: SortMode;
  feature_sync: boolean;
  feature_status: boolean;
  feature_assignee: boolean;
  feature_date: boolean;
}
