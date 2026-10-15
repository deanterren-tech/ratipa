import {useState, useRef, useEffect, useMemo} from 'react'
import type {KeyboardEvent as ReactKeyboardEvent} from 'react'
import {Check, Plus, RefreshCw, X} from 'lucide-react'
import {dbService} from '../../api'
import {getDriversFlat} from '../../services/fleetService'
import {useToast} from '../ToastProvider'
import {
  buildDriverDirectory,
  buildNewDriver,
  driverFullName,
  driverLinkNotice,
  driverMatchesQuery,
  isArchivedDriver,
  primaryPhone,
  resolveDriverLink,
  selectableDrivers,
  type DriverRecord,
} from '../../utils/driverRegistry'

/**
 * Выбор водителя из ЕДИНОГО реестра (`drivers`) — в стиле поля города:
 * поиск по ФИО и телефону, выделение выбранного, очистка, клавиатура
 * (↑/↓/Enter/Escape), состояния загрузки/пусто/ошибка.
 *
 * Правила списка заданы общим реестром (utils/driverRegistry):
 *  - только активные записи реестра (`archived`/служебные скрыты;
 *    уже назначенный архивный показывается с пометкой);
 *  - «Без водителя» — это пустое значение, а не фиктивный человек;
 *  - ссылка на отсутствующую запись — видимая проблема связи (предупреждение
 *    под полем), новый водитель из текста НЕ создаётся;
 *  - новую запись можно добавить только явным действием (кнопка
 *    «Добавить в справочник») — тогда она появится во всех разделах.
 */
export interface DriverAutocompleteProps {
  /** Идентификатор водителя ('' — без водителя). */
  value: string;
  /** Сохранённое имя выбранного водителя (для показа, если запись не найдена). */
  valueName?: string;
  /** Выбор/очистка: драйвер или null; meta.status — состояние связи. */
  onSelect: (driver: DriverRecord | null, meta: {status: string}) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Префикс data-ui для тестов и автотестов, напр. 'coupling-driver'. */
  dataUi?: string;
  /** Разрешить явное добавление новой записи в справочник (по клику). */
  allowCreate?: boolean;
  /** Автор добавления (для журнала действий). */
  author?: string;
  authorRole?: string;
  /** Скрыть эти id из списка (например, выбранный основной водитель). */
  excludeIds?: string[];
  /** Подпись пункта «нет назначения» в поиске (по умолчанию «Без водителя»). */
  emptyLabel?: string;
  /** Дополнительная подпись поля (в строке списка). */
  ariaLabel?: string;
}

interface Coords { top: number; left: number; width: number }

