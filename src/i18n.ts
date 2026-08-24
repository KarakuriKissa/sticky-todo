import { create } from 'zustand';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Lightweight i18n — no third-party i18n library, just a zustand store holding
// a flat key → string dictionary per language. Components call `const t =
// useT()` then `t('key')` (or `t('key', { name: 'foo' })` for `{name}`
// placeholders). Language is persisted to localStorage (shared across all
// windows, same origin) and broadcast to already-open windows via a Tauri
// event — mirrors the existing statuses-updated / assignees-updated pattern
// in appStore.ts so a language switch is reflected everywhere immediately.
export type Lang = 'ja' | 'en';

type Dict = Record<string, string>;

const LANG_KEY = 'sticky-todo:lang';

const ja: Dict = {
  // ── Launcher ──────────────────────────────────────────────────────────────
  'launcher.search': '🌐 リスト名・タスクを横断検索… (Ctrl+F)',
  'launcher.new': '新規リスト作成',
  'launcher.sort': '並び替え',
  'launcher.center': '画面中央に移動 (Ctrl+Shift+G)',
  'sort.manual': '保存された順',
  'sort.name_asc': '名前 昇順',
  'sort.name_desc': '名前 降順',
  'sort.created_asc': '作成日 古い順',
  'sort.created_desc': '作成日 新しい順',
  'sort.group_asc': 'グループ 昇順',
  'sort.group_desc': 'グループ 降順',

  // Update banner (launcher) + Help tab update checker
  'upd.bannerPrefix': '🆙 新しいバージョン',
  'upd.bannerSuffix': 'が利用可能です',
  'upd.updating': '更新中…',
  'upd.updateNow': '今すぐ更新',
  'upd.dismiss': '閉じる',
  'upd.heading': '🔄 アップデート確認',
  'upd.currentVersionLabel': '現在のバージョン',
  'upd.checkButton': '🔄 最新バージョンを確認',
  'upd.checking': '確認中…',
  'upd.devNotice': '開発版なので更新確認は行いません',
  'upd.latest': '✓ 最新バージョンです',
  'upd.found': '⬆ 新しいバージョンがあります（v{version}）',
  'upd.installRestart': '今すぐ更新して再起動 →',
  'upd.downloading': 'ダウンロード中…',
  'upd.manualDownload': '手動でダウンロードページを開く →',

  // Search popup (launcher global search)
  'search.queryOpen': '「',
  'search.queryClose': '」',
  'search.resultsSuffix': 'の検索結果：',
  'search.listsLabel': 'リスト',
  'search.tasksLabel': 'タスク',
  'search.close': '閉じる (Esc)',
  'search.listsSection': '📋 リスト',
  'search.tasksSection': '✅ タスク',
  'search.noResults': '該当するリスト・タスクがありません',
  'search.untitled': '(無題)',

  // ── Note window toolbar ──────────────────────────────────────────────────
  'tb.add': '項目追加',
  'tb.heading': '見出し',
  'tb.separator': '区切り線',
  'tb.link': 'リンクを設定／編集（文字を選択 か リンク内にカーソルを置いて押す）',
  'tb.indent': 'インデント (Tab)',
  'tb.outdent': 'アウトデント (Shift+Tab)',
  'tb.group': '担当者グループ',
  'tb.priorityOn': '選択タスクの優先度を設定',
  'tb.priorityOff': 'タスクを選択すると優先度を設定できます',
  'tb.priorityNone': '（なし）',
  'tb.priorityHigh': '高',
  'tb.priorityMedium': '中',
  'tb.priorityLow': '低',
  'tb.priorityModeToAbc': 'ABC表記に切替',
  'tb.priorityModeToHml': '高中低表記に切替',
  'tb.priorityHml': '高中低',
  'tb.selCount': '{n}件',
  'tb.archiveSelected': 'チェック済を一括アーカイブ ({n}件)',
  'tb.showNormal': '通常表示に戻る',
  'tb.showArchived': 'アーカイブを表示 ({n}件)',
  'tb.checkSelected': '選択をチェック',
  'tb.uncheckSelected': '選択のチェックを外す',

  // ── Note window (titlebar / quick-add) ───────────────────────────────────
  'note.editTitle': '右クリックで編集',
  'note.titlebarUntitled': 'タイトルなし',
  'note.lastSaved': '最終保存: {time}',
  'note.unsaved': '未保存',
  'note.openLauncher': 'ランチャーを開く',
  'note.pinOn': '最前面固定: ON（クリックで解除）',
  'note.pinOff': '最前面固定: OFF',
  'note.changeColor': '色を変更',
  'note.close': '閉じる',
  'note.quickAddPlaceholder': '✏️ 新しいタスクを入力して Enter で追加…',
  'note.quickAddIndentSuffix': '(インデント+{n})',
  'note.warnDaysTitle': '期日警告の日数（このリストの設定）',
  'note.warnDaysInputTitle': '期日の何日前から警告するか',
  'note.warnDaysSuffix': '日前',
  'note.emptySearch': '該当するタスクがありません',
  'note.emptyClickToAdd': 'クリックして追加…',

  // ── Todo item row ─────────────────────────────────────────────────────────
  'item.dragHandle': 'ドラッグで並び替え',
  'item.taskPlaceholder': 'タスクを入力…',
  'item.memoTitle': 'クリックで固定表示 / 右クリックで編集',

  // Comment editor (task memo)
  'comment.title': 'コメント',
  'comment.linkTitle': '選択した文字にリンクを設定（先に文字を選択）',
  'comment.linkBtn': '🔗 リンク',
  'comment.placeholder': 'コメントを入力…（Ctrl+Enterで保存／Enterで改行／文字を選んで🔗）',
  'comment.save': '保存 (Ctrl+Enter)',

  // Hyperlink popup (RichTextEdit — shared by task text + comments)
  'link.labelPlaceholder': '表示する文字',
  'link.urlPlaceholder': 'https://… / C:\\パス / scheme://…',
  'link.close': '閉じる',
  'link.unlinkHint': '※ URL を空にして OK でリンク解除',

  // ── Settings modal chrome ────────────────────────────────────────────────
  'settings.title': '設定',
  'tab.statuses': 'ステータス',
  'tab.assignees': '担当者',
  'tab.advanced': '詳細設定',
  'tab.sync': '同期',
  'tab.help': 'ヘルプ',
  'btn.save': '保存',
  'btn.cancel': 'キャンセル',
  'btn.add': '追加',

  // Statuses tab
  'status.manageTitle': 'ステータス管理',
  'status.editHint': '名前はダブルクリックで編集／左の丸をクリックで色を変更',
  'status.namePlaceholder': 'ステータス名',
  'status.export': '📤 エクスポート',
  'status.import': '📥 インポート',
  'status.exportDialogTitle': 'ステータスをエクスポート',
  'status.importDialogTitle': 'ステータスをインポート',
  'status.exportedAlert': 'ステータスをエクスポートしました',
  'status.jsonParseError': 'JSONとして読み込めませんでした',
  'status.invalidFormat': '形式が正しくありません',
  'status.importResult': 'インポート完了: {added}件追加, {skipped}件スキップ（重複・不正データ）',

  // Assignees tab
  'assignee.manageTitle': '担当者グループとメンバー',
  'assignee.bulkPasteBtn': '📋 スプレッドシートから一括入力',
  'assignee.groupHeader': 'グループ',
  'assignee.groupNamePlaceholder': 'グループ名',
  'assignee.membersOf': '{group} のメンバー',
  'assignee.selectGroupHeader': 'グループを選択',
  'assignee.selectGroupBody': 'グループを選択してください',
  'assignee.noMembers': 'メンバーなし',
  'assignee.memberNamePlaceholder': 'メンバー名',
  'assignee.exportDialogTitle': '担当者をエクスポート',
  'assignee.importDialogTitle': '担当者をインポート',
  'assignee.exportedAlert': '担当者をエクスポートしました',
  'assignee.importResult': 'インポート完了: グループ{groupAdded}件追加, メンバー{personAdded}件追加, {personSkipped}件スキップ',
  'assignee.deleteGroupConfirm': 'グループ「{name}」を削除しますか？',

  // Bulk paste (assignees)
  'bulk.previewLabel': 'プレビュー: {n}件 —',
  'bulk.previewMore': '…他{n}件',
  'bulk.importBtn': '{n}件をインポート',
  'bulk.processing': '処理中…',
  'bulk.importResult': 'インポート完了: {added}件追加, {skipped}件スキップ（重複）',

  // ── Advanced tab ──────────────────────────────────────────────────────────
  'adv.deadlineTitle': '期日警告',
  'adv.deadlineDesc': '期日が近いタスクに警告色を表示します。各リストで個別に上書き可能です。',
  'adv.deadlinePrefix': '期限の',
  'adv.deadlineSuffix': '日前から警告色を表示',
  'adv.notifTitle': 'デスクトップ通知',
  'adv.notifDescLine1': 'リストを開いている間、期限切れ・期日が近いタスクを Windows 通知で知らせます。',
  'adv.notifDescLine2Bold': '0 にすると通知を無効化',
  'adv.notifDescLine2Suffix': 'します。',
  'adv.checkInterval': 'チェック間隔',
  'adv.minutesSuffix': '分ごと（0 で無効）',
  'adv.startupTitle': '起動時の動作',
  'adv.startupDesc': 'アプリを起動したとき、前回開いていたリストウィンドウを自動で再表示します。',
  'adv.reopenLabel': '前回開いていたリストを起動時に復元する',
  'adv.autostartLabel': 'Windows 起動時に自動でアプリを立ち上げる',
  'adv.dbTitle': 'データベース',
  'adv.dbDescLine1': 'すべてのデータはローカルの SQLite データベースに保存されています。',
  'adv.dbDescLine2': 'エクスポートでバックアップを作成、インポートで別のデータベースに置き換えできます。',
  'adv.export': '📤 エクスポート',
  'adv.import': '📥 インポート',
  'adv.deleteDb': '🗑️ データベースを削除',
  'adv.sampleTitle': 'サンプルリスト',
  'adv.sampleDesc': '初回起動時のチュートリアル用サンプルリスト（ようこそ／今週のタスク／買い物リスト）を 既存のデータを残したまま追加します。',
  'adv.addSample': '📝 サンプルリストを追加',
  'adv.browserTitle': 'リンクを開くブラウザ',
  'adv.browserDescLine1': 'タスクやコメント内の URL をクリックしたとき、ここで指定したブラウザで開きます。',
  'adv.browserDescLine2Bold': '空欄なら OS の既定ブラウザ',
  'adv.browserDescLine2Suffix': 'で開きます。',
  'adv.browserExampleWin': '例（Windows）:',
  'adv.browserExampleMac': '例（Mac）:',
  'adv.browserExampleMacSuffix': '（アプリ名）',
  'adv.browserPlaceholder': '（空欄 = 既定のブラウザ）',
  'adv.browse': '参照…',
  'adv.browserDialogTitle': 'ブラウザの実行ファイルを選択',
  'adv.backupTitle': '自動バックアップ',
  'adv.backupDescLine1': '一定間隔でデータベースのバックアップを自動作成します（最新3つを保持）。',
  'adv.backupDescLine2Bold': '0 にすると自動バックアップを無効化',
  'adv.backupInterval': 'バックアップ間隔',
  'adv.backupNow': '💾 今すぐバックアップ',
  'adv.savedBackups': '保存済みバックアップ（クリックで復元）:',
  'adv.restore': '復元',
  'adv.dangerTitle': '⚠️ アプリの初期化',
  'adv.dangerBold': '作成したリスト・タスクがすべて消えます。',
  'adv.dangerLine2': '初期化すると今まで入力したメモやタスクは復元できません。',
  'adv.dangerLine3': '初期化後はサンプルデータが表示されます（アプリを初めて起動したときと同じ状態）。',
  'adv.resetApp': '🗑️ アプリを初期化する',
  'adv.langTitle': '言語',
  'adv.langDesc': 'アプリの表示言語を切り替えます。切り替えるとすべてのウィンドウに即座に反映されます。',

  // Advanced-tab alerts / confirm dialogs
  'adv.autostartFailedAlert': '自動起動の設定が反映されませんでした。OS の権限やセキュリティ設定をご確認ください。',
  'adv.autostartErrorAlert': '自動起動の設定に失敗しました: {error}',
  'adv.exportDialogTitle': 'データベースをエクスポート',
  'adv.exportedAlert': 'エクスポートが完了しました',
  'adv.exportFailedAlert': 'エクスポート失敗: {error}',
  'adv.importDialogTitle': 'データベースをインポート',
  'adv.importConfirmBody': '現在のデータをインポートしたデータで完全に置き換えます。\nこの操作は取り消せません。続行しますか？',
  'adv.importConfirmTitle': 'インポートの確認',
  'adv.importFailedAlert': 'インポート失敗: {error}',
  'adv.backupCreatedAlert': 'バックアップを作成しました',
  'adv.backupFailedAlert': 'バックアップ失敗: {error}',
  'adv.restoreConfirmBody': '現在のデータを「{name}」で完全に置き換えます。\nこの操作は取り消せません。続行しますか？',
  'adv.restoreConfirmTitle': 'バックアップから復元',
  'adv.restoreFailedAlert': '復元失敗: {error}',
  'adv.deleteConfirmBody': 'すべてのリスト・タスク・設定が完全に削除されます。\nこの操作は取り消せません。本当に削除しますか？',
  'adv.deleteConfirmTitle': 'データベース削除の確認',
  'adv.deleteFailedAlert': '削除失敗: {error}',
  'adv.sampleAddedAlert': 'サンプルリストを追加しました',
  'adv.sampleFailedAlert': '追加に失敗: {error}',
  'adv.resetFailedAlert': '初期化失敗: {error}',
  'adv.resetConfirmBody': '作成したリスト・タスクがすべて削除されます。\nこの操作は取り消せません。本当に初期化しますか？',
  'adv.resetConfirmTitle': 'アプリの初期化',

  'lang.ja': '日本語',
  'lang.en': 'English',
};

