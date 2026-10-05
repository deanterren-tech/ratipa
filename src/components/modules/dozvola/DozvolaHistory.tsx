import {useToast} from '../../ToastProvider'
import {useDialog} from '../../DialogProvider'
import {useState, useEffect, useMemo, useRef, useCallback, Fragment} from 'react'
import {UserProfile} from '../../../types'
import { useFirebase, database, onValue } from '../../../firebase'
import {Search, FileText, Trash2, X, User as UserIcon, Calendar, Hash, Paperclip, AlertTriangle, Info, Loader2, History, ChevronDown} from 'lucide-react'
import { ref, remove, query, limitToLast, endAt, orderByKey, get } from 'firebase/database'
import { useModalKeyboard } from '../../../hooks/useModalKeyboard'
import { BackButton } from '../../../ui/components'
import {
  HistoryKind as Kind,
  getSearchFields,
  matchRecord,
  recordMatches,
  searchHistory,
} from '../../../dozvolaHistorySearch'

interface DozvolaHistoryProps {
  user: UserProfile;
}

const fmtDateTime = (raw?: string) => {
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('ru-RU');
};

export default function DozvolaHistory({ user }: DozvolaHistoryProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<'actions' | 'documents'>('documents');
  // Страницы журнала. Первая (50 записей) — живая подписка с ограничением,
  // остальные подгружаются по кнопке «Показать ещё» курсором из базы.
  const [firstPage, setFirstPage] = useState<{ actions: any[]; documents: any[] }>({ actions: [], documents: [] });
  const [more, setMore] = useState<{
    actions: { items: any[]; hasMore: boolean };
    documents: { items: any[]; hasMore: boolean };
  }>({ actions: { items: [], hasMore: true }, documents: { items: [], hasMore: true } });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [detail, setDetail] = useState<{ rec: any; kind: Kind } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const searchWrapRef = useRef<HTMLDivElement>(null);

  /** Размер порции журнала. */
  const PAGE = 50;

  useEffect(() => {
    if (!useFirebase) { setLoading(false); return; }

    const withError = (label: string) => (err: any) => {
      setLoadError(`${label}: ${err?.message || 'не удалось загрузить записи'}`);
      setLoading(false);
    };

    // В память попадают только последние PAGE записей — весь узел не выгружается
    const subs: Array<() => void> = [];

    subs.push(onValue(
      query(ref(database, 'dozvolsHistoryV4'), limitToLast(PAGE)),
      (snapshot) => {
        const data = snapshot.val();
        const keys = data ? Object.keys(data).sort() : [];
        const list = keys.map((key) => ({ id: key, ...data[key] }));
        setFirstPage((prev) => ({ ...prev, actions: list }));
        setMore((prev) => ({ ...prev, actions: { ...prev.actions, hasMore: keys.length >= PAGE } }));
        setLoading(false);
        setLoadError(null);
      },
      withError('Журнал действий'),
    ));

    subs.push(onValue(
      query(ref(database, 'dozvolsDocumentsHistoryV1'), limitToLast(PAGE)),
      (snapshot) => {
        const data = snapshot.val();
        const keys = data ? Object.keys(data).sort() : [];
        const list = keys.map((key) => ({ id: key, ...data[key] }));
        setFirstPage((prev) => ({ ...prev, documents: list }));
        setMore((prev) => ({ ...prev, documents: { ...prev.documents, hasMore: keys.length >= PAGE } }));
        setLoading(false);
        setLoadError(null);
      },
      withError('История документов'),
    ));

    return () => subs.forEach((unsub) => unsub());
  }, []);

  // Новая выборка при смене запроса или вкладки начинается с первых 50 записей
  useEffect(() => {
    setMore({ actions: { items: [], hasMore: true }, documents: { items: [], hasMore: true } });
    setMoreError(null);
  }, [debouncedTerm, subTab]);

  // Задержка ввода — снижает лишние пересчёты на каждый символ
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm), 250);
    return () => clearTimeout(t);
  }, [searchTerm]);

  /** Объединение первой страницы и подгруженных порций без дублей. */
  const mergePages = (kind: 'actions' | 'documents') => {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const rec of [...firstPage[kind], ...more[kind].items]) {
      const id = String(rec?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(rec);
    }
    merged.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return merged;
  };

  const historyList = mergePages('actions');
  const docHistoryList = mergePages('documents');
  const currentList = subTab === 'documents' ? docHistoryList : historyList;
  const currentKind: Kind = subTab === 'documents' ? 'document' : 'action';

  /** Следующая порция из базы: берём записи старше последней загруженной. */
  const loadMore = async () => {
    const kind = subTab === 'documents' ? 'documents' : 'actions';
    const path = kind === 'documents' ? 'dozvolsDocumentsHistoryV1' : 'dozvolsHistoryV4';
    const loaded = mergePages(kind);
    const cursor = loaded.length > 0 ? String(loaded[loaded.length - 1].id) : null;
    setLoadingMore(true);
    setMoreError(null);
    try {
      // orderByKey обязателен: без явной сортировки сервер игнорирует курсор
      // и возвращает последние записи узла вместо продолжения выборки.
      const snapshot = await get(
        query(ref(database, path), orderByKey(), endAt(cursor), limitToLast(PAGE + 1)),
      );
      const data = snapshot.val() || {};
      const keys = Object.keys(data).sort().reverse().filter((key) => key !== cursor);
      const records = keys.map((key) => ({ id: key, ...data[key] }));
      const term = debouncedTerm.trim();
      // При активном поиске добавляем только совпавшие записи выборки,
      // а курсор всё равно сдвигается — пропусков и дублей не будет.
      const appended = term
        ? records.filter((rec) => recordMatches(rec, kind === 'documents' ? 'document' : 'action', term))
        : records;
      setMore((prev) => ({ ...prev, [kind]: { items: [...prev[kind].items, ...appended], hasMore: records.length >= PAGE } }));
    } catch (err) {
      // Уже показанные записи остаются на месте — предлагаем повторить
      console.error('[journal] не удалось загрузить следующую порцию:', err);
      setMoreError('Не удалось загрузить следующие записи. Повторите попытку.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Выпадающий список подходящих записей (общий модуль поиска)
  const suggestions = useMemo(
    () => searchHistory(currentList, currentKind, debouncedTerm),
    [currentList, currentKind, debouncedTerm],
  );

  // Текст запроса, для которого уже посчитаны результаты
  const suggestionsReady = debouncedTerm.trim() === searchTerm.trim();

  useEffect(() => {
    setHighlighted(0);
  }, [debouncedTerm, subTab]);

  // Закрытие списка по клику вне
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setIsSuggestOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filteredHistory = useMemo(
    () => (debouncedTerm.trim() ? historyList.filter((h) => recordMatches(h, 'action', debouncedTerm)) : historyList),
    [historyList, debouncedTerm],
  );
  const filteredDocHistory = useMemo(
    () => (debouncedTerm.trim() ? docHistoryList.filter((h) => recordMatches(h, 'document', debouncedTerm)) : docHistoryList),
    [docHistoryList, debouncedTerm],
  );

  const currentHasMore = subTab === 'documents' ? more.documents.hasMore : more.actions.hasMore;

  const openDetail = useCallback((rec: any, kind: Kind) => {
    setDetail({ rec, kind });
    setIsSuggestOpen(false);
  }, []);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (isSuggestOpen) { e.preventDefault(); setIsSuggestOpen(false); }
      return;
    }
    if (!isSuggestOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length) { setIsSuggestOpen(true); setHighlighted(0); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((p) => (p + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((p) => (p - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[highlighted];
      if (pick) openDetail(pick.rec, pick.kind);
    }
  };

  const handleDeleteActionLog = async (id: string) => {
    if (await showConfirm('Запись исчезнет из журнала операций безвозвратно.', 'Удалить запись журнала', { variant: 'danger', confirmLabel: 'Удалить запись' })) {
      remove(ref(database, `dozvolsHistoryV4/${id}`))
        .then(() => toast("Запись успешно удалена", 'success'))
        .catch(err => toast("Ошибка при удалении: " + (err instanceof Error ? err.message : String(err)), 'error'));
    }
  };

  const handleDeleteDocLog = async (id: string) => {
    if (await showConfirm('Запись исчезнет из истории документов безвозвратно.', 'Удалить запись истории', { variant: 'danger', confirmLabel: 'Удалить запись' })) {
      remove(ref(database, `dozvolsDocumentsHistoryV1/${id}`))
        .then(() => toast("Запись успешно удалена", 'success'))
        .catch(err => toast("Ошибка при удалении: " + (err instanceof Error ? err.message : String(err)), 'error'));
    }
  };

  const hasWriteAccess = user.role === 'root_admin' || user.permissions?.dozvola === 'write';
  const tabsBar = 'flex items-center gap-1.5 p-1 bg-[#F3F4F6]/75 rounded-xl w-fit';

  return (
    <div className="space-y-4">

      {/* Переключатель раздела + широкий поиск */}
      <div className="flex flex-col lg:flex-row lg:items-center pb-3 border-b border-[#E5E7EB] gap-3">
        <div className={tabsBar}>
          <button
            onClick={() => setSubTab('actions')}
            className={`px-4 min-h-[44px] py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              subTab === 'actions' ? 'bg-white text-[#121316] shadow-xs' : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6]'
            }`}
          >
            Журнал действий
            <span className="ml-1.5 text-[10px] font-mono text-[#9CA3AF]">{historyList.length}</span>
          </button>
          <button
            onClick={() => setSubTab('documents')}
            className={`px-4 min-h-[44px] py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'documents' ? 'bg-white text-[#121316] shadow-xs' : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6]'
            }`}
          >
            <FileText size={14} className="text-[var(--accent-ink)]" />
            История документов
            <span className="text-[10px] font-mono text-[#9CA3AF]">{docHistoryList.length}</span>
          </button>
        </div>

        {/* Поиск занимает основную ширину панели */}
        <div className="relative flex-1 min-w-0" ref={searchWrapRef}>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setIsSuggestOpen(true); }}
            onFocus={() => { if (searchTerm.trim()) setIsSuggestOpen(true); }}
            onKeyDown={onSearchKeyDown}
            placeholder="Поиск по названию, действию, автору, номерам дозволов, файлу, дате и деталям…"
            aria-label="Поиск по истории"
            role="combobox"
            aria-expanded={isSuggestOpen && suggestionsReady && suggestions.length > 0}
            aria-controls="history-search-results"
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-[#E5E7EB] text-[#121316] text-xs rounded-xl focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => { setSearchTerm(''); setIsSuggestOpen(false); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] cursor-pointer"
              aria-label="Очистить поиск"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Выпадающие результаты во время ввода */}
          {isSuggestOpen && searchTerm.trim() && (
            <div
              id="history-search-results"
              role="listbox"
              className="absolute z-[1200] left-0 right-0 mt-1.5 bg-white border border-[#E5E7EB] rounded-xl shadow-[0_12px_32px_rgba(15,23,42,0.14)] max-h-[380px] overflow-y-auto custom-scrollbar"
            >
              {!suggestionsReady ? (
                <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-[#9CA3AF]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Поиск…
                </div>
              ) : suggestions.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-[#6B7280]">Ничего не найдено по запросу «{searchTerm.trim()}».</p>
                  <p className="text-[11px] text-[#9CA3AF] mt-1">
                    Попробуйте номер дозвола, фамилию логиста или название документа.
                  </p>
                </div>
              ) : (
                suggestions.map((s, i) => (
                  <button
                    key={`${s.rec.id}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === highlighted}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => openDetail(s.rec, s.kind)}
                    className={`w-full text-left px-3.5 py-2.5 border-b border-[#F3F4F6] last:border-0 transition-colors cursor-pointer ${
                      i === highlighted ? 'bg-[var(--accent-10)]' : 'hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-[#121316] truncate">
                        {s.kind === 'document' ? (s.rec.documentName || 'Документ') : (s.rec.doc || 'Операция')}
                      </span>
                      <span className="text-[10px] text-[#9CA3AF] shrink-0">{s.rec.time || ''}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-medium text-[var(--accent-ink)] bg-[var(--accent-15)] px-1.5 py-0.5 rounded">
                        {s.match.field}
                      </span>
                      <span className="text-[11px] text-[#6B7280] truncate">
                        {s.match.before}
                        <mark className="bg-[#FFE08A] text-[#121316] rounded-sm px-0.5">{s.match.match}</mark>
                        {s.match.after}
                      </span>
                      {s.rec.logist && (
                        <span className="text-[10px] text-[#9CA3AF] shrink-0 inline-flex items-center gap-1">
                          <UserIcon className="h-3 w-3" />
                          {s.rec.logist}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ошибка загрузки не подменяется пустым результатом */}
      {loadError ? (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-rose-700">Не удалось загрузить историю</p>
            <p className="text-[11px] text-rose-600 mt-0.5">{loadError}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[#9CA3AF] text-xs">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка истории…
        </div>
      ) : subTab === 'actions' ? (
        <HistoryTable
          rows={filteredHistory}
          kind="action"
          emptyText={searchTerm.trim() ? 'Ничего не найдено по запросу.' : 'Записей в журнале действий нет.'}
          hasWriteAccess={hasWriteAccess}
          onDelete={handleDeleteActionLog}
          onOpen={(rec) => openDetail(rec, 'action')}
        />
      ) : (
        <HistoryTable
          rows={filteredDocHistory}
          kind="document"
          emptyText={searchTerm.trim() ? 'Ничего не найдено по запросу.' : 'Записей о формировании документов нет.'}
          hasWriteAccess={hasWriteAccess}
          onDelete={handleDeleteDocLog}
          onOpen={(rec) => openDetail(rec, 'document')}
        />
      )}

      {/* Постраничная подгрузка: новые записи добавляются к уже показанным,
          позиция прокрутки не сбрасывается. */}
      {!loading && !loadError && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <span className="text-[11px] text-[#9CA3AF]">
            Показано записей: {subTab === 'documents' ? filteredDocHistory.length : filteredHistory.length}
            {debouncedTerm.trim() ? ' (по выборке)' : ''}
          </span>

          {currentHasMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-xs font-medium text-[#121316] bg-white border border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
            >
              {loadingMore
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Загрузка…</>
                : <><ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" /> Показать ещё 50</>}
            </button>
          ) : (
            <span className="text-[11px] text-[#9CA3AF]">Все записи загружены</span>
          )}

          {moreError && (
            <p role="alert" className="text-[11px] text-rose-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {moreError}
            </p>
          )}
        </div>
      )}

      <HistoryDetailModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/* ─────────────────────────── Таблица записей ─────────────────────────── */

function HistoryTable({
  rows, kind, emptyText, hasWriteAccess, onDelete, onOpen,
}: {
  rows: any[];
  kind: Kind;
  emptyText: string;
  hasWriteAccess: boolean;
  onDelete: (id: string) => void;
  onOpen: (rec: any) => void;
}) {
  const head = kind === 'document'
    ? ['Время формирования', 'Логист', 'Название документа', 'Тип / Действие', 'Детали', 'Бланков']
    : ['Время', 'Логист', 'Бланк дозвола', 'Действие выполнено', 'Параметры и связи', ''];

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-left border-separate border-spacing-0">
        <thead>
          <tr className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
            {head.map((h, i) => (
              <th
                key={`${h}-${i}`}
                className={`sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB] ${
                  hasWriteAccess && i === head.length - 1 ? 'w-16 text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
            {kind === 'action' && hasWriteAccess && <th className="bg-white border-b border-[#E5E7EB] w-16" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const count = Array.isArray(h.permits) ? h.permits.length : (h.permitCount ?? null);
            return (
              <tr
                key={h.id}
                onClick={() => onOpen(h)}
                className="hover:bg-[#F9FAFB] transition-colors cursor-pointer"
                title="Открыть событие"
              >
                <td className="px-3 py-3 border-b border-[#F3F4F6]">
                  <span className="text-[11px] text-[#6B7280] font-medium whitespace-nowrap">{h.time}</span>
                </td>
                <td className="px-3 py-3 border-b border-[#F3F4F6]">
                  <span className="text-xs font-semibold text-[#121316]">{h.logist || '—'}</span>
                </td>
                <td className="px-3 py-3 border-b border-[#F3F4F6]">
                  <span className="text-xs font-semibold text-[#121316] inline-flex items-center gap-1.5">
                    <FileText size={13} className="text-[#9CA3AF] shrink-0" />
                    {kind === 'document' ? (h.documentName || '—') : (h.doc || '—')}
                  </span>
                </td>
                <td className="px-3 py-3 border-b border-[#F3F4F6]">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563] font-medium text-[10px] whitespace-nowrap">
                    {h.action || (kind === 'document' ? 'Формирование' : '—')}
                  </span>
                </td>
                <td className="px-3 py-3 border-b border-[#F3F4F6]">
                  <span className="text-[11px] text-[#6B7280] leading-tight block max-w-md break-words">
                    {h.details || h.meta || '—'}
                  </span>
                </td>
                <td className="px-3 py-3 border-b border-[#F3F4F6] text-right">
                  {kind === 'document' && (
                    count === null ? (
                      <span className="text-[10px] text-[#9CA3AF] whitespace-nowrap" title="Запись создана до внедрения детального хранения">
                        нет снимка
                      </span>
                    ) : (
                      <span className="text-xs font-mono tabular-nums text-[#121316]">{count}</span>
                    )
                  )}
                  {hasWriteAccess && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(h.id); }}
                      className="ml-2 p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer align-middle"
                      title="Удалить запись"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-12 text-[#6B7280] text-xs">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Подробности события ─────────────────────── */

function HistoryDetailModal({
  detail, onClose,
}: {
  detail: { rec: any; kind: Kind } | null;
  onClose: () => void;
}) {
  useModalKeyboard({ isOpen: !!detail, onClose });
  if (!detail) return null;

  const { rec, kind } = detail;
  const permits: any[] = Array.isArray(rec.permits) ? rec.permits : [];
  const hasSnapshot = permits.length > 0;
  const isLegacy = !hasSnapshot;

  const rows: { icon: any; label: string; value: string; mono?: boolean }[] = [
    { icon: FileText, label: kind === 'document' ? 'Название документа' : 'Бланк дозвола',
      value: kind === 'document' ? (rec.documentName || '—') : (rec.doc || '—') },
    { icon: Hash, label: 'Тип документа', value: rec.documentType || (kind === 'document' ? rec.documentName || '—' : '—') },
    { icon: Info, label: 'Действие', value: rec.action || '—' },
    { icon: Info, label: 'Результат / детали', value: rec.result || rec.details || rec.meta || '—' },
    { icon: Calendar, label: 'Дата и время', value: fmtDateTime(rec.time) },
    { icon: UserIcon, label: 'Автор', value: [rec.logist || '—', rec.userRole ? `(${rec.userRole})` : ''].filter(Boolean).join(' ') },
    { icon: Paperclip, label: 'Имя файла', value: rec.fileName || '—', mono: true },
    { icon: Hash, label: 'Количество бланков', value: hasSnapshot ? String(permits.length) : '—' },
  ];

  return (
    <div data-scroll-lock="modal" data-mobile-fullscreen className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Событие истории"
        className="relative z-10 w-full max-w-2xl bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <BackButton onClose={onClose} />
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
                <History className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#121316] truncate">
                  {kind === 'document' ? (rec.documentName || 'Событие документа') : (rec.doc || 'Событие журнала')}
                </h3>
                <p className="text-xs text-[#6B7280] mt-0.5 truncate">
                  {rec.action || '—'} · {fmtDateTime(rec.time)}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hidden md:inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
            {rows.map((r) => (
              <div key={r.label} className={r.label === 'Результат / детали' ? 'sm:col-span-2' : ''}>
                <span className="text-[11px] font-medium text-[#6B7280] block mb-0.5">{r.label}</span>
                <span className={`text-xs text-[#121316] break-words ${r.mono ? 'font-mono' : ''}`}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>

          {/* Состав документа — сохранённый снимок, не текущий реестр */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                Дозволы в документе
              </span>
              {hasSnapshot && <span className="text-[11px] text-[#6B7280]">всего {permits.length}</span>}
            </div>

            {isLegacy ? (
              <div className="flex items-start gap-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3.5 py-3">
                <AlertTriangle className="h-4 w-4 text-[#9CA3AF] shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#6B7280] leading-relaxed">
                  Состав документа в этой записи не сохранён — она создана до внедрения детального
                  хранения. Текущий состав реестра здесь не подставляется.
                </p>
              </div>
            ) : (
              <div className="border border-[#E5E7EB] rounded-xl overflow-hidden">
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-[#F9FAFB] text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none">
                      <th className="px-3 py-2 font-semibold border-b border-[#E5E7EB] w-10">№</th>
                      <th className="px-3 py-2 font-semibold border-b border-[#E5E7EB]">Вид</th>
                      <th className="px-3 py-2 font-semibold border-b border-[#E5E7EB]">Номер бланка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permits.map((p, i) => (
                      <tr key={`${p.id}-${i}`} className="hover:bg-[#F9FAFB] transition-colors">
                        <td className="px-3 py-2 border-b border-[#F3F4F6] text-[11px] text-[#9CA3AF] font-mono">{i + 1}</td>
                        <td className="px-3 py-2 border-b border-[#F3F4F6]">
                          <span className="text-[10px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                            {p.type || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-b border-[#F3F4F6] text-xs font-mono select-all text-[#121316]">
                          {p.number || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#E5E7EB] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded-lg text-xs font-medium text-[#4B5563] bg-white transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
