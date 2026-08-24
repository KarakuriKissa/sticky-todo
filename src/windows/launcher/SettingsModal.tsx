// Extracted from Launcher.tsx — settings modal with statuses, assignees,
// advanced (deadline, sync placeholder, DB management) and help tabs.
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAppStore } from '../../store/appStore';
import type { AppSettings, AssigneeGroup, AssigneePerson, Status } from '../../types';
import { AdvancedTab } from './AdvancedTab';
import { SyncTab } from './SyncTab';
import {
  DEV_APP_VERSION,
  classifyCheckError,
  classifyPreflight,
  messageForUpdateFailure,
  type UpdateCheckFailure,
  type UpdatePreflight,
} from '../../utils/updateCheck';
import { useT, t } from '../../i18n';

// ── ステータス エクスポート/インポート ────────────────────────────────────────
async function exportStatuses(statuses: Status[]) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: t('status.exportDialogTitle'),
    defaultPath: `statuses-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  await invoke('write_text_file', { path, content: JSON.stringify({ version: 1, statuses }, null, 2) });
  alert(t('status.exportedAlert'));
}

async function importStatuses(
  existing: Status[],
  saveStatus: (s: Status) => Promise<void>,
) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ title: t('status.importDialogTitle'), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || typeof path !== 'string') return;
  const text = await invoke<string>('read_text_file', { path });
  let data: any;
  try { data = JSON.parse(text); } catch { alert(t('status.jsonParseError')); return; }
  if (!data?.statuses || !Array.isArray(data.statuses)) { alert(t('status.invalidFormat')); return; }
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
  alert(t('status.importResult', { added, skipped }));
}

// ── 担当者 エクスポート/インポート ──────────────────────────────────────────
async function exportAssignees(groups: AssigneeGroup[], persons: AssigneePerson[]) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: t('assignee.exportDialogTitle'),
    defaultPath: `assignees-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  const payload = groups.map(g => ({
    name: g.name,
    persons: persons.filter(p => p.group_id === g.id).map(p => ({ name: p.name, color: p.color })),
  }));
  await invoke('write_text_file', { path, content: JSON.stringify({ version: 1, groups: payload }, null, 2) });
  alert(t('assignee.exportedAlert'));
}

async function importAssignees(
  existingGroups: AssigneeGroup[],
  existingPersons: AssigneePerson[],
  saveAssigneeGroup: (g: AssigneeGroup) => Promise<void>,
  saveAssigneePerson: (p: AssigneePerson) => Promise<void>,
) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ title: t('assignee.importDialogTitle'), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || typeof path !== 'string') return;
  const text = await invoke<string>('read_text_file', { path });
  let data: any;
  try { data = JSON.parse(text); } catch { alert(t('status.jsonParseError')); return; }
  if (!data?.groups || !Array.isArray(data.groups)) { alert(t('status.invalidFormat')); return; }
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
  alert(t('assignee.importResult', { groupAdded, personAdded, personSkipped }));
}

