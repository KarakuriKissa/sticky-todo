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
  warn_days: number | null; // per-note deadline warning days (null = use global)
  created_at: string | null;
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
  locked: boolean;
  status: string | null;
  assignees: string;
  assignee_person_id: string | null;
  memo: string | null;
  bold: boolean;
  priority: string | null;
  start_date: string | null;
  end_date: string | null;
  limit_date: string | null;
  item_type: ItemType;
  sort_order: number;
  archived: boolean;
  strikethrough: boolean;
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

export type SortMode = 'manual' | 'name_asc' | 'name_desc' | 'created_asc' | 'created_desc' | 'group_asc' | 'group_desc';

export interface AppSettings {
  sort_mode: SortMode;
  feature_status: boolean;
  feature_assignee: boolean;
  feature_date: boolean;
  feature_memo: boolean;
  feature_priority: boolean;
  active_group_id: string | null;
  deadline_warn_days: number;
  priority_mode: 'hml' | 'abc'; // 'hml' = 高中低, 'abc' = ABC
  reminder_interval_min?: number; // minutes between desktop reminder checks (0 = disabled)
  reopen_windows_on_start?: boolean; // restore open note windows on app launch
  backup_interval_min?: number; // minutes between automatic DB backups (0 = disabled)
}
