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
  locked: boolean;
  updated_at: string;
  dirty: boolean;
}

export type ItemType = 'normal' | 'heading' | 'separator';

export interface TodoItem {
  id: string;
  note_id: string;
  parent_id: string | null;
  text: string;
  checked: boolean;
  indent: number;
  collapsed: boolean;
  status: string | null;
  assignees: string; // legacy JSON array string
  assignee_person_id: string | null;
  memo: string | null;
  bold: boolean;
  priority: string | null; // 'high' | 'medium' | 'low' | null
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

export interface AssigneeGroup {
  id: string;
  name: string;
  sort_order: number;
}

export interface AssigneePerson {
  id: string;
  group_id: string;
  name: string;
  color: string;
  sort_order: number;
}

export type SortMode = 'manual' | 'deadline' | 'start_date' | 'status' | 'name' | 'priority';

export interface AppSettings {
  sort_mode: SortMode;
  feature_status: boolean;
  feature_assignee: boolean;
  feature_date: boolean;
  feature_memo: boolean;
  feature_priority: boolean;
  active_group_id: string | null;
}