export function HelpSection() {
  const t = useT();
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // 'idle' | 'dev' | 'checking' | 'latest' | 'update' | 'downloading' | 'error'
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'dev' }
    | { kind: 'checking' }
    | { kind: 'latest' }
    | { kind: 'update'; update: Update }
    | { kind: 'downloading'; percent: number }
    | { kind: 'error'; failure: UpdateCheckFailure }
  >({ kind: 'idle' });

  const checkUpdate = async () => {
    // 開発版(ローカルビルド)は常に v0.1.0 のまま。公式リリースは CI が
    // 0.1.<run番号> を焼き込むため、この一致は「未リリースの開発版」の確実な判定になる
    if (appVersion === DEV_APP_VERSION) {
      setUpdateState({ kind: 'dev' });
      return;
    }
    setUpdateState({ kind: 'checking' });
    try {
      // Tauri updater plugin: 埋め込み公開鍵で署名検証したうえで
      // latest.json (GitHub Releases) と現在のバージョンを比較する
      const update = await check();
      if (update) {
        setUpdateState({ kind: 'update', update });
      } else {
        setUpdateState({ kind: 'latest' });
      }
    } catch (e) {
      // tauri-plugin-updater の check() は HTTPステータスを握りつぶし、オフライン・
      // レート制限(403)・未検出(404)がすべて同じ汎用エラーになってしまう。
      // 素のHTTPで同じURLへ再アクセスし、実際の理由を区別してから表示する
      try {
        const preflight = await invoke<UpdatePreflight>('preflight_update_check');
        const failure = classifyPreflight(preflight);
        if (failure) {
          setUpdateState({ kind: 'error', failure });
          return;
        }
      } catch {
        // プリフライトも失敗した場合は元のエラーをそのまま出す
      }
      setUpdateState({ kind: 'error', failure: classifyCheckError(e) });
    }
  };

  const installUpdate = async (update: Update) => {
    setUpdateState({ kind: 'downloading', percent: 0 });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          setUpdateState({ kind: 'downloading', percent: total > 0 ? Math.round((received / total) * 100) : 0 });
        }
      });
      // インストール(NSISをサイレント実行)完了。再起動して新バージョンを反映する
      await relaunch();
    } catch (e) {
      setUpdateState({ kind: 'error', failure: classifyCheckError(e) });
    }
  };

  return (
    <section>
      <h3>{t('help.title')}</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        {t('help.intro')}
      </p>

      <h4 style={{ marginTop: 14 }}>{t('help.h.basicUsage')}</h4>
      <ul className="help-list">
        <li><b>{t('help.basic.li1Bold')}</b>{t('help.basic.li1Suffix')}</li>
        <li>{t('help.basic.li2Prefix')}<b>{t('help.basic.li2Bold')}</b>{t('help.basic.li2Suffix')}</li>
        <li>{t('help.basic.li3Prefix')}<b>{t('help.basic.li3Bold')}</b>{t('help.basic.li3Suffix')}</li>
        <li>{t('help.basic.li4Prefix')}<b>{t('help.basic.li4Bold')}</b>{t('help.basic.li4Suffix')}</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>{t('help.h.taskWindow')}</h4>
      <ul className="help-list">
        <li>{t('help.task.li1Prefix')}<kbd>Enter</kbd>{t('help.task.li1Suffix')}</li>
        <li><kbd>Tab</kbd>{t('help.task.li2Suffix')}</li>
        <li>{t('help.task.li3Prefix')}<b>{t('help.task.li3Bold')}</b>{t('help.task.li3Suffix')}</li>
        <li>{t('help.task.li4Prefix')}<b>{t('help.task.li4Bold')}</b>{t('help.task.li4Suffix')}</li>
        <li>{t('help.task.li5Prefix')}<b>{t('help.task.li5Bold')}</b></li>
        <li>{t('help.task.li6Prefix')}<b>{t('help.task.li6Bold')}</b>{t('help.task.li6Suffix')}</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>{t('help.h.shortcuts')}</h4>
      <table className="help-shortcut-table">
        <tbody>
          <tr><td>Ctrl+Z / Ctrl+Y</td><td>{t('help.shortcut.undoRedo')}</td></tr>
          <tr><td>Ctrl+A</td><td>{t('cheat.selectAll')}</td></tr>
          <tr><td>Ctrl+F</td><td>{t('help.shortcut.searchInList')}</td></tr>
          <tr><td>Tab / Shift+Tab</td><td>{t('help.shortcut.indentOutdent')}</td></tr>
          <tr><td>Ctrl+B</td><td>{t('ctx.bold')}</td></tr>
          <tr><td>Ctrl+D</td><td>{t('ctx.duplicate')}</td></tr>
          <tr><td>Ctrl+L</td><td>{t('help.shortcut.lockUnlock')}</td></tr>
          <tr><td>Ctrl+M</td><td>{t('help.shortcut.editComment')}</td></tr>
          <tr><td>Ctrl+H / Ctrl+Shift+H</td><td>{t('help.shortcut.headingToggle')}</td></tr>
          <tr><td>Ctrl+E</td><td>{t('ctx.archive')}</td></tr>
          <tr><td>Shift+Enter</td><td>{t('help.shortcut.addBelow')}</td></tr>
          <tr><td>Ctrl+Shift+Enter</td><td>{t('help.shortcut.addAbove')}</td></tr>
          <tr><td>?</td><td>{t('help.shortcut.showList')}</td></tr>
        </tbody>
      </table>

      <h4 style={{ marginTop: 14 }}>{t('help.h.globalSearch')}</h4>
      <ul className="help-list">
        <li>{t('help.search.li1')}</li>
        <li>{t('help.search.li2')}</li>
        <li>{t('help.search.li3')}</li>
        <li><kbd>Esc</kbd>{t('help.search.li4Suffix')}</li>
      </ul>

      <h4 style={{ marginTop: 14 }}>{t('help.h.privacy')}</h4>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        {t('help.privacy.prefix')}<b>{t('help.privacy.bold')}</b>{t('help.privacy.suffix')}<br />
        {t('help.privacy.line2')}
      </p>

      <h4 style={{ marginTop: 14 }}>{t('upd.heading')}</h4>
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px' }}>
        {t('upd.currentVersionLabel')}: {appVersion ? `v${appVersion}` : t('upd.checking')}
      </p>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={checkUpdate}
          disabled={updateState.kind === 'checking' || updateState.kind === 'downloading'}
        >
          {updateState.kind === 'checking' ? t('upd.checking') : t('upd.checkButton')}
        </button>
        {updateState.kind === 'dev' && (
          <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 11 }}>{t('upd.devNotice')}</span>
        )}
        {updateState.kind === 'latest' && (
          <span style={{ marginLeft: 12, color: '#4ade80', fontWeight: 600 }}>{t('upd.latest')}</span>
        )}
        {updateState.kind === 'update' && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(251,191,36,.12)', borderRadius: 6, borderLeft: '3px solid #fbbf24' }}>
            <b>{t('upd.found', { version: updateState.update.version })}</b>
            {updateState.update.body && (
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0', whiteSpace: 'pre-wrap' }}>{updateState.update.body}</p>
            )}
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', marginTop: 6 }}
              onClick={() => installUpdate(updateState.update)}
            >{t('upd.installRestart')}</button>
          </div>
        )}
        {updateState.kind === 'downloading' && (
          <span style={{ marginLeft: 12, color: 'var(--muted)' }}>
            {t('upd.downloading')} {updateState.percent > 0 ? `${updateState.percent}%` : ''}
          </span>
        )}
        {updateState.kind === 'error' && (
          <div style={{ marginTop: 8 }}>
            {/* messageForUpdateFailure() text comes from utils/updateCheck.ts,
                which stays Japanese-only regardless of UI language (out of
                scope for this i18n pass — see task notes). */}
            <span style={{ color: '#f87171', fontSize: 11 }}>{messageForUpdateFailure(updateState.failure)}</span>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: '3px 8px', marginLeft: 10 }}
              onClick={async () => {
                (await import('@tauri-apps/plugin-shell')).open('https://github.com/KarakuriKissa/sticky-todo/releases/latest');
              }}
            >{t('upd.manualDownload')}</button>
          </div>
        )}
      </div>

      <h4 style={{ marginTop: 18 }}>{t('help.h.changelog')}</h4>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 6 }}>
        {t('help.changelog.intro')}
      </p>
      <ul className="help-list" style={{ fontSize: 12 }}>
        <li>{t('help.changelog.li1')}</li>
        <li>{t('help.changelog.li2')}</li>
        <li>{t('help.changelog.li3')}</li>
        <li>{t('help.changelog.li4')}</li>
        <li>{t('help.changelog.li5')}</li>
        <li>{t('help.changelog.li6')}</li>
        <li>{t('help.changelog.li7')}</li>
      </ul>
      <p style={{ fontSize: 12, marginTop: 4 }}>
        <a href="#" onClick={async (e) => {
          e.preventDefault();
          (await import('@tauri-apps/plugin-shell')).open('https://github.com/KarakuriKissa/sticky-todo/blob/main/CHANGELOG.md');
        }} style={{ color: '#a5b4fc' }}>{t('help.changelog.linkText')}</a>
      </p>

      <h4 style={{ marginTop: 18 }}>{t('help.h.about')}</h4>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}>
        {t('help.about.prefix')}<b>{t('help.about.bold')}</b>{t('help.about.suffix')}<br />
        {appVersion && (
          <span>{t('help.about.versionLabel')}<strong style={{ color: 'var(--text)' }}>v{appVersion}</strong><br /></span>
        )}
        <a href="#" onClick={async (e) => {
          e.preventDefault();
          (await import('@tauri-apps/plugin-shell')).open('https://github.com/KarakuriKissa/sticky-todo');
        }} style={{ color: '#a5b4fc' }}>{t('help.about.githubLinkText')}</a>
      </p>
    </section>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
