import React, { useEffect, useMemo, useState } from 'react';
import { getApp } from 'firebase/app';
import { getDatabase, ref, onValue, query, limitToLast, update, remove } from 'firebase/database';
import { AlertOctagon, AlertTriangle, AlertCircle, CheckCircle2, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { UI } from '../../ui/kit';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { UserProfile } from '../../types';

interface ErrorsBlockProps {
  user: UserProfile;
}

type Severity = 'critical' | 'error' | 'warning';

interface ErrorEntry {
  key: string;
  ts: number;
  severity: Severity;
  scope: string;
  message: string;
  detail?: string | null;
  path?: string | null;
  uid?: string | null;
  role?: string | null;
  url?: string | null;
  build?: string | null;
  status?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: number | null;
}

const SEVERITY_STYLE: Record<Severity, { label: string; className: string; icon: any }> = {
  critical: { label: 'Критично', className: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertOctagon },
  error: { label: 'Ошибка', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  warning: { label: 'Предупреждение', className: 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]', icon: AlertCircle },
};

/** Дата и время записи журнала: dd/mm/yyyy чч:мм (как в остальном портале). */
function formatWhen(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ErrorsBlock({ user }: ErrorsBlockProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [hideResolved, setHideResolved] = useState(true);

  const isRoot = user.role === 'root_admin';

  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const db = getDatabase(getApp());
      // Читаем последние события: узел растёт, поэтому только хвост.
      unsub = onValue(query(ref(db, 'appErrors'), limitToLast(200)), (snap) => {
        const data = snap.val() || {};
        const list: ErrorEntry[] = Object.keys(data).map((key) => ({ key, ...(data[key] || {}) }));
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        setEntries(list);
        setLoading(false);
      }, () => setLoading(false));
    } catch {
      setLoading(false);
    }
    return () => { if (unsub) unsub(); };
  }, []);

  const scopes = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => { if (e.scope) set.add(e.scope); });
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
      if (scopeFilter !== 'all' && e.scope !== scopeFilter) return false;
      if (hideResolved && e.status === 'resolved') return false;
      if (!text) return true;
      return [e.message, e.detail, e.path, e.scope].some((v) => String(v || '').toLowerCase().includes(text));
    });
  }, [entries, severityFilter, scopeFilter, search, hideResolved]);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stats = useMemo(() => {
    const today = entries.filter((e) => (e.ts || 0) >= dayAgo && e.status !== 'resolved');
    return {
      total: entries.length,
      today: today.length,
      critical: today.filter((e) => e.severity === 'critical').length,
      resolved: entries.filter((e) => e.status === 'resolved').length,
    };
  }, [entries, dayAgo]);

  const markResolved = async (entry: ErrorEntry, resolved: boolean) => {
    try {
      const db = getDatabase(getApp());
      await update(ref(db, `appErrors/${entry.key}`), resolved
        ? { status: 'resolved', resolvedBy: user.name, resolvedAt: Date.now() }
        : { status: null, resolvedBy: null, resolvedAt: null });
      toast(resolved ? 'Отмечено как решённое' : 'Возвращено в список', 'success');
    } catch {
      toast('Не удалось обновить запись журнала', 'error');
    }
  };

  const clearResolved = async () => {
    const resolved = entries.filter((e) => e.status === 'resolved');
    if (!resolved.length) { toast('Решённых записей нет', 'info'); return; }
    const ok = await showConfirm(
      `Удалить из журнала ${resolved.length} решённых записей? Действие необратимо.`,
      'Очистить решённые?',
    );
    if (!ok) return;
    try {
      const db = getDatabase(getApp());
      const updates: Record<string, null> = {};
      resolved.forEach((e) => { updates[`appErrors/${e.key}`] = null; });
      await update(ref(db), updates);
      toast('Журнал очищен', 'success');
    } catch {
      toast('Не удалось очистить журнал', 'error');
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 flex items-center gap-3">
        <RefreshCw size={16} className="animate-spin text-[#9CA3AF]" aria-hidden="true" />
        <span className="text-sm text-[#6B7280]">Загружаем журнал ошибок…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#121316]">Ошибки в работе портала</h3>
              <p className="text-xs text-[#6B7280] mt-0.5 max-w-xl leading-relaxed">
                Сюда попадают сбои из интерфейса: неудачные сохранения в базе, падения рендера, незагруженные файлы
                после обновления. Критические события уходят дежурному в Telegram.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1 rounded-full">
                за 24 ч: {stats.today}
              </span>
              {stats.critical > 0 && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
                  критичных: {stats.critical}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1 min-w-0">
              <input
                className={UI.input}
                placeholder="Поиск по тексту, узлу базы, разделу…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Поиск по журналу ошибок"
              />
            </div>
            <select
              className={`${UI.input} sm:w-[190px]`}
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              aria-label="Фильтр по разделу"
            >
              <option value="all">Все разделы</option>
              {scopes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              className={`${UI.input} sm:w-[170px]`}
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as any)}
              aria-label="Фильтр по важности"
            >
              <option value="all">Любая важность</option>
              <option value="critical">Критичные</option>
              <option value="error">Ошибки</option>
              <option value="warning">Предупреждения</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setHideResolved((v) => !v)}
              className={UI.buttonGhost}
            >{hideResolved ? 'Показать решённые' : 'Скрыть решённые'}</button>
            {isRoot && stats.resolved > 0 && (
              <button onClick={clearResolved} className={`${UI.buttonGhost} text-rose-600`}>
                <Trash2 size={13} className="mr-1.5 inline" aria-hidden="true" />
                Очистить решённые ({stats.resolved})
              </button>
            )}
            {!isRoot && stats.resolved > 0 && (
              <span className={`${UI.hint} inline-flex items-center gap-1`}>
                <Lock size={12} aria-hidden="true" /> Очистка журнала доступна только разработчику
              </span>
            )}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center">
          <CheckCircle2 size={22} className="mx-auto text-emerald-500 mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#121316]">Ошибок нет</p>
          <p className="text-xs text-[#6B7280] mt-1">За выбранный фильтр ничего не зафиксировано.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((e) => {
            const style = SEVERITY_STYLE[e.severity] || SEVERITY_STYLE.error;
            const IconComponent = style.icon;
            const resolved = e.status === 'resolved';
            return (
              <article
                key={e.key}
                className={`bg-white border rounded-2xl p-4 ${resolved ? 'border-[#E5E7EB] opacity-70' : 'border-[#E5E7EB]'}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider border px-2 py-0.5 rounded-full ${style.className}`}>
                        <IconComponent size={11} aria-hidden="true" />
                        {style.label}
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded-full">
                        {e.scope || 'без раздела'}
                      </span>
                      <span className="text-[11px] text-[#9CA3AF] font-mono">{formatWhen(e.ts)}</span>
                      {resolved && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          решено{e.resolvedBy ? `: ${e.resolvedBy}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#121316] mt-2 break-words">{e.message}</p>
                    {(e.path || e.role || e.build) && (
                      <p className="text-[11px] text-[#6B7280] mt-1 font-mono break-all">
                        {[e.path && `узел: ${e.path}`, e.role && `роль: ${e.role}`, e.build && `версия: ${e.build}`]
                          .filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {e.detail && (
                      <details className="mt-2">
                        <summary className="text-[11px] text-[#6B7280] cursor-pointer select-none">Технические подробности</summary>
                        <pre className="mt-1.5 text-[11px] leading-relaxed text-[#4B5563] bg-[#F8F9FA] border border-[#E5E7EB] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">{e.detail}</pre>
                      </details>
                    )}
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={() => markResolved(e, !resolved)}
                      className={UI.buttonGhost}
                    >{resolved ? 'Вернуть' : 'Решено'}</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
