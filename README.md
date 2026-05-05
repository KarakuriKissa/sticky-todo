# 📌 StickyTodo

軽量なローカルファースト付箋型 ToDo マネージャ。デスクトップに複数の付箋ウィンドウを開いて、タスクを「見える化」しながら管理できます。

> **β版です** — フィードバックや不具合報告は [Issues](https://github.com/TomTomYukkie/sticky-todo/issues) へ。

![status](https://img.shields.io/badge/status-beta-orange)
![platform](https://img.shields.io/badge/platform-Windows-blue)

---

## ✨ 主な機能

- 📋 **複数リスト**を独立した付箋ウィンドウで開ける
- 🗂 **カテゴリ / ステータス / 担当者 / 期日 / 優先度**で多面的に整理
- 🔍 **グローバル検索** — 全リスト・全タスクを横断検索
- ⌨ **ブラウザ風 Ctrl+F** — リスト内のタスクをハイライト表示で検索
- 🔁 **元に戻す / やり直し**（履歴 50 件）
- 🗄 **アーカイブ** — 完了タスクをまとめて整理
- 🔒 **ロック** — 誤編集防止
- 🌈 **色分け** — リストごと、カテゴリごと
- 📌 **最前面固定** — 重要なリストは常に最前面に
- 💾 **二重保存** — SQLite + localStorage で確実に保存
- 🔔 **デスクトップ通知** — 期日が近いタスクをお知らせ
- 📤 **エクスポート / インポート** — DBファイルをバックアップ可能

---

## 🚀 インストール

### Windows
1. [Releases](https://github.com/TomTomYukkie/sticky-todo/releases) から最新版の `StickyTodo-x.x.x.exe`（インストーラー）または `sticky-todo.exe`（単体版）をダウンロード
2. ダブルクリックで起動

⚠ **「不明な発行元」警告について**
本アプリは現在 β版で **コード署名証明書を取得していない**ため、初回実行時に Windows SmartScreen 警告が表示されます。
- インストーラー版：「詳細情報」→「実行」
- 単体EXE版：右クリック→「プロパティ」→「許可する」にチェック→OK

---

## ⌨ ショートカット（タスクウィンドウ）

| キー | 動作 |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | 元に戻す / やり直し |
| `Ctrl+A` | 全選択 |
| `Ctrl+F` | このリスト内を検索 |
| `Tab` / `Shift+Tab` | インデント / アウトデント |
| `Ctrl+B` | 太字 |
| `Ctrl+D` | 複製 |
| `Ctrl+L` | ロック / 解除 |
| `Ctrl+M` | コメント編集 |
| `Ctrl+H` / `Ctrl+Shift+H` | 見出しに変更 / 通常に戻す |
| `Ctrl+E` | アーカイブ |
| `Shift+Enter` | 下に新規行 |
| `Ctrl+Shift+Enter` | 上に新規行 |
| `?` | ショートカット一覧表示 |

ランチャーでは `Ctrl+F` で検索欄にフォーカス。

---

## 🔒 プライバシー

StickyTodo は**すべてローカル**で動作します：

- ✅ タスクデータは `%APPDATA%\com.stickytodo.app\sticky-todo.db` (SQLite) と localStorage にのみ保存
- ✅ アカウント登録不要、個人情報の送信なし
- ⚠ **アップデート確認時のみ** GitHub の公開 API (`api.github.com`) に接続します

詳細はアプリ内「設定 > ヘルプ」を参照。

---

## 🛠 開発者向け

### 必要環境
- [Bun](https://bun.sh/) または Node.js 20+
- [Rust](https://rustup.rs/) (stable)
- Windows 10/11

### セットアップ
```bash
git clone https://github.com/TomTomYukkie/sticky-todo.git
cd sticky-todo
bun install
bun run tauri dev   # 開発モード（ホットリロード）
bun run tauri build # 本番ビルド（exe 生成）
```

### 技術スタック
- **フロントエンド**: React 18 + TypeScript + Zustand
- **バックエンド**: Rust + Tauri 2.x + rusqlite
- **ビルド**: Vite + GitHub Actions

---

## 📄 ライセンス

[MIT License](./LICENSE)

---

## 🤝 コントリビュート

不具合報告・機能要望は [Issues](https://github.com/TomTomYukkie/sticky-todo/issues) へ。
プルリクエストも歓迎します。