type SettingsTab = 'statuses' | 'assignees' | 'advanced' | 'sync' | 'help';

export function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void>;
  onClose: () => void;
}) {
  const tr = useT();
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

  // 同期は作りかけ（クラウド方式を検討中）なので、配布版では隠しておく。
  // コードは SyncTab.tsx / worker/ / src-tauri 側ともそのまま残してあるので、
  // ここを true にすればタブが戻る。中途半端な機能を製品に出さないための蓋。
  const SHOW_SYNC_TAB = false;

  const TABS: { id: SettingsTab; key: string }[] = [
    { id: 'statuses',  key: 'tab.statuses' },
    { id: 'assignees', key: 'tab.assignees' },
    { id: 'advanced',  key: 'tab.advanced' },
    ...(SHOW_SYNC_TAB ? [{ id: 'sync' as SettingsTab, key: 'tab.sync' }] : []),
    { id: 'help',      key: 'tab.help' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tr('settings.title')}</h2>

        <div className="settings-tabs">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              className={`settings-tab${tab === tb.id ? ' active' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {tr(tb.key)}
            </button>
          ))}
        </div>

        <div className="settings-body">

          {/* ── Status tab ── */}
          {tab === 'statuses' && (
            <section>
              <h3>{tr('status.manageTitle')}</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                {tr('status.editHint')}
              </p>
              <div className="status-list">
                {statuses.map((s) => (
                  <StatusRow
                    key={s.id}
                    status={s}
                    onEdit={(name) => saveStatus({ ...s, name })}
                    onColor={(color) => saveStatus({ ...s, color })}
                    onDelete={() => deleteStatus(s.id)}
                  />
                ))}
              </div>
              <div className="status-add-row">
                <input
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  placeholder={tr('status.namePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && addStatus()}
                />
                <input type="color" value={newStatusColor} onChange={(e) => setNewStatusColor(e.target.value)} />
                <button className="btn-primary" onClick={addStatus}>{tr('btn.add')}</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => exportStatuses(statuses)}>{tr('status.export')}</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => importStatuses(statuses, saveStatus)}>{tr('status.import')}</button>
              </div>
            </section>
          )}

          {/* ── Assignee tab ── */}
          {tab === 'assignees' && (
            <section>
              <h3>{tr('assignee.manageTitle')}</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 8 }}>
                {tr('settings.assignee.introLine1')}<br />
                {tr('settings.assignee.introLine2Prefix')}<b>{tr('settings.assignee.groupWord')}</b>{tr('settings.assignee.introLine2Middle')}<b>{tr('settings.assignee.memberWord')}</b>{tr('settings.assignee.introLine2Suffix')}<br />
                {tr('settings.assignee.introLine3')}
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => exportAssignees(assigneeGroups, assigneePersons)}>{tr('adv.export')}</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => importAssignees(assigneeGroups, assigneePersons, saveAssigneeGroup, saveAssigneePerson)}>{tr('adv.import')}</button>
                <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setShowBulkPaste((v) => !v)}>{tr('assignee.bulkPasteBtn')}</button>
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
                  <div className="assignee-col-header">{tr('assignee.groupHeader')}</div>
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
                            if (window.confirm(tr('assignee.deleteGroupConfirm', { name: g.name }))) {
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
                      placeholder={tr('assignee.groupNamePlaceholder')}
                      className="assignee-input"
                      onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                    />
                    <button className="btn-primary" onClick={addGroup} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>{tr('btn.add')}</button>
                  </div>
                </div>

                {/* RIGHT: member list */}
                <div className="assignee-col">
                  <div className="assignee-col-header">
                    {selectedGroupId
                      ? tr('assignee.membersOf', { group: assigneeGroups.find((g) => g.id === selectedGroupId)?.name ?? '' })
                      : tr('assignee.selectGroupHeader')}
                  </div>
                  {selectedGroupId ? (
                    <>
                      <div className="assignee-col-list">
                        {groupPersons.map((p) => (
                          <div key={p.id} className="assignee-group-item">
                            <input
                              type="color"
                              value={p.color}
                              onChange={(e) => saveAssigneePerson({ ...p, color: e.target.value })}
                              title={tr('note.changeColor')}
                              style={{ width: 16, height: 16, padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer', flexShrink: 0, background: 'transparent' }}
                            />
                            <span style={{ flex: 1 }}>{p.name}</span>
                            <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => deleteAssigneePerson(p.id)}>×</button>
                          </div>
                        ))}
                        {groupPersons.length === 0 && (
                          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>{tr('assignee.noMembers')}</div>
                        )}
                      </div>
                      <div className="assignee-col-add">
                        <input
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder={tr('assignee.memberNamePlaceholder')}
                          className="assignee-input"
                          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                        />
                        <input type="color" value={newPersonColor} onChange={(e) => setNewPersonColor(e.target.value)} style={{ width: 32, height: 28, cursor: 'pointer', border: 'none', borderRadius: 4, flexShrink: 0 }} />
                        <button className="btn-primary" onClick={addPerson} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>{tr('btn.add')}</button>
                      </div>
                    </>
                  ) : (
                    <div className="assignee-col-list" style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>
                      {tr('assignee.selectGroupBody')}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Advanced tab (deadline + language + db) ── */}
          {tab === 'advanced' && <AdvancedTab draft={draft} setDraft={setDraft} />}

          {/* ── Sync tab ── */}
          {tab === 'sync' && <SyncTab />}

          {/* ── Help / About ── */}
          {tab === 'help' && <HelpSection />}

        </div>{/* /settings-body */}

        <div className="modal-actions">
          <button className="btn-primary" onClick={save}>{tr('btn.save')}</button>
          <button className="btn-secondary" onClick={onClose}>{tr('btn.cancel')}</button>
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
  const t = useT();
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
    alert(t('bulk.importResult', { added, skipped }));
    onClose();
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        {t('bulk.instructions')}<br />
        <b>{t('bulk.formatBold')}</b>{t('bulk.formatSuffix')}
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
          {t('bulk.previewLabel', { n: preview.length })}
          {preview.slice(0, 5).map((r, i) => (
            <span key={i}> <span style={{ color: r.color }}>●</span> {r.group}/{r.name}</span>
          ))}
          {preview.length > 5 && <span> {t('bulk.previewMore', { n: preview.length - 5 })}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-primary" style={{ fontSize: 12 }} onClick={doImport} disabled={busy || preview.length === 0}>
          {busy ? t('bulk.processing') : t('bulk.importBtn', { n: preview.length })}
        </button>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onClose}>{t('btn.cancel')}</button>
      </div>
    </div>
  );
}

// ── StatusRow (editable inline) ───────────────────────────────────────────────
export function StatusRow({
  status,
  onEdit,
  onColor,
  onDelete,
}: {
  status: Status;
  onEdit: (name: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(status.name);

  const commit = () => {
    if (name.trim()) onEdit(name.trim());
    setEditing(false);
  };

  return (
    <div className="status-row">
      {/* Color swatch is now an editable color picker. */}
      <input
        type="color"
        value={status.color}
        onChange={(e) => onColor(e.target.value)}
        title={t('note.changeColor')}
        style={{ width: 18, height: 18, padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer', flexShrink: 0, background: 'transparent' }}
      />
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
