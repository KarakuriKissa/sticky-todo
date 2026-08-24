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

  // ── Todo item context menu (contextMenu.ts) — plain t()/no-hook, ctx.selSuffix
  // is appended to several labels the same way the raw selSuffix string used to be
  'ctx.addAbove': '上に項目を追加',
  'ctx.addBelow': '下に項目を追加',
  'ctx.bold': '太字',
  'ctx.boldOff': '太字を解除',
  'ctx.strike': '打ち消し線',
  'ctx.strikeOff': '打ち消し線を解除',
  'ctx.comment': 'コメント',
  'ctx.toHeading': '見出しに変更',
  'ctx.toNormal': '通常に変更',
  'ctx.addSeparatorBelow': '区切り線を追加（下に）',
  'ctx.indent': 'インデント',
  'ctx.outdent': 'アウトデント',
  'ctx.lock': 'ロック',
  'ctx.unlock': 'ロック解除',
  'ctx.copy': 'コピー',
  'ctx.pasteBelow': '貼り付け（このタスクの下に）',
  'ctx.duplicate': '複製',
  'ctx.archive': 'アーカイブ',
  'ctx.unarchive': 'アーカイブから戻す',
  'ctx.delete': '削除',
  'ctx.selSuffix': ' ({n}件)',

  // ── Cheat sheet ("?" key, overlays.tsx) ──────────────────────────────────
  'cheat.heading': 'キーボードショートカット',
  'cheat.undo': '元に戻す',
  'cheat.redo': 'やり直し',
  'cheat.selectAll': '全選択',
  'cheat.search': '検索',
  'cheat.copyTask': 'タスクをコピー',
  'cheat.pasteTask': 'タスクを貼り付け',
  'cheat.headingToggle': '見出しに変更 / 戻す',
  'cheat.moveSelection': '選択を上下に移動',
  'cheat.multiSelect': '複数選択',
  'cheat.moveRow': '行を移動',
  'cheat.cancelClose': 'キャンセル / 閉じる',
  'cheat.hyperlink': 'ハイパーリンク',
  'cheat.hyperlinkFormat': '[表示文字](URL)',
  'cheat.showThisList': 'この一覧を表示',

  // ── Note window overlays (ClosingOverlay / SearchOverlay) ───────────────
  'overlay.savingLine1': '保存中…',
  'overlay.savingLine2': 'しばらくお待ちください',
  'overlay.saveFailed': '⚠ 保存に失敗しました',
  'overlay.searchPlaceholder': '🔍 このリスト内を検索',
  'overlay.zeroMatches': '0 件',
  'overlay.prevMatch': '前の一致 (Shift+Enter)',
  'overlay.nextMatch': '次の一致 (Enter)',

  // ── NoteList (launcher) ──────────────────────────────────────────────────
  'notelist.exportEmptyBody': '「{title}」にはタスクが1件もありません。\n空のリストとしてエクスポートしますか？',
  'notelist.exportEmptyTitle': '空のリストです',
  'notelist.exportOk': 'エクスポート',
  'notelist.exportDialogTitle': 'リストをエクスポート',
  'notelist.exportedAlert': 'エクスポートしました（{n}件のタスク）',
  'notelist.exportTextDialogTitle': 'テキストでエクスポート',
  'notelist.textFilterName': 'テキスト',
  'notelist.exportedTextAlert': 'テキストでエクスポートしました',
  'notelist.importDialogTitle': 'リストをインポート',
  'notelist.importDupBody': '「{title}」という名前のリストが既に{n}件あります。\n別名（コピー）として追加しますか？',
  'notelist.importDupTitle': 'リストの重複',
  'notelist.importDupOk': 'コピーとして追加',
  'notelist.copyTitle': '{title} のコピー',
  'notelist.noCategory': 'カテゴリー無し',
  'notelist.emptyTitle': 'リストがありません',
  'notelist.newBtn': '＋ 新規作成',
  'notelist.importBtn': '📥 インポート',
  'notelist.importBtnTitle': 'JSONファイルからリストをインポート',
  'notelist.lockedTitle': 'ロック中',
  'notelist.dblClickEditTitle': 'ダブルクリックで編集',
  'notelist.untitled': '（無題）',
  'notelist.matchHintTitle': '検索一致タスク',
  'notelist.deleteConfirm': '「{title}」を削除しますか？',
  'notelist.ctxCloseList': 'リストを閉じる',
  'notelist.ctxChangeCategory': 'カテゴリを変更',
  'notelist.ctxExportJson': 'エクスポート（JSON・再インポート用）',
  'notelist.ctxExportText': 'テキストで保存（.txt）',
  'notelist.ctxDeleteList': 'リストの削除',

  // ── CategoryList (launcher sidebar) ──────────────────────────────────────
  'catlist.header': 'カテゴリ',
  'catlist.all': 'すべて',
  'catlist.namePlaceholder': 'カテゴリ名',

  // ── Settings modal: assignee-tab intro + bulk-paste format hint (kept
  // separate keys so the <b> tags around 「グループ」「メンバー」and the
  // bold format line stay real JSX, not raw HTML in a translated string) ──
  'settings.assignee.introLine1': 'タスクに「誰が担当するか」を設定できる機能です。',
  'settings.assignee.introLine2Prefix': 'まず',
  'settings.assignee.groupWord': 'グループ',
  'settings.assignee.introLine2Middle': '（チームや部署など）を作り、その中に',
  'settings.assignee.memberWord': 'メンバー',
  'settings.assignee.introLine2Suffix': 'を追加してください。',
  'settings.assignee.introLine3': 'タスクウィンドウでタスクを右クリック →「担当者」から割り当てられます。',
  'bulk.instructions': 'ExcelやGoogleスプレッドシートからコピーして貼り付けてください。',
  'bulk.formatBold': '形式：グループ名 [Tab] メンバー名 [Tab] 色(#hex, 省略可)',
  'bulk.formatSuffix': ' — 1行1人',

  // ── Settings modal: Help tab ──────────────────────────────────────────────
  'help.title': 'ヘルプ',
  'help.intro': '使い方でわからないことがあればここを確認してください。',
  'help.h.basicUsage': '📋 基本的な使い方',
  'help.basic.li1Bold': '＋ボタン',
  'help.basic.li1Suffix': '：新しいリストを作成します',
  'help.basic.li2Prefix': 'リストを',
  'help.basic.li2Bold': 'ダブルクリック',
  'help.basic.li2Suffix': '：タスクウィンドウを開きます',
  'help.basic.li3Prefix': 'リストを',
  'help.basic.li3Bold': '右クリック',
  'help.basic.li3Suffix': '：閉じる・削除・カテゴリ変更',
  'help.basic.li4Prefix': 'リストを',
  'help.basic.li4Bold': '左のカテゴリへドラッグ',
  'help.basic.li4Suffix': '：カテゴリを変更します',

  'help.h.taskWindow': '📝 タスクウィンドウ',
  'help.task.li1Prefix': '上の入力欄に文字を入れて ',
  'help.task.li1Suffix': '：タスクを追加',
  'help.task.li2Suffix': ' キー：インデントを1段深く（最大6段）',
  'help.task.li3Prefix': 'タスクを',
  'help.task.li3Bold': '右クリック',
  'help.task.li3Suffix': '：太字・複製・アーカイブ・削除など',
  'help.task.li4Prefix': '左の',
  'help.task.li4Bold': '⠿マークをドラッグ',
  'help.task.li4Suffix': '：タスクを並び替え',
  'help.task.li5Prefix': 'テキスト内の URL は',
  'help.task.li5Bold': 'クリックで開けます',
  'help.task.li6Prefix': 'タイトルバーを',
  'help.task.li6Bold': '右クリック',
  'help.task.li6Suffix': '：リスト名を編集',

  'help.h.shortcuts': '⌨ ショートカット（タスクウィンドウ）',
  'help.shortcut.undoRedo': '元に戻す / やり直し',
  'help.shortcut.searchInList': 'このリスト内を検索',
  'help.shortcut.indentOutdent': 'インデント / アウトデント',
  'help.shortcut.lockUnlock': 'ロック / 解除',
  'help.shortcut.editComment': 'コメント編集',
  'help.shortcut.headingToggle': '見出し化 / 通常に戻す',
  'help.shortcut.addBelow': '下に新規行追加',
  'help.shortcut.addAbove': '上に新規行追加',
  'help.shortcut.showList': 'ショートカット一覧表示',

  'help.h.globalSearch': '🔍 横断検索',
  'help.search.li1': '画面上部の検索欄にキーワードを入力するとすべてのリストを同時に検索できます',
  'help.search.li2': '閉じているリストのタスクも検索対象になります',
  'help.search.li3': '結果をクリックするとそのタスクへ直接ジャンプします',
  'help.search.li4Suffix': ' または ✕ で検索を閉じます',

  'help.h.privacy': '🔒 プライバシー',
  'help.privacy.prefix': '入力したタスクや個人情報はすべて',
  'help.privacy.bold': 'このパソコンの中だけ',
  'help.privacy.suffix': 'に保存されます。 外部のサーバーには一切送信しません。',
  'help.privacy.line2': 'インターネットへの接続はアップデート確認ボタンを押したときだけです。',

  'help.h.changelog': '🆕 更新履歴',
  'help.changelog.intro': '最近の主な変更点です。全文は GitHub の CHANGELOG をご覧ください。',
  'help.changelog.li1': '🔗 ハイパーリンク：文字を選んで 🔗 ボタンでリンク化（タスク・コメント両対応）',
  'help.changelog.li2': '📂 URL・フォルダパス・独自スキームをクリックで開ける（開くブラウザも指定可）',
  'help.changelog.li3': '💬 コメント：アイコンのホバーで表示／クリックで固定、Shift+Enterで改行',
  'help.changelog.li4': '📋 タスクのコピペ・複数行貼り付け・打ち消し線・矢印キー移動',
  'help.changelog.li5': '🍎 Mac版（.dmg）の配布を開始',
  'help.changelog.li6': '💾 自動バックアップ・起動時復元・PC自動起動',
  'help.changelog.li7': '🐛 保存のたびにタスクが消える重大バグを修正',
  'help.changelog.linkText': '更新履歴の全文を見る →',

  'help.h.about': '📄 このアプリについて',
  'help.about.prefix': 'StickyTodo は',
  'help.about.bold': '完全無料',
  'help.about.suffix': 'で使えるデスクトップ向けタスク管理アプリです。',
  'help.about.versionLabel': 'バージョン: ',
  'help.about.githubLinkText': 'GitHub でソースコードを見る →',

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

  'ctx.addAbove': 'Add item above',
  'ctx.addBelow': 'Add item below',
  'ctx.bold': 'Bold',
  'ctx.boldOff': 'Remove bold',
  'ctx.strike': 'Strikethrough',
  'ctx.strikeOff': 'Remove strikethrough',
  'ctx.comment': 'Comment',
  'ctx.toHeading': 'Convert to heading',
  'ctx.toNormal': 'Convert to normal',
  'ctx.addSeparatorBelow': 'Add separator below',
  'ctx.indent': 'Indent',
  'ctx.outdent': 'Outdent',
  'ctx.lock': 'Lock',
  'ctx.unlock': 'Unlock',
  'ctx.copy': 'Copy',
  'ctx.pasteBelow': 'Paste (below this task)',
  'ctx.duplicate': 'Duplicate',
  'ctx.archive': 'Archive',
  'ctx.unarchive': 'Restore from archive',
  'ctx.delete': 'Delete',
  'ctx.selSuffix': ' ({n})',

  'cheat.heading': 'Keyboard shortcuts',
  'cheat.undo': 'Undo',
  'cheat.redo': 'Redo',
  'cheat.selectAll': 'Select all',
  'cheat.search': 'Search',
  'cheat.copyTask': 'Copy task',
  'cheat.pasteTask': 'Paste task',
  'cheat.headingToggle': 'Convert to heading / back',
  'cheat.moveSelection': 'Move selection up/down',
  'cheat.multiSelect': 'Multi-select',
  'cheat.moveRow': 'Move a row',
  'cheat.cancelClose': 'Cancel / Close',
  'cheat.hyperlink': 'Hyperlink',
  'cheat.hyperlinkFormat': '[display text](URL)',
  'cheat.showThisList': 'Show this list',

  'overlay.savingLine1': 'Saving…',
  'overlay.savingLine2': 'Please wait',
  'overlay.saveFailed': '⚠ Save failed',
  'overlay.searchPlaceholder': '🔍 Search this list',
  'overlay.zeroMatches': '0 matches',
  'overlay.prevMatch': 'Previous match (Shift+Enter)',
  'overlay.nextMatch': 'Next match (Enter)',

  'notelist.exportEmptyBody': '“{title}” has no tasks yet.\nExport it as an empty list?',
  'notelist.exportEmptyTitle': 'Empty list',
  'notelist.exportOk': 'Export',
  'notelist.exportDialogTitle': 'Export list',
  'notelist.exportedAlert': 'Exported ({n} tasks)',
  'notelist.exportTextDialogTitle': 'Export as text',
  'notelist.textFilterName': 'Text',
  'notelist.exportedTextAlert': 'Exported as text',
  'notelist.importDialogTitle': 'Import list',
  'notelist.importDupBody': '“{title}” already has {n} list(s) with that name.\nAdd it as a copy with a different name?',
  'notelist.importDupTitle': 'Duplicate list',
  'notelist.importDupOk': 'Add as copy',
  'notelist.copyTitle': '{title} (copy)',
  'notelist.noCategory': 'No category',
  'notelist.emptyTitle': 'No lists yet',
  'notelist.newBtn': '+ New list',
  'notelist.importBtn': '📥 Import',
  'notelist.importBtnTitle': 'Import a list from a JSON file',
  'notelist.lockedTitle': 'Locked',
  'notelist.dblClickEditTitle': 'Double-click to edit',
  'notelist.untitled': '(untitled)',
  'notelist.matchHintTitle': 'Matching task',
  'notelist.deleteConfirm': 'Delete “{title}”?',
  'notelist.ctxCloseList': 'Close list',
  'notelist.ctxChangeCategory': 'Change category',
  'notelist.ctxExportJson': 'Export (JSON, for re-import)',
  'notelist.ctxExportText': 'Save as text (.txt)',
  'notelist.ctxDeleteList': 'Delete list',

  'catlist.header': 'Categories',
  'catlist.all': 'All',
  'catlist.namePlaceholder': 'Category name',

  'settings.assignee.introLine1': 'This lets you set who is responsible for each task.',
  'settings.assignee.introLine2Prefix': 'First, create a ',
  'settings.assignee.groupWord': 'group',
  'settings.assignee.introLine2Middle': ' (e.g. a team or department), then add ',
  'settings.assignee.memberWord': 'members',
  'settings.assignee.introLine2Suffix': ' to it.',
  'settings.assignee.introLine3': 'Right-click a task in the task window → "Assignee" to assign it.',
  'bulk.instructions': 'Copy and paste from Excel or Google Sheets.',
  'bulk.formatBold': 'Format: group name [Tab] member name [Tab] color (#hex, optional)',
  'bulk.formatSuffix': ' — one person per line',

  'help.title': 'Help',
  'help.intro': 'Check here if you have questions about how to use the app.',
  'help.h.basicUsage': '📋 Basics',
  'help.basic.li1Bold': '+ button',
  'help.basic.li1Suffix': ': creates a new list',
  'help.basic.li2Prefix': 'Double-click ',
  'help.basic.li2Bold': 'a list',
  'help.basic.li2Suffix': ': opens the task window',
  'help.basic.li3Prefix': 'Right-click ',
  'help.basic.li3Bold': 'a list',
  'help.basic.li3Suffix': ': close, delete, or change its category',
  'help.basic.li4Prefix': 'Drag ',
  'help.basic.li4Bold': 'a list onto a category on the left',
  'help.basic.li4Suffix': ' to move it there',

  'help.h.taskWindow': '📝 Task window',
  'help.task.li1Prefix': 'Type in the box at the top and press ',
  'help.task.li1Suffix': ': adds a task',
  'help.task.li2Suffix': ' key: indents one level deeper (up to 6 levels)',
  'help.task.li3Prefix': 'Right-click ',
  'help.task.li3Bold': 'a task',
  'help.task.li3Suffix': ': bold, duplicate, archive, delete, and more',
  'help.task.li4Prefix': 'Drag ',
  'help.task.li4Bold': 'the ⠿ handle on the left',
  'help.task.li4Suffix': ' to reorder tasks',
  'help.task.li5Prefix': 'URLs in the text ',
  'help.task.li5Bold': 'can be clicked to open',
  'help.task.li6Prefix': 'Right-click ',
  'help.task.li6Bold': 'the title bar',
  'help.task.li6Suffix': ': edit the list name',

  'help.h.shortcuts': '⌨ Shortcuts (task window)',
  'help.shortcut.undoRedo': 'Undo / Redo',
  'help.shortcut.searchInList': 'Search this list',
  'help.shortcut.indentOutdent': 'Indent / Outdent',
  'help.shortcut.lockUnlock': 'Lock / Unlock',
  'help.shortcut.editComment': 'Edit comment',
  'help.shortcut.headingToggle': 'Convert to heading / back to normal',
  'help.shortcut.addBelow': 'Add new row below',
  'help.shortcut.addAbove': 'Add new row above',
  'help.shortcut.showList': 'Show shortcut list',

  'help.h.globalSearch': '🔍 Search across lists',
  'help.search.li1': 'Type a keyword in the search box at the top to search every list at once',
  'help.search.li2': 'Tasks in closed lists are searched too',
  'help.search.li3': 'Click a result to jump straight to that task',
  'help.search.li4Suffix': ' or ✕ closes the search',

  'help.h.privacy': '🔒 Privacy',
  'help.privacy.prefix': 'Everything you type — tasks and personal info — is stored ',
  'help.privacy.bold': 'only on this computer',
  'help.privacy.suffix': '. It is never sent to an external server.',
  'help.privacy.line2': 'The app only connects to the internet when you press the update-check button.',

  'help.h.changelog': '🆕 Changelog',
  'help.changelog.intro': 'Recent highlights below — see the full CHANGELOG on GitHub for everything.',
  'help.changelog.li1': '🔗 Hyperlinks: select text and click the 🔗 button to link it (works in tasks and comments)',
  'help.changelog.li2': '📂 Click URLs, folder paths, and custom schemes to open them (you can choose which browser)',
  'help.changelog.li3': '💬 Comments: hover the icon to preview, click to pin, Shift+Enter for a new line',
  'help.changelog.li4': '📋 Copy/paste tasks, paste multiple lines at once, strikethrough, arrow-key navigation',
  'help.changelog.li5': '🍎 Mac (.dmg) builds are now available',
  'help.changelog.li6': '💾 Automatic backups, restore lists on startup, launch with Windows',
  'help.changelog.li7': '🐛 Fixed a serious bug where tasks would disappear on every save',
  'help.changelog.linkText': 'View the full changelog →',

  'help.h.about': '📄 About this app',
  'help.about.prefix': 'StickyTodo is a ',
  'help.about.bold': 'completely free',
  'help.about.suffix': ' desktop task-manager app.',
  'help.about.versionLabel': 'Version: ',
  'help.about.githubLinkText': 'View the source on GitHub →',

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
