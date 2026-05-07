import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../../types';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

// Advanced settings — deadline warning, desktop notification interval,
// language placeholder, sync placeholder, DB export/import/delete actions.
export function AdvancedTab({ draft, setDraft }: Props) {
  const onExport = async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ts = new Date().toISOString().slice(0, 10);
    const path = await save({
      title: 'データベースをエクスポート',
      defaultPath: `sticky-todo-${ts}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!path) return;
    try {
      await invoke('export_database', { destPath: path });
      alert('エクスポートが完了しました');
    } catch (e) {
      alert('エクスポート失敗: ' + e);
    }
  };

  const onImport = async () => {
    const { open, confirm } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      title: 'データベースをインポート',
      multiple: false,
      directory: false,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!path || typeof path !== 'string') return;
    const ok = await confirm(
      '現在のデータをインポートしたデータで完全に置き換えます。\nこの操作は取り消せません。続行しますか？',
      { title: 'インポートの確認', kind: 'warning' },
    );
    if (!ok) return;
    try { await invoke('import_database', { srcPath: path }); }
    catch (e) { alert('インポート失敗: ' + e); }
  };

  const onDelete = async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(
      'すべてのリスト・タスク・設定が完全に削除されます。\nこの操作は取り消せません。本当に削除しますか？',
      { title: 'データベース削除の確認', kind: 'warning' },
    );
    if (!ok) return;
    try { await invoke('delete_database'); }
    catch (e) { alert('削除失敗: ' + e); }
  };

  const onResetTutorial = async () => {
    try {
      // localStorage を先にクリア。delete_database は app.restart() を呼ぶため
      // それ以降の JS は実行されない。
      localStorage.removeItem('sticky-todo:tutorial-seeded');
      localStorage.removeItem('sticky-todo:last-seen-build');
      await invoke('delete_database'); // ← アプリが即座に再起動される
    } catch (e) {
      alert('初期化失敗: ' + e);
    }
  };

  const numberInput = { width: 48, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' as const };
  const para = { fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 };

  return (
    <section>
      <h3>期日警告</h3>
      <p style={para}>
        期日が近いタスクに警告色を表示します。各リストで個別に上書き可能です。
      </p>
      <label className="toggle-row" style={{ gap: 6, marginBottom: 4 }}>
        期限の
        <input type="number" min={0} max={30}
          value={draft.deadline_warn_days}
          onChange={(e) => setDraft((d) => ({ ...d, deadline_warn_days: Number(e.target.value) }))}
          style={numberInput} />
        日前から警告色を表示
      </label>

      <h3 style={{ marginTop: 20 }}>デスクトップ通知</h3>
      <p style={para}>
        リストを開いている間、期限切れ・期日が近いタスクを Windows 通知で知らせます。<br />
        <strong>0 にすると通知を無効化</strong>します。
      </p>
      <label className="toggle-row" style={{ gap: 6 }}>
        チェック間隔
        <input type="number" min={0} max={1440}
          value={draft.reminder_interval_min ?? 30}
          onChange={(e) => setDraft((d) => ({ ...d, reminder_interval_min: Number(e.target.value) }))}
          style={{ ...numberInput, width: 64 }} />
        分ごと（0 で無効）
      </label>

      <h3 style={{ marginTop: 20 }}>データベース</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        すべてのデータはローカルの SQLite データベースに保存されています。<br />
        エクスポートでバックアップを作成、インポートで別のデータベースに置き換えできます。
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onExport}>📤 エクスポート</button>
        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onImport}>📥 インポート</button>
        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px', color: '#ef4444', borderColor: '#ef4444' }} onClick={onDelete}>🗑️ データベースを削除</button>
      </div>

      <h3 style={{ marginTop: 20 }}>⚠️ アプリの初期化</h3>
      <div style={{ fontSize: 12, lineHeight: 1.7, padding: '10px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, marginBottom: 10 }}>
        <strong style={{ color: '#ef4444' }}>作成したリスト・タスクがすべて消えます。</strong><br />
        初期化すると今まで入力したメモやタスクは復元できません。<br />
        初期化後はサンプルデータが表示されます（アプリを初めて起動したときと同じ状態）。
      </div>
      <button
        className="btn-secondary"
        style={{ fontSize: 12, padding: '5px 12px', color: '#ef4444', borderColor: '#ef4444' }}
        onClick={async () => {
          const { confirm } = await import('@tauri-apps/plugin-dialog');
          const ok = await confirm(
            '作成したリスト・タスクがすべて削除されます。\nこの操作は取り消せません。本当に初期化しますか？',
            { title: 'アプリの初期化', kind: 'warning' },
          );
          if (ok) onResetTutorial();
        }}
      >
        🗑️ アプリを初期化する
      </button>
    </section>
  );
}