const en: Dict = {
  'launcher.search': '🌐 Search lists & tasks… (Ctrl+F)',
  'launcher.new': 'Create a new list',
  'launcher.sort': 'Sort',
  'launcher.center': 'Center window (Ctrl+Shift+G)',
  'sort.manual': 'Saved order',
  'sort.name_asc': 'Name (A→Z)',
  'sort.name_desc': 'Name (Z→A)',
  'sort.created_asc': 'Created (oldest first)',
  'sort.created_desc': 'Created (newest first)',
  'sort.group_asc': 'Group (A→Z)',
  'sort.group_desc': 'Group (Z→A)',

  'upd.bannerPrefix': '🆙 New version',
  'upd.bannerSuffix': 'is available',
  'upd.updating': 'Updating…',
  'upd.updateNow': 'Update now',
  'upd.dismiss': 'Dismiss',
  'upd.heading': '🔄 Check for updates',
  'upd.currentVersionLabel': 'Current version',
  'upd.checkButton': '🔄 Check for the latest version',
  'upd.checking': 'Checking…',
  'upd.devNotice': 'Update checks are skipped in dev builds',
  'upd.latest': '✓ You’re up to date',
  'upd.found': '⬆ A new version is available (v{version})',
  'upd.installRestart': 'Update and restart →',
  'upd.downloading': 'Downloading…',
  'upd.manualDownload': 'Open the download page manually →',

  'search.queryOpen': '“',
  'search.queryClose': '”',
  'search.resultsSuffix': '— search results:',
  'search.listsLabel': 'Lists',
  'search.tasksLabel': 'Tasks',
  'search.close': 'Close (Esc)',
  'search.listsSection': '📋 Lists',
  'search.tasksSection': '✅ Tasks',
  'search.noResults': 'No matching lists or tasks',
  'search.untitled': '(untitled)',

  'tb.add': 'Add item',
  'tb.heading': 'Heading',
  'tb.separator': 'Separator',
  'tb.link': 'Add/edit a link (select text, or place the cursor in a link, then click)',
  'tb.indent': 'Indent (Tab)',
  'tb.outdent': 'Outdent (Shift+Tab)',
  'tb.group': 'Assignee group',
  'tb.priorityOn': 'Set priority for the selected tasks',
  'tb.priorityOff': 'Select a task to set its priority',
  'tb.priorityNone': '(none)',
  'tb.priorityHigh': 'High',
  'tb.priorityMedium': 'Medium',
  'tb.priorityLow': 'Low',
  'tb.priorityModeToAbc': 'Switch to A/B/C labels',
  'tb.priorityModeToHml': 'Switch to High/Med/Low labels',
  'tb.priorityHml': 'H/M/L',
  'tb.selCount': '{n}',
  'tb.archiveSelected': 'Archive all checked ({n})',
  'tb.showNormal': 'Back to normal view',
  'tb.showArchived': 'Show archived ({n})',
  'tb.checkSelected': 'Check selected',
  'tb.uncheckSelected': 'Uncheck selected',

  'note.editTitle': 'Right-click to edit',
  'note.titlebarUntitled': '(untitled)',
  'note.lastSaved': 'Last saved: {time}',
  'note.unsaved': 'Unsaved',
  'note.openLauncher': 'Open launcher',
  'note.pinOn': 'Always on top: ON (click to turn off)',
  'note.pinOff': 'Always on top: OFF',
  'note.changeColor': 'Change color',
  'note.close': 'Close',
  'note.quickAddPlaceholder': '✏️ Type a new task and press Enter…',
  'note.quickAddIndentSuffix': '(indent +{n})',
  'note.warnDaysTitle': 'Days before deadline to warn (this list only)',
  'note.warnDaysInputTitle': 'How many days before the deadline to start warning',
  'note.warnDaysSuffix': 'days before',
  'note.emptySearch': 'No matching tasks',
  'note.emptyClickToAdd': 'Click to add…',

  'item.dragHandle': 'Drag to reorder',
  'item.taskPlaceholder': 'Type a task…',
  'item.memoTitle': 'Click to pin / right-click to edit',

  'comment.title': 'Comment',
  'comment.linkTitle': 'Add a link to the selected text (select text first)',
  'comment.linkBtn': '🔗 Link',
  'comment.placeholder': 'Type a comment… (Ctrl+Enter to save / Enter for a new line / select text then 🔗)',
  'comment.save': 'Save (Ctrl+Enter)',

  'link.labelPlaceholder': 'Display text',
  'link.urlPlaceholder': 'https://… / C:\\path / scheme://…',
  'link.close': 'Close',
  'link.unlinkHint': '※ Leave the URL empty and press OK to remove the link',

  'settings.title': 'Settings',
  'tab.statuses': 'Statuses',
  'tab.assignees': 'Assignees',
  'tab.advanced': 'Advanced',
  'tab.sync': 'Sync',
  'tab.help': 'Help',
  'btn.save': 'Save',
  'btn.cancel': 'Cancel',
  'btn.add': 'Add',

  'status.manageTitle': 'Manage statuses',
  'status.editHint': 'Double-click the name to edit it, click the dot on the left to change its color',
  'status.namePlaceholder': 'Status name',
  'status.export': '📤 Export',
  'status.import': '📥 Import',
  'status.exportDialogTitle': 'Export statuses',
  'status.importDialogTitle': 'Import statuses',
  'status.exportedAlert': 'Statuses exported',
  'status.jsonParseError': 'Could not read this as JSON',
  'status.invalidFormat': 'Invalid format',
  'status.importResult': 'Import complete: {added} added, {skipped} skipped (duplicate or invalid data)',

  'assignee.manageTitle': 'Assignee groups and members',
  'assignee.bulkPasteBtn': '📋 Paste from spreadsheet',
  'assignee.groupHeader': 'Group',
  'assignee.groupNamePlaceholder': 'Group name',
  'assignee.membersOf': '{group} members',
  'assignee.selectGroupHeader': 'Select a group',
  'assignee.selectGroupBody': 'Please select a group',
  'assignee.noMembers': 'No members',
  'assignee.memberNamePlaceholder': 'Member name',
  'assignee.exportDialogTitle': 'Export assignees',
  'assignee.importDialogTitle': 'Import assignees',
  'assignee.exportedAlert': 'Assignees exported',
  'assignee.importResult': 'Import complete: {groupAdded} group(s) added, {personAdded} member(s) added, {personSkipped} skipped',
  'assignee.deleteGroupConfirm': 'Delete the group “{name}”?',

  'bulk.previewLabel': 'Preview: {n} —',
  'bulk.previewMore': '…and {n} more',
  'bulk.importBtn': 'Import {n}',
  'bulk.processing': 'Processing…',
  'bulk.importResult': 'Import complete: {added} added, {skipped} skipped (duplicates)',

  'adv.deadlineTitle': 'Deadline warnings',
  'adv.deadlineDesc': 'Highlights tasks with an upcoming deadline. Each list can override this individually.',
  'adv.deadlinePrefix': 'Warn',
  'adv.deadlineSuffix': 'day(s) before the deadline',
  'adv.notifTitle': 'Desktop notifications',
  'adv.notifDescLine1': 'While a list is open, Windows notifications alert you about overdue or soon-due tasks.',
  'adv.notifDescLine2Bold': 'Set to 0 to disable notifications',
  'adv.notifDescLine2Suffix': '.',
  'adv.checkInterval': 'Check interval',
  'adv.minutesSuffix': 'min (0 to disable)',
  'adv.startupTitle': 'Startup behavior',
  'adv.startupDesc': 'When the app starts, automatically reopen the list windows that were open last time.',
  'adv.reopenLabel': 'Restore previously open lists on startup',
  'adv.autostartLabel': 'Launch the app automatically when Windows starts',
  'adv.dbTitle': 'Database',
  'adv.dbDescLine1': 'All your data is stored in a local SQLite database.',
  'adv.dbDescLine2': 'Export creates a backup; import replaces it with another database.',
  'adv.export': '📤 Export',
  'adv.import': '📥 Import',
  'adv.deleteDb': '🗑️ Delete database',
  'adv.sampleTitle': 'Sample lists',
  'adv.sampleDesc': 'Adds the first-run tutorial sample lists (Welcome / This week’s tasks / Shopping list) without touching your existing data.',
  'adv.addSample': '📝 Add sample lists',
  'adv.browserTitle': 'Browser for opening links',
  'adv.browserDescLine1': 'URLs in tasks and comments open in the browser you specify here.',
  'adv.browserDescLine2Bold': 'Leave blank to use the OS default browser',
  'adv.browserDescLine2Suffix': '.',
  'adv.browserExampleWin': 'Example (Windows):',
  'adv.browserExampleMac': 'Example (Mac):',
  'adv.browserExampleMacSuffix': '(app name)',
  'adv.browserPlaceholder': '(blank = default browser)',
  'adv.browse': 'Browse…',
  'adv.browserDialogTitle': 'Select the browser executable',
  'adv.backupTitle': 'Automatic backups',
  'adv.backupDescLine1': 'Automatically backs up the database at a set interval (keeps the 3 most recent).',
  'adv.backupDescLine2Bold': 'Set to 0 to disable automatic backups',
  'adv.backupInterval': 'Backup interval',
  'adv.backupNow': '💾 Back up now',
  'adv.savedBackups': 'Saved backups (click to restore):',
  'adv.restore': 'Restore',
  'adv.dangerTitle': '⚠️ Reset app',
  'adv.dangerBold': 'All your lists and tasks will be deleted.',
  'adv.dangerLine2': 'Once reset, your notes and tasks cannot be recovered.',
  'adv.dangerLine3': 'After resetting, sample data will be shown (same as the first launch).',
  'adv.resetApp': '🗑️ Reset the app',
  'adv.langTitle': 'Language',
  'adv.langDesc': 'Switches the app’s display language. Applies to every window immediately.',

  'adv.autostartFailedAlert': 'The autostart setting could not be applied. Please check your OS permissions/security settings.',
  'adv.autostartErrorAlert': 'Failed to change the autostart setting: {error}',
  'adv.exportDialogTitle': 'Export database',
  'adv.exportedAlert': 'Export complete',
  'adv.exportFailedAlert': 'Export failed: {error}',
  'adv.importDialogTitle': 'Import database',
  'adv.importConfirmBody': 'This will completely replace your current data with the imported data.\nThis cannot be undone. Continue?',
  'adv.importConfirmTitle': 'Confirm import',
  'adv.importFailedAlert': 'Import failed: {error}',
  'adv.backupCreatedAlert': 'Backup created',
  'adv.backupFailedAlert': 'Backup failed: {error}',
  'adv.restoreConfirmBody': 'This will completely replace your current data with “{name}”.\nThis cannot be undone. Continue?',
  'adv.restoreConfirmTitle': 'Restore from backup',
  'adv.restoreFailedAlert': 'Restore failed: {error}',
  'adv.deleteConfirmBody': 'All lists, tasks, and settings will be permanently deleted.\nThis cannot be undone. Are you sure?',
  'adv.deleteConfirmTitle': 'Confirm database deletion',
  'adv.deleteFailedAlert': 'Delete failed: {error}',
  'adv.sampleAddedAlert': 'Sample lists added',
  'adv.sampleFailedAlert': 'Failed to add: {error}',
  'adv.resetFailedAlert': 'Reset failed: {error}',
  'adv.resetConfirmBody': 'All your lists and tasks will be deleted.\nThis cannot be undone. Are you sure you want to reset?',
  'adv.resetConfirmTitle': 'Reset the app',

  'lang.ja': '日本語',
  'lang.en': 'English',
};

