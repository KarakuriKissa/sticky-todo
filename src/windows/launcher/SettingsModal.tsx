// Extracted from Launcher.tsx — settings modal with statuses, assignees,
// advanced (deadline, sync placeholder, DB management) and help tabs.
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../../store/appStore';
import type { AppSettings, AssigneeGroup, AssigneePerson, Status } from '../../types';
import { AdvancedTab } from './AdvancedTab';

// ── ステータス エクスポート/インポート ────────────────────────────────────────
async function exportStatuses(statuses: Status[]) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: 'ステータスをエクスポート',
    defaultPath: `statuses-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  await invoke('write_text_file', { path, content: JSON.stringify({ version: 1, statuses }, null, 2) });
  alert('ステータスをエクスポートしました');
}

async function importStatuses(
  existing: Status[],
  saveStatus: (s: Status) => Promise<void>,
) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ title: 'ステータスをインポート', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || typeof path !== 'string') return;
  const text = await invoke<string>('read_text_file', { path });
  let data: any;
  try { data = JSON.parse(text); } catch { alert('JSONとして読み込めませんでした'); return; }
  if (!data?.statuses || !Array.isArray(data.statuses)) { alert('形式が正しくありません'); return; }
  let added = 0, skipped = 0;
  // Compute next sort_order from the actual max, not array length (which could
  // be stale if items were deleted earlier).
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sort_order ?? 0), -1);
  for (const s of data.statuses as Status[]) {
    if (!s?.name) { skipped++; continue; }
    // Deduplicate by name only — same-name with different color is still a dup.
    const dup = existing.find(e => e.name === s.name);
    if (dup) { skipped++; continue; }
    const id = await invoke<string>('generate_id');
    await saveStatus({ id, name: s.name, color: s.color ?? '#94a3b8', sort_order: maxOrder + 1 + added });
    added++;
  }
  alert(`インポート完了: ${added}件追加, ${skipped}件スキップ（重複・不正データ）`);
}

// ── 担当者 エクスポート/インポート ──────────────────────────────────────────
async function exportAssignees(groups: AssigneeGroup[], persons: AssigneePerson[]) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: '担当者をエクスポート',
    defaultPath: `assignees-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  const payload = groups.map(g => ({
    name: g.name,
    persons: persons.filter(p => p.group_id === g.id).map(p => ({ name: p.name, color: p.color })),
  }));
  await invoke('write_text_file', { path, content: JSON.stringify({ version: 1, groups: payload }, null, 2) });
  alert('担当者をエクスポートしました');
}

async function importAssignees(
  existingGroups: AssigneeGroup[],
  existingPersons: AssigneePerson[],
  saveAssigneeGroup: (g: AssigneeGroup) => Promise<void>,
  saveAssigneePerson: (p: AssigneePerson) => Promise<void>,
) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ title: '担当者をインポート', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || typeof path !== 'string') return;
  const text = await invoke<string>('read_text_file', { path });
  let data: any;
  try { data = JSON.parse(text); } catch { alert('JSONとして読み込めませんでした'); return; }
  if (!data?.groups || !Array.isArray(data.groups)) { alert('形式が正しくありません'); return; }
  // Maintain a running local snapshot — otherwise filters against
  // existingPersons miss everyone added earlier in this loop, breaking sort_order.
  const localGroups = [...existingGroups];
  const localPersons = [...existingPersons];
  let groupAdded = 0, personAdded = 0, personSkipped = 0;
  for (const g of data.groups as { name: string; persons: { name: string; color: string }[] }[]) {
    if (!g?.name) continue;
    let group = localGroups.find(eg => eg.name === g.name);
    if (!group) {
      const id = await invoke<string>('generate_id');
      const maxGroupOrder = localGroups.reduce((m, x) => Math.max(m, x.sort_order ?? 0), -1);
      group = { id, name: g.name, sort_order: maxGroupOrder + 1 };
      await saveAssigneeGroup(group);
      localGroups.push(group);
      groupAdded++;
    }
    for (const p of g.persons ?? []) {
      if (!p?.name) { personSkipped++; continue; }
      const dup = localPersons.find(ep => ep.group_id === group!.id && ep.name === p.name);
      if (dup) { personSkipped++; continue; }
      const pid = await invoke<string>('generate_id');
      const groupPersons = localPersons.filter(ep => ep.group_id === group!.id);
      const maxOrder = groupPersons.reduce((m, x) => Math.max(m, x.sort_order ?? 0), -1);
      const newPerson = { id: pid, group_id: group!.id, name: p.name, color: p.color ?? '#6366f1', sort_order: maxOrder + 1 };
      await saveAssigneePerson(newPerson);
      localPersons.push(newPerson);
      personAdded++;
    }
  }
  alert(`インポート完了: グループ${groupAdded}件追加, メンバー${personAdded}件追加, ${personSkipped}件スキップ`);
}

