# StickyTodo — EXE の作り方・配布方法

## 概要

このアプリを `.exe` にするには **GitHub**（無料）を使います。  
GitHubのサーバーが自動でビルドしてくれるので、  
**あなたのPCに何もインストール不要**です。

---

## STEP 1 — GitHub アカウントを作る（初回のみ・5分）

1. https://github.com を開く
2. 「Sign up」→ メールアドレスで無料登録
3. 登録完了

---

## STEP 2 — GitHub Desktop をインストール（初回のみ・5分）

1. https://desktop.github.com を開く
2. 「Download for Windows」をクリック
3. インストーラーを実行
4. GitHub Desktop を起動 → 先ほど作ったアカウントでサインイン

---

## STEP 3 — リポジトリを作る（初回のみ・2分）

1. GitHub Desktop を開く
2. 左上「File」→「Add local repository」
3. フォルダを選択:  
   `D:\GoogleDrive\Claude\Apps\sticky-todo`
4. 「create a repository here」をクリック
5. 「Publish repository」ボタンを押す
6. 「Keep this code private」にチェック（任意）→「Publish」

---

## STEP 4 — ビルドを実行する（毎回・ボタン1つ）

1. ブラウザで https://github.com を開く
2. 自分のリポジトリ（sticky-todo）を開く
3. 上のタブ「**Actions**」をクリック
4. 左の「🚀 StickyTodo をビルド」をクリック
5. 右側「**Run workflow**」ボタン → 「Run workflow」
6. **5〜10分待つ**（初回は15分かかる場合あり）

---

## STEP 5 — EXE をダウンロードする

1. ビルドが完了すると ✅ 緑チェックになる
2. クリックして開く
3. 下の「**Artifacts**」欄に以下が表示される:

| ファイル | 内容 |
|----------|------|
| `StickyTodo-インストーラー` | セットアップウィザード（おすすめ） |
| `StickyTodo-EXE単体` | インストール不要の単体EXE |

4. ダウンロードして ZIP を解凍する

---

## STEP 6 — 配布する

### インストーラー版（推奨）
`StickyTodo_0.1.0_x64-setup.exe` を相手に渡す  
→ ダブルクリックで普通にインストールできる

### 単体EXE版
`sticky-todo.exe` をそのまま渡す  
→ どこに置いてもダブルクリックで起動する

---

## アプリを更新したいとき

1. Claude Code でコードを修正
2. GitHub Desktop を開く → 変更が自動表示される
3. 「Commit to main」→「Push origin」
4. STEP 4 からやり直す

---

## トラブル

| 症状 | 対処 |
|------|------|
| Actions タブにワークフローが出ない | `.github/workflows/build.yml` が存在するか確認 |
| ビルドが ❌ 赤くなった | クリックして「build-windows」→ 赤い行を確認してここに貼る |
| EXEを起動したら「WindowsによってPCが保護されました」と出た | 「詳細情報」→「実行」をクリック（署名なしのため表示される）|
