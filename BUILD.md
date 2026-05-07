# StickyTodo — ビルド & 検証手順

このドキュメントは StickyTodo を**自分の手元でビルドし、配布物が正しく動くか確認するため**の手順をまとめたものです。

---

## 必要な開発環境

| ツール | バージョン | 用途 |
|---|---|---|
| [Bun](https://bun.sh) | 1.x 以上 | パッケージマネージャ + テスト + Vite ラッパー |
| [Rust (rustup)](https://rustup.rs) | stable | Tauri バックエンドのコンパイル |
| Windows | 10/11 | アプリのターゲット OS |
| PowerShell 7+ | 任意 | クリーンビルドスクリプト用 |

---

## 推奨フロー: クリーンビルド

```powershell
cd D:\GoogleDrive\Claude\Apps\sticky-todo
pwsh ./scripts/build-clean.ps1
```

引数:
- `-SkipTauri` : Rust の Tauri ビルドをスキップ（Web ビルドだけ確認したい時）

スクリプトの中身:
1. `dist/`、`node_modules/`、`src-tauri/target/`、`bun.lock` を削除
2. `bun install` で再インストール
3. `scripts/generate-icons.ps1` を呼んで Tauri アイコンを再生成
4. `bun run build` で TS チェック + Vite ビルド
5. `bun test tests/` でユニット/結合テスト
6. `bun run tauri build` で MSI / NSIS / 単体 EXE を生成

成功すると以下が出力されます:
- `src-tauri/target/release/bundle/nsis/StickyTodo_x.y.z_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/StickyTodo_x.y.z_x64_en-US.msi`
- `src-tauri/target/release/sticky-todo.exe`

---

## 各ステップ単独実行

```powershell
# 依存関係だけ
bun install --force

# テストだけ
bun test tests/

# Web ビルド (TS + Vite) だけ
bun run build

# Tauri ビルドだけ (Web ビルド済みであること)
bun run tauri build

# アイコン再生成だけ
bun run icons
```

---

## CI でのビルド確認

GitHub Actions の `🚀 StickyTodo をビルド` ワークフロー (`.github/workflows/build.yml`) が、push と手動 dispatch のたびに同じ手順を実行します。

CI はローカルとは別に:
- **アーティファクトとして 90 日間ダウンロード可能**
- **GitHub Releases に `build-#N` プレリリース**として永続的に公開
- **`bun test tests/` の結果も確認**

ローカルで再現できない場合は CI ログを確認:
1. https://github.com/TomTomYukkie/sticky-todo/actions を開く
2. 失敗した run をクリック
3. 各ステップの展開ログ + 「`Download log archive`」で zip を取得

---

## 起動確認の手順

ビルド成果物がユーザーに届けられる状態かを確認するため、以下の手動チェックを通します。

### 1. インストーラー版 (`StickyTodo_x.y.z_x64-setup.exe`)
1. ダブルクリック → Windows SmartScreen が出る
2. 「詳細情報」→「実行」
3. インストーラー UI が起動 → 既定パスで「インストール」
4. 「StickyTodo を起動」チェック → 完了
5. ランチャーが起動し、サンプルリスト 3 つが見える

### 2. MSI 版 (`StickyTodo_x.y.z_x64_en-US.msi`)
1. ダブルクリック
2. 「実行」許可
3. インストーラー進行 → 「Finish」
4. スタートメニューから StickyTodo を起動
5. 同上の起動確認

### 3. 単体 EXE 版 (`sticky-todo.exe`)
1. 任意のフォルダに置く
2. 右クリック → プロパティ → 一番下「ブロックの解除」
3. ダブルクリック → ランチャー起動

### 4. 動作確認チェックリスト
- [ ] 起動時にランチャーが表示される
- [ ] 「📚 ようこそ — StickyTodo の使い方」リストをダブルクリックで開ける
- [ ] タスクを追加 → 閉じる → 再起動 → タスクが残っている
- [ ] Ctrl+F でリスト内検索が動く
- [ ] ランチャーの検索欄でグローバル検索が動く
- [ ] 設定 → ヘルプ で全ショートカット一覧が表示される
- [ ] 設定 → 詳細設定 → エクスポートで .db ファイルを保存できる
- [ ] 上記 .db を別 PC でインポート → リスト復元される

### 5. ロールバック手順
新ビルドで問題が起きた時は:
1. **インストーラー版**: コントロールパネル → アプリのアンインストール → 旧 EXE を再インストール
2. **単体 EXE 版**: ファイルを差し替えるだけ

> データは `%APPDATA%\com.stickytodo.app\sticky-todo.db` にあるので、アプリ自体を入れ替えてもデータは消えません。
> 念のためアップデート前に「設定 → 詳細設定 → エクスポート」でバックアップを取ることを推奨します。

---

## トラブルシュート

### `bun install` が失敗する
```powershell
Remove-Item -Recurse -Force node_modules, bun.lock
bun install
```

### `cargo check` で `icons/icon.ico not found`
```powershell
bun run icons
```

### Tauri build が `wix not found` で止まる
初回は WiX Toolset を Tauri が自動 DL します。ネットワーク制限環境では事前に [WiX 3.14](https://github.com/wixtoolset/wix3/releases/tag/wix3141rtm) を手動配置。

### CI のテストが落ちる
ローカルで `bun test tests/` を回して全件 pass にしてから push してください。