export function HelpSection() {
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // 'idle' | 'checking' | 'latest' | 'update' | 'error'
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'latest' }
    | { kind: 'update'; runNumber: number; url: string }
    | { kind: 'error' }
  >({ kind: 'idle' });

  const checkUpdate = async () => {
    setUpdateState({ kind: 'checking' });
    try {
      const seenKey = 'sticky-todo:last-seen-build';
      const lastSeen = Number(localStorage.getItem(seenKey) ?? '0');
      const res = await fetch(
        'https://api.github.com/repos/KarakuriKissa/sticky-todo/actions/workflows/build.yml/runs?per_page=1&status=success',
      );
      const json = await res.json();
      const run = json.workflow_runs?.[0];
      if (!run) { setUpdateState({ kind: 'error' }); return; }
      // Record this run as "seen" on first check.
      if (lastSeen === 0) localStorage.setItem(seenKey, String(run.run_number));
      if (run.run_number > lastSeen && lastSeen > 0) {
        // Link to Releases (user-friendly download page) not the build artifacts page.
        setUpdateState({ kind: 'update', runNumber: run.run_number, url: 'https://github.com/KarakuriKissa/sticky-todo/releases/latest' });
      } else {
        setUpdateState({ kind: 'latest' });
      }
    } catch {
      setUpdateState({ kind: 'error' });
    }
  };

  return (
    <section>
      <h3>ヘルプ</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        使い方でわからないことがあればここを確認してください。
      </p>

      <h4 style={{ marginTop: 14 }}>📋 基本的な使い方</h4>
      <ul className="help-list">
        <li><b>＋ボタン</b>：新しいリストを作成します</li>
        <li>リストを<b>ダブルクリック</b>：タスクウィンドウを開きます</li>
        <li>リストを<b>右クリック</b>：閉じる・削除・カテゴリ変更</li>
        <li>リストを<b>左のカテゴリへドラッグ</b>：カテゴリを変更します</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>📝 タスクウィンドウ</h4>
      <ul className="help-list">
        <li>上の入力欄に文字を入れて <kbd>Enter</kbd>：タスクを追加</li>
        <li><kbd>Tab</kbd> キー：インデントを1段深く（最大6段）</li>
        <li>タスクを<b>右クリック</b>：太字・複製・アーカイブ・削除など</li>
        <li>左の<b>⠿マークをドラッグ</b>：タスクを並び替え</li>
        <li>テキスト内の URL は<b>クリックで開けます</b></li>
        <li>タイトルバーを<b>右クリック</b>：リスト名を編集</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>⌨ ショートカット（タスクウィンドウ）</h4>
      <table className="help-shortcut-table">
        <tbody>
          <tr><td>Ctrl+Z / Ctrl+Y</td><td>元に戻す / やり直し</td></tr>
          <tr><td>Ctrl+A</td><td>全選択</td></tr>
          <tr><td>Ctrl+F</td><td>このリスト内を検索</td></tr>
          <tr><td>Tab / Shift+Tab</td><td>インデント / アウトデント</td></tr>
          <tr><td>Ctrl+B</td><td>太字</td></tr>
          <tr><td>Ctrl+D</td><td>複製</td></tr>
          <tr><td>Ctrl+L</td><td>ロック / 解除</td></tr>
          <tr><td>Ctrl+M</td><td>コメント編集</td></tr>
          <tr><td>Ctrl+H / Ctrl+Shift+H</td><td>見出し化 / 通常に戻す</td></tr>
          <tr><td>Ctrl+E</td><td>アーカイブ</td></tr>
          <tr><td>Shift+Enter</td><td>下に新規行追加</td></tr>
          <tr><td>Ctrl+Shift+Enter</td><td>上に新規行追加</td></tr>
          <tr><td>?</td><td>ショートカット一覧表示</td></tr>
        </tbody>
      </table>

      <h4 style={{ marginTop: 14 }}>🔍 横断検索</h4>
      <ul className="help-list">
        <li>画面上部の検索欄にキーワードを入力するとすべてのリストを同時に検索できます</li>
        <li>閉じているリストのタスクも検索対象になります</li>
        <li>結果をクリックするとそのタスクへ直接ジャンプします</li>
        <li><kbd>Esc</kbd> または ✕ で検索を閉じます</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>🔒 プライバシー</h4>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        入力したタスクや個人情報はすべて<b>このパソコンの中だけ</b>に保存されます。
        外部のサーバーには一切送信しません。<br />
        インターネットへの接続はアップデート確認ボタンを押したときだけです。
      </p>

      <h4 style={{ marginTop: 14 }}>🔄 アップデート確認</h4>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={checkUpdate}
          disabled={updateState.kind === 'checking'}
        >
          {updateState.kind === 'checking' ? '確認中…' : '🔄 最新バージョンを確認'}
        </button>
        {updateState.kind === 'latest' && (
          <span style={{ marginLeft: 12, color: '#4ade80', fontWeight: 600 }}>✓ 最新バージョンです</span>
        )}
        {updateState.kind === 'update' && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(251,191,36,.12)', borderRadius: 6, borderLeft: '3px solid #fbbf24' }}>
            <b>⬆ 新しいバージョンがあります（#{updateState.runNumber}）</b><br />
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', marginTop: 6 }}
              onClick={async () => {
                (await import('@tauri-apps/plugin-shell')).open(updateState.url);
                localStorage.setItem('sticky-todo:last-seen-build', String(updateState.runNumber));
                setUpdateState({ kind: 'latest' });
              }}
            >ダウンロードページを開く →</button>
          </div>
        )}
        {updateState.kind === 'error' && (
          <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 11 }}>確認できませんでした（オフライン？）</span>
        )}
      </div>

      <h4 style={{ marginTop: 18 }}>📄 このアプリについて</h4>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}>
        StickyTodo は<b>完全無料</b>で使えるデスクトップ向けタスク管理アプリです。<br />
        {appVersion && (
          <span>バージョン: <strong style={{ color: 'var(--text)' }}>v{appVersion}</strong><br /></span>
        )}
        <a href="#" onClick={async (e) => {
          e.preventDefault();
          (await import('@tauri-apps/plugin-shell')).open('https://github.com/KarakuriKissa/sticky-todo');
        }} style={{ color: '#a5b4fc' }}>GitHub でソースコードを見る →</a>
      </p>
    </section>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
