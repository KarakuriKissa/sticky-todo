// Custom hook — schedules desktop reminders for overdue / soon-due tasks.
//   * Fires once 1.5 s after items first arrive.
//   * Re-fires every settings.reminder_interval_min minutes after that.
//   * Sends ONE summary toast per state-change (count of overdue + count of
//     within-warnDays). No per-task spam.
//   * settings.reminder_interval_min === 0 disables the hook entirely.
import { useEffect, useRef } from 'react';
import type { Note, TodoItem, AppSettings } from '../../types';
import { log } from '../../utils/log';

interface Args {
  items: TodoItem[];
  note: Note | null;
  settings: AppSettings;
}

export function useReminders({ items, note, settings }: Args) {
  const lastSig = useRef('');
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled || items.length === 0) return;
      const wd = note?.warn_days ?? settings.deadline_warn_days ?? 3;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdue = items.filter(
        (i) => !i.archived && !i.checked && i.limit_date && new Date(i.limit_date) < today,
      );
      const dueSoon = items.filter((i) => {
        if (i.archived || i.checked || !i.limit_date) return false;
        const d = new Date(i.limit_date);
        const diff = (d.getTime() - today.getTime()) / 86400000;
        return diff >= 0 && diff <= wd;
      });

      if (overdue.length === 0 && dueSoon.length === 0) return;
      const sig = `${overdue.length}/${dueSoon.length}`;
      if (sig === lastSig.current) return;
      lastSig.current = sig;

      try {
        const { isPermissionGranted, requestPermission, sendNotification } =
          await import('@tauri-apps/plugin-notification');
        let allowed = await isPermissionGranted();
        if (!allowed) allowed = (await requestPermission()) === 'granted';
        if (!allowed) return;

        const title = note?.title ?? 'リスト';
        const lines: string[] = [];
        if (overdue.length > 0) lines.push(`⚠ 期限切れ ${overdue.length}件`);
        if (dueSoon.length > 0) lines.push(`📅 ${wd}日以内 ${dueSoon.length}件`);
        sendNotification({ title: `📋 ${title}`, body: lines.join(' / ') });
      } catch (e) { log.warn('[notify] failed:', e); }
    };

    const intervalMin = settings.reminder_interval_min ?? 30;
    if (intervalMin <= 0) return () => { cancelled = true; };
    const t1 = setTimeout(check, 1500);
    const t2 = setInterval(check, intervalMin * 60 * 1000);
    return () => { cancelled = true; clearTimeout(t1); clearInterval(t2); };
  }, [items.length, note?.warn_days, note?.title, settings.deadline_warn_days, settings.reminder_interval_min]);
}