export default function DriverAutocomplete({
  value,
  valueName,
  onSelect,
  placeholder = 'ФИО или телефон…',
  disabled,
  className = '',
  dataUi = 'driver-picker',
  allowCreate = false,
  author,
  authorRole,
  excludeIds = [],
  emptyLabel = 'Без водителя',
  ariaLabel,
}: DriverAutocompleteProps) {
  const {toast} = useToast();
  const [drivers, setDrivers] = useState<DriverRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Поле в фокусе — показываем ввод; без фокуса — имя выбранного. */
  const [editing, setEditing] = useState(false);
  /** Пользователь печатает: только тогда текст фильтрует список (в фокусе показываем весь). */
  const [typed, setTyped] = useState(false);

  useEffect(() => {
    const unsub = getDriversFlat((list: any[]) => setDrivers(list || []));
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const registry = useMemo(() => buildDriverDirectory(drivers || []), [drivers]);
  const link = useMemo(
    () => resolveDriverLink({driverId: value, driverNameRu: valueName, driverName: valueName}, registry),
    [registry, value, valueName],
  );
  const selectedLabel = link.status === 'ok' || link.status === 'archived'
    ? link.displayName
    : (link.status === 'service' || link.status === 'missing' ? (link.displayName || valueName || '') : '');
  const notice = value ? driverLinkNotice(link) : '';

  const options = useMemo(() => {
    const base = selectableDrivers(drivers || []);
    // Уже назначенный архивный показываем в списке с пометкой (не скрываем связь)
    const cur = value ? registry.byId.get(String(value)) : null;
    if (cur && isArchivedDriver(cur) && !base.some((d) => d.id === cur.id)) {
      base.push(cur);
    }
    const excluded = new Set(excludeIds.map(String));
    return base.filter((d) => !excluded.has(String(d.id)));
  }, [drivers, registry, value, excludeIds]);

  const filtered = useMemo(() => {
    // В фокусе без ввода — весь список (единый порядок реестра);
    // текст фильтрует только после начала набора.
    const q = typed ? query.trim() : '';
    const list = q ? options.filter((d) => driverMatchesQuery(d, q)) : options;
    return list.slice(0, 100);
  }, [options, query, typed]);

  const updateCoords = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setCoords({top: rect.bottom + 4, left: rect.left, width: rect.width});
  };

  useEffect(() => {
    if (!open) return;
    const refresh = () => updateCoords();
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [open]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current && inputRef.current.contains(t)) return;
      if (listRef.current && listRef.current.contains(t)) return;
      setOpen(false);
      setEditing(false);
      setTyped(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open, typed]);

  const openMenu = () => {
    if (disabled) return;
    updateCoords();
    setOpen(true);
  };

  const commit = (d: DriverRecord | null) => {
    if (!d) {
      onSelect(null, {status: 'empty'});
    } else {
      onSelect(d, {status: isArchivedDriver(d) ? 'archived' : 'ok'});
    }
    setOpen(false);
    setEditing(false);
    setTyped(false);
  };

  const clear = () => {
    commit(null);
    inputRef.current?.focus();
  };

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return options.find((d) => driverFullName(d).trim().toLowerCase() === q) || null;
  }, [options, query]);

  const createDriver = async () => {
    const name = query.trim();
    if (!name || creating) return;
    if (!author) {
      toast('Нет автора записи — войдите заново', 'error');
      return;
    }
    setCreating(true);
    const rec = buildNewDriver('drv_' + Date.now(), name);
    try {
      dbService.saveDriver(rec, author, authorRole || 'dispatcher');
      toast(`Водитель «${driverFullName(rec)}» добавлен в справочник`, 'success');
      commit(rec);
    } catch (e: unknown) {
      toast('Не удалось добавить водителя: ' + ((e as Error)?.message || String(e)), 'error');
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setEditing(false);
        setTyped(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openMenu();
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      setEditing(false);
    }
  };

  const inputValue = editing || open ? query : (selectedLabel || '');

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel || 'Водитель'}
          data-ui={`${dataUi}-input`}
          value={inputValue}
          placeholder={value ? undefined : placeholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setEditing(true);
            setTyped(true);
            updateCoords();
            setOpen(true);
          }}
          onFocus={() => {
            setQuery(value ? selectedLabel : '');
            setEditing(false);
            openMenu();
          }}
          onKeyDown={onKeyDown}
          className={className}
          style={value ? {paddingRight: 52} : undefined}
        />
        {value ? (
          <button
            type="button"
            data-ui={`${dataUi}-clear`}
            aria-label="Очистить выбор водителя"
            title="Очистить (без водителя)"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-1.5 text-[11px] font-medium text-amber-600" data-ui={`${dataUi}-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {open && (
        <div
          ref={listRef}
          data-ui={`${dataUi}-menu`}
          data-driver-picker-open="1"
          role="listbox"
          aria-label="Список водителей"
          className="fixed z-[99999] bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto custom-scrollbar"
          style={coords ? {top: coords.top, left: coords.left, width: coords.width} : undefined}
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            data-ui={`${dataUi}-option-none`}
            onMouseDown={(e) => {
              e.preventDefault();
              commit(null);
            }}
            className={`w-full text-left px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 transition cursor-pointer border-b border-slate-100 ${
              !value ? 'bg-slate-50 text-slate-700' : ''
            }`}
          >
            {emptyLabel}
          </button>

          {drivers === null ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500" role="status">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" aria-hidden="true" />
              <span>Загрузка справочника водителей…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500" role="status">
              {query.trim()
                ? 'Не найдено. Проверьте ФИО или телефон.'
                : 'Справочник водителей пуст.'}
            </div>
          ) : (
            filtered.map((d, i) => {
              const isSel = value && String(value) === String(d.id);
              const archived = isArchivedDriver(d);
              const phone = primaryPhone(d);
              return (
                <button
                  key={String(d.id)}
                  type="button"
                  role="option"
                  aria-selected={!!isSel}
                  data-ui={`${dataUi}-option`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(d);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs transition cursor-pointer ${
                    i === activeIdx ? 'bg-slate-100' : 'hover:bg-slate-100'
                  } ${isSel ? 'text-slate-900 font-semibold bg-slate-50' : 'text-slate-700 font-medium'}`}
                >
                  <span className="min-w-0 flex-1 truncate" title={driverFullName(d)}>{driverFullName(d)}</span>
                  {archived ? (
                    <span className="shrink-0 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                      архив
                    </span>
                  ) : null}
                  {phone ? (
                    <span className="shrink-0 font-mono text-[10px] font-normal text-slate-400">{phone}</span>
                  ) : null}
                  {isSel ? <Check className="w-3.5 h-3.5 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" /> : null}
                </button>
              );
            })
          )}

          {allowCreate && query.trim().length >= 2 && !exactMatch ? (
            <button
              type="button"
              data-ui={`${dataUi}-create`}
              disabled={creating}
              onMouseDown={(e) => {
                e.preventDefault();
                void createDriver();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent-10)] hover:bg-[var(--accent-20)] transition cursor-pointer border-t border-slate-100 disabled:opacity-60"
            >
              {creating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">Добавить в справочник: «{query.trim()}»</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