const dicts: Record<Lang, Dict> = { ja, en };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang, opts?: { fromEvent?: boolean }) => void;
}

// Best-effort synchronous guess for the very first render, before the
// (async) install-language lookup in initLanguageFromInstall() resolves.
// OS-language check only distinguishes "is it English" — anything else
// defaults to Japanese, matching this app's Japanese-first origin.
function guessLangFromOs(): Lang {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    if (nav?.toLowerCase().startsWith('en')) return 'en';
  } catch { /* ignore */ }
  return 'ja';
}

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'ja') return v;
  } catch { /* ignore */ }
  return guessLangFromOs();
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: initialLang(),
  setLang: (lang, opts) => {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    set({ lang });
    if (!opts?.fromEvent) emit('language-changed', { lang }).catch(() => {});
  },
}));

// Cross-window sync: another window's language switch arrives here and is
// applied without re-emitting (fromEvent guards against an event ping-pong).
listen<{ lang: Lang }>('language-changed', (event) => {
  const lang = event.payload?.lang;
  if (lang === 'ja' || lang === 'en') {
    useI18nStore.getState().setLang(lang, { fromEvent: true });
  }
}).catch(() => {});

// Installer language handoff: on the very first launch (no app-internal
// language choice yet), read the language the user picked in the NSIS
// installer's language-selector dialog from the registry (written by the
// installerHooks .nsh — see src-tauri/installer/language-hook.nsh) and adopt
// it as the starting language. From the second launch onward the app-internal
// setting (localStorage, already written by then) always wins and this is a
// no-op. Never blocks startup — falls back silently on any failure.
let _installLangChecked = false;
export async function initLanguageFromInstall(): Promise<void> {
  if (_installLangChecked) return;
  _installLangChecked = true;
  try {
    if (localStorage.getItem(LANG_KEY)) return; // app-internal setting already exists
  } catch { return; }
  let lang: Lang = guessLangFromOs();
  try {
    const fromRegistry = await invoke<string | null>('get_install_language');
    if (fromRegistry === 'ja' || fromRegistry === 'en') lang = fromRegistry;
  } catch { /* registry unreadable — keep the OS-language guess */ }
  useI18nStore.getState().setLang(lang);
}

function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key];
  if (s === undefined) {
    s = dicts.ja[key];
    if (s !== undefined) {
      console.warn(`[i18n] missing "${lang}" translation for key "${key}" — falling back to ja`);
    } else {
      console.warn(`[i18n] unknown i18n key "${key}"`);
      return key;
    }
  }
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  }
  return s;
}

// Hook: returns a translate function bound to the current language.
export function useT() {
  const lang = useI18nStore((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>): string => translate(lang, key, vars);
}

// Non-hook translate for plain async helper functions (e.g. import/export
// utilities called from event handlers, outside React render) — reads the
// current language directly from the store, same pattern as the existing
// `useAppStore.getState()` calls used throughout the codebase.
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().lang, key, vars);
}

// Exposed for tests (key-parity / fallback checks) without needing React.
export const _i18nInternal = { dicts, translate };