type SettingsTab = 'statuses' | 'assignees' | 'advanced' | 'help';

export function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('statuses');
  const [draft, setDraft] = useState<AppSettings>({ ...settings });

  const {
    statuses, saveStatus, deleteStatus,
    assigneeGroups, saveAssigneeGroup, deleteAssigneeGroup,
    assigneePersons, saveAssigneePerson, deleteAssigneePerson,
  } = useAppStore();

  // Status
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6366f1');

  // Assignee
  const [selectedGroupId, setSelectedGroupId] = useState<string>(assigneeGroups[0]?.id ?? '');
  const [newGroupName, setNewGroupName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonColor, setNewPersonColor] = useState('#6366f1');
  const [showBulkPaste, setShowBulkPaste] = useState(false);

  const save = async () => {
    await onSave(draft);
    onClose();
  };

  const addStatus = async () => {
    if (!newStatusName.trim()) return;
    const id = await invoke<string>('generate_id');
    await saveStatus({ id, name: newStatusName.trim(), color: newStatusColor, sort_order: statuses.length });
    setNewStatusName('');
  };

  const addGroup = async () => {
    if (!newGroupName.trim()) return;
    const id = await invoke<string>('generate_id');
    const group: AssigneeGroup = { id, name: newGroupName.trim(), sort_order: assigneeGroups.length };
    await saveAssigneeGroup(group);
    setNewGroupName('');
    setSelectedGroupId(id);
  };

  const addPerson = async () => {
    if (!newPersonName.trim() || !selectedGroupId) return;
    const id = await invoke<string>('generate_id');
    const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);
    const person: AssigneePerson = {
      id, group_id: selectedGroupId, name: newPersonName.trim(),
      color: newPersonColor, sort_order: groupPersons.length,
    };
    await saveAssigneePerson(person);
    setNewPersonName('');
  };

  const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'statuses',  label: 'ステータス' },
    { id: 'assignees', label: '担当者' },
    { id: 'advanced',  label: '詳細設定' },
    { id: 'help',      label: 'ヘルプ' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">

          {/* ── Status tab ── */}
          {tab === 'statuses' && (
            <section>
              <h3>ステータス管理</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                ダブルクリックで名前を編集
              </p>
              <div className="status-list">
                {statuses.map((s) => (
                  <StatusRow
                    key={s.id}
                    status={s}
                    onEdit={(name) => saveStatus({ ...s, name })}
                    onDelete={() => deleteStatus(s.id)}
                  />
                ))}
              </div>
              <div className="status-add-row">
                <input
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  placeholder="ステータス名"
                  onKeyDown={(e) => e.key === 'Enter' && addStatus()}
                />
                <input type="color" value={newStatusColor} onChange={(e) => setNewStatusColor(e.target.value)} />
                <button className="btn-primary" onClick={addStatus}>追加</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => exportStatuses(statuses)}>📤 エクスポート</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => importStatuses(statuses, saveStatus)}>📥 インポート</button>
              </div>
            </section>
          )}

          {/* ── Assignee tab ── */}
          {tab === 'assignees' && (
            <section>
              <h3>担当者グループとメンバー</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 8 }}>
                タスクに「誰が担当するか」を設定できる機能です。<br />
                まず<b>グループ</b>（チームや部署など）を作り、その中に<b>メンバー</b>を追加してください。<br />
                タスクウィンドウでタスクを右クリック →「担当者」から割り当てられます。
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => exportAssignees(assigneeGroups, assigneePersons)}>📤 エクスポート</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => importAssignees(assigneeGroups, assigneePersons, saveAssigneeGroup, saveAssigneePerson)}>📥 インポート</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setShowBulkPaste((v) => !v)}>📋 スプレッドシートから一括入力</button>
              </div>
              {showBulkPaste && (
                <BulkAssigneePaste
                  existingGroups={assigneeGroups}
                  existingPersons={assigneePersons}
                  saveAssigneeGroup={saveAssigneeGroup}
                  saveAssigneePerson={saveAssigneePerson}
                  onClose={() => setShowBulkPaste(false)}
                />
              )}
              <div className="assignee-split">
                {/* LEFT: group list */}
                <div className="assignee-col">
                  <div className="assignee-col-header">グループ</div>
                  <div className="assignee-col-list">
                    {assigneeGroups.map((g) => (
                      <div
                        key={g.id}
                        className={`assignee-group-item${selectedGroupId === g.id ? ' active' : ''}`}
                        onClick={() => setSelectedGroupId(g.id)}
                      >
                        <span className="assignee-group-name">{g.name}</span>
                        <button
                          className="btn-icon"
                          style={{ fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`グループ「${g.name}」を削除しますか？`)) {
                              deleteAssigneeGroup(g.id);
                              if (selectedGroupId === g.id) setSelectedGroupId(assigneeGroups.filter(x => x.id !== g.id)[0]?.id ?? '');
                            }
                          }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="assignee-col-add">
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="グループ名"
                      className="assignee-input"
                      onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                    />
                    <button className="btn-primary" onClick={addGroup} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>追加</button>
                  </div>
                </div>

                {/* RIGHT: member list */}
                <div className="assignee-col">
                  <div className="assignee-col-header">
                    {selectedGroupId
                      ? `${assigneeGroups.find((g) => g.id === selectedGroupId)?.name ?? ''} のメンバー`
                      : 'グループを選択'}
                  </div>
                  {selectedGroupId ? (
                    <>
                      <div className="assignee-col-list">
                        {groupPersons.map((p) => (
                          <div key={p.id} className="assignee-group-item">
                            <span className="status-dot" style={{ background: p.color }} />
                            <span style={{ flex: 1 }}>{p.name}</span>
                            <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => deleteAssigneePerson(p.id)}>×</button>
                          </div>
                        ))}
                        {groupPersons.length === 0 && (
                          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>メンバーなし</div>
                        )}
                      </div>
                      <div className="assignee-col-add">
                        <input
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder="メンバー名"
                          className="assignee-input"
                          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                        />
                        <input type="color" value={newPersonColor} onChange={(e) => setNewPersonColor(e.target.value)} style={{ width: 32, height: 28, cursor: 'pointer', border: 'none', borderRadius: 4, flexShrink: 0 }} />
                        <button className="btn-primary" onClick={addPerson} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>追加</button>
                      </div>
                    </>
                  ) : (
                    <div className="assignee-col-list" style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>
                      グループを選択してください
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Advanced tab (deadline + language + sync + db) ── */}
          {tab === 'advanced' && <AdvancedTab draft={draft} setDraft={setDraft} />}

          {/* ── Help / About ── */}
          {tab === 'help' && <HelpSection />}

        </div>{/* /settings-body */}

        <div className="modal-actions">
          <button className="btn-primary" onClick={save}>保存</button>
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}

// ── BulkAssigneePaste ─────────────────────────────────────────────────────────
// Excel/Sheetsからコピーしたタブ区切りデータを一括インポート
// フォーマット: グループ名\tメンバー名\t色(#hex, 省略可)
function BulkAssigneePaste({
  existingGroups, existingPersons, saveAssigneeGroup, saveAssigneePerson, onClose,
}: {
  existingGroups: AssigneeGroup[];
  existingPersons: AssigneePerson[];
  saveAssigneeGroup: (g: AssigneeGroup) => Promise<void>;
  saveAssigneePerson: (p: AssigneePerson) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ group: string; name: string; color: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const parse = (raw: string) => {
    const rows: { group: string; name: string; color: string }[] = [];
    for (const line of raw.split('\n')) {
      const cols = line.split('\t').map(s => s.trim());
      if (cols.length < 2 || !cols[0] || !cols[1]) continue;
      const color = cols[2] && /^#[0-9a-fA-F]{3,6}$/.test(cols[2]) ? cols[2] : '#6366f1';
      rows.push({ group: cols[0], name: cols[1], color });
    }
    return rows;
  };

  const onPaste = (raw: string) => {
    setText(raw);
    setPreview(parse(raw));
  };

  const doImport = async () => {
    setBusy(true);
    const rows = parse(text);
    const localGroups = [...existingGroups];
    const localPersons = [...existingPersons];
    let added = 0, skipped = 0;
    for (const row of rows) {
      let group = localGroups.find(g => g.name === row.group);
      if (!group) {
        const id = await invoke<string>('generate_id');
        group = { id, name: row.group, sort_order: localGroups.length };
        await saveAssigneeGroup(group);
        localGroups.push(group);
      }
      const dup = localPersons.find(p => p.group_id === group!.id && p.name === row.name);
      if (dup) { skipped++; continue; }
      const pid = await invoke<string>('generate_id');
      const gp = localPersons.filter(p => p.group_id === group!.id);
      const person: AssigneePerson = { id: pid, group_id: group!.id, name: row.name, color: row.color, sort_order: gp.length };
      await saveAssigneePerson(person);
      localPersons.push(person);
      added++;
    }
    setBusy(false);
    alert(`インポート完了: ${added}件追加, ${skipped}件スキップ（重複）`);
    onClose();
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        ExcelやGoogleスプレッドシートからコピーして貼り付けてください。<br />
        <b>形式：グループ名 [Tab] メンバー名 [Tab] 色(#hex, 省略可)</b> — 1行1人
      </p>
      <textarea
        style={{ width: '100%', height: 120, fontFamily: 'monospace', fontSize: 12, resize: 'vertical',
          background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: 6 }}
        placeholder={'開発チーム\t田中\t#6366f1\n開発チーム\t佐藤\t#22c55e\n営業チーム\t山田'}
        value={text}
        onChange={e => onPaste(e.target.value)}
      />
      {preview.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          プレビュー: {preview.length}件 —
          {preview.slice(0, 5).map((r, i) => (
            <span key={i}> <span style={{ color: r.color }}>●</span> {r.group}/{r.name}</span>
          ))}
          {preview.length > 5 && <span> …他{preview.length - 5}件</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-primary" style={{ fontSize: 12 }} onClick={doImport} disabled={busy || preview.length === 0}>
          {busy ? '処理中…' : `${preview.length}件をインポート`}
        </button>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onClose}>キャンセル</button>
      </div>
    </div>
  );
}

// ── StatusRow (editable inline) ───────────────────────────────────────────────
export function StatusRow({
  status,
  onEdit,
  onDelete,
}: {
  status: Status;
  onEdit: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(status.name);

  const commit = () => {
    if (name.trim()) onEdit(name.trim());
    setEditing(false);
  };

  return (
    <div className="status-row">
      <span className="status-dot" style={{ background: status.color }} />
      {editing ? (
        <input
          autoFocus
          className="cat-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{ flex: 1 }}
        />
      ) : (
        <span style={{ flex: 1, cursor: 'pointer' }} onDoubleClick={() => setEditing(true)}>
          {status.name}
        </span>
      )}
      <button className="btn-icon" onClick={onDelete}>×</button>
    </div>
  );
}
