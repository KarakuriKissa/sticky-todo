# ビルド手順

## 前提

| ツール | バージョン | 備考 |
|--------|-----------|------|
| Rust   | 1.77+     | `rustup update stable` |
| Node.js | 20+      | npm 同梱 |
| Tauri CLI | 2.x    | 下記でインストール |

```powershell
# Rust インストール (未導入の場合)
winget install Rustlang.Rustup

# Tauri 前提: WebView2 は Windows 11 標準搭載
```

---

## 開発実行

```powershell
cd sticky-todo
npm install
npm run tauri dev
```

初回は Rust クレート（rusqlite bundled 含む）のコンパイルで 2〜3 分かかります。  
2 回目以降は差分コンパイルで数秒です。

---

## EXE ビルド

```powershell
npm run tauri build
```

成果物:
```
src-tauri/target/release/sticky-todo.exe          # 単体 EXE
src-tauri/target/release/bundle/msi/StickyTodo_*.msi   # インストーラー
src-tauri/target/release/bundle/nsis/StickyTodo_*.exe  # NSIS インストーラー
```

`strip = true` + `lto = true` + `opt-level = "s"` で EXE サイズ最小化済み。

---

## データ保存場所

```
%APPDATA%\com.stickytodo.app\sticky-todo.db   (SQLite WAL モード)
```

---

## フォルダ構成

```
sticky-todo/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # エントリポイント
│   │   ├── lib.rs           # Tauri セットアップ・コマンド登録
│   │   ├── models.rs        # データ構造 (serde)
│   │   ├── db.rs            # SQLite CRUD (rusqlite)
│   │   └── commands.rs      # Tauri invoke コマンド群
│   ├── capabilities/
│   │   └── default.json     # ウィンドウ権限設定
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── src/
│   ├── types/index.ts       # 共通型定義
│   ├── store/
│   │   ├── appStore.ts      # グローバル状態 (付箋一覧・カテゴリ・設定)
│   │   └── noteStore.ts     # 付箋ウィンドウ状態 (項目・Undo/Redo)
│   ├── components/
│   │   ├── CategoryList.tsx # カテゴリサイドバー
│   │   ├── NoteList.tsx     # 付箋一覧
│   │   └── TodoItem.tsx     # ToDo 行コンポーネント
│   ├── windows/
│   │   ├── Launcher.tsx     # メインウィンドウ
│   │   └── Note.tsx         # 付箋ウィンドウ
│   ├── utils/sync.ts        # 差分同期ロジック
│   ├── App.tsx              # URL パラメータでウィンドウ切替
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 主要コマンド対応表

| 操作 | キー |
|------|------|
| 検索 | Ctrl+F |
| 新規付箋 | ツールバー「＋新規」 |
| 付箋を開く | ダブルクリック |
| 次行追加 | Enter |
| インデント | Tab |
| デインデント | Shift+Tab |
| 行削除 | Backspace (空行) |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y / Ctrl+Shift+Z |
| 複数選択 | Ctrl+クリック |
| 最前面固定 | 📌 ボタン |

---

## 同期追加手順 (任意)

`src/utils/sync.ts` の `syncNow()` はサーバー側 API に POST します。  
Launcher の設定モーダルで sync_enabled=true にすると 30 秒ごとに自動同期。

バックエンド要件:
- `POST /api/sync` — Bearer token 認証
- ボディ: `{ notes: Note[], items: TodoItem[] }`
- dirty フラグの付いたレコードのみ送信
- 同期成功後 `dirty=false` に自動更新

---

## スマホ対応 (設計)

```
Mobile (React Native / Expo 想定)
├── タブ UI ← categories[]
├── 一覧画面 ← notes[] per category
└── 詳細画面
    ├── チェックON/OFF
    ├── テキスト編集
    └── 項目追加
同期は REST API 経由で共有
```
