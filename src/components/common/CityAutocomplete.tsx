import {useState, useRef, useEffect, useMemo} from 'react'
import {ModalShell} from '../../ui/components'
import {UI} from '../../ui/kit'
import {useToast} from '../ToastProvider'
import {subscribeCities, addCity, findCityByName, type CityRecord} from '../../firebase/citiesService'
import {CITY_KINDS, findSimilarCities, isShortPlaceText, normalizeCityName, type CityKind} from '../../utils/cityDirectory'

/**
 * Поле города с автодополнением (CityInput).
 *
 * Подсказки — из справочника городов (`cities`: name + aliases, без учёта
 * регистра и ё, с транслит- и Левенштейн-терпимостью) и из СТАРОГО списка
 * `cities` (строки, например известные расстояния) — старые вызовы работают
 * как раньше. Если введённого значения нет в справочнике и оно похоже на
 * название места — диалог «Города «X» нет в базе. Добавить?»: сначала похожие
 * варианты из справочника, затем «Добавить» (страна, тип; source: 'user',
 * author, createdAt) или «Выбрать из списка». Без подтверждения ничего не
 * сохраняется и не подставляется. Старые текстовые значения НЕ ломаются:
 * поле остаётся свободным вводом.
 */
interface CityAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  /** Старые подсказки строками (совместимость): известные расстояния и т.п. */
  cities: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Текущий пользователь — автор при добавлении города (напр. user.name). */
  author?: string;
  /** Роль автора для журнала действий. */
  authorRole?: string;
  /** Разрешить добавление новых городов (по умолчанию true, если есть author). */
  allowCreate?: boolean;
}

interface SuggestionEntry {
  name: string;
  aliases: string[];
  city?: CityRecord;
}

const REASON_LABEL: Record<string, string> = {
  exact: 'точное совпадение',
  prefix: 'совпадает с начала',
  substring: 'встречается в названии',
  similar: 'похожее написание',
};

export default function CityAutocomplete({
  value,
  onChange,
  onBlur,
  cities,
  placeholder,
  disabled,
  className = '',
  author,
  authorRole,
  allowCreate = true,
}: CityAutocompleteProps) {
  const {toast} = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [coords, setCoords] = useState<{top: number; left: number; width: number} | null>(null);
  const [dirCities, setDirCities] = useState<CityRecord[]>([]);
  const [dialog, setDialog] = useState<null | {value: string; step: 'ask' | 'add'}>(null);
  const [showAll, setShowAll] = useState(false);
  const [country, setCountry] = useState('');
  const [cityType, setCityType] = useState<CityKind>('город');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Значение, которое пользователь отредактировал сам (а не подстановка). */
  const touchedRef = useRef(false);
  /** Выбор из подсказок только что сделан — диалог не показываем. */
  const justSelectedRef = useRef(false);
  /** Значение, для которого диалог уже отклонён — повторно не спрашиваем. */
  const dismissedRef = useRef<string | null>(null);

  // Справочник городов — общая подписка сервиса (кэш на всех)
  useEffect(() => {
    const unsub = subscribeCities((list) => setDirCities(list));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        listRef.current && !listRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Подсказки: справочник (города+алиасы) + старые строки `cities`. */
  const entries = useMemo<SuggestionEntry[]>(() => {
    const out: SuggestionEntry[] = [];
    const seen = new Set<string>();
    dirCities.forEach((c) => {
      const norm = normalizeCityName(c.name);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      out.push({name: c.name, aliases: c.aliases || [], city: c});
    });
    (cities || []).forEach((s) => {
      const norm = normalizeCityName(s);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      out.push({name: s, aliases: []});
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [dirCities, cities]);

  const rankOf = (e: SuggestionEntry): number[] => [e.city?.usageCount || 0, e.city?.population || 0];

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q || showAll) {
      // полный список — тоже по рангу (чаще используемые и крупные выше)
      return [...entries]
        .sort((a, b) => {
          const ra = rankOf(a), rb = rankOf(b);
          return rb[0] - ra[0] || rb[1] - ra[1] || a.name.localeCompare(b.name, 'ru');
        })
        .slice(0, 80);
    }
    return findSimilarCities(q, entries, 60, rankOf).map((s) => s.entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, showAll]);

  /** Нормализованные формы всех подсказок (справочник + старые строки). */
  const knownForms = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      [e.name, ...e.aliases].forEach((v) => {
        const n = normalizeCityName(v);
        if (n) set.add(n);
      });
    });
    return set;
  }, [entries]);

  /** Значение уже есть среди подсказок (справочник cities или старый список)? */
  const knownInDirectory = (v: string): boolean => {
    const norm = normalizeCityName(v);
    if (!norm) return false;
    // точное совпадение с формой из справочника/списка — «известное» значение
    if (knownForms.has(norm)) return true;
    // записи справочника, догруженные живьём (на случай рассинхрона кэша)
    return findCityByName(v, dirCities) !== null;
  };

  const updateCoords = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setCoords({top: rect.bottom + 4, left: rect.left, width: rect.width});
    }
  };

  const handleOpen = () => {
    updateCoords();
    setOpen(true);
  };

  const handleSelect = (entry: SuggestionEntry) => {
    justSelectedRef.current = true;
    touchedRef.current = false;
    setQuery(entry.name);
    onChange(entry.name);
    setOpen(false);
    setShowAll(false);
    setDialog(null);
    inputRef.current?.focus();
  };

  /** После потери фокуса: спросить о добавлении, если значение новое. */
  const maybeAskToAdd = () => {
    const v = query.trim();
    const wasTouched = touchedRef.current;
    touchedRef.current = false;
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    if (disabled || !allowCreate || !author) return;
    if (!v || v.length < 2) return;
    if (dismissedRef.current === v) return;
    if (knownInDirectory(v)) return;
    if (!isShortPlaceText(v)) return; // не похоже на место — не спрашиваем
    if (!wasTouched) return; // старые значения не трогаем без правки
    setDialog({value: v, step: 'ask'});
  };

  const similar = useMemo(
    () => (dialog ? findSimilarCities(dialog.value, entries, 5) : []),
    [dialog, entries],
  );

  const closeDialog = () => {
    if (dialog) dismissedRef.current = dialog.value;
    setDialog(null);
    setSaving(false);
  };

  const pickFromList = () => {
    if (dialog) dismissedRef.current = dialog.value;
    setDialog(null);
    updateCoords();
    setShowAll(true);
    setOpen(true);
    inputRef.current?.focus();
  };

  const saveNewCity = () => {
    if (!dialog || saving) return;
    if (!author) {
      toast('Нет автора записи — войдите заново', 'error');
      return;
    }
    setSaving(true);
    const res = addCity({name: dialog.value, country, type: cityType}, author, authorRole || 'dispatcher');
    if (!res.ok || !res.city) {
      setSaving(false);
      toast(res.error || 'Не удалось сохранить город', 'error');
      return;
    }
    const saved = res.city;
    toast(res.existed ? `Город уже есть в справочнике: ${saved.name}` : `Город «${saved.name}» добавлен`, 'success');
    justSelectedRef.current = true;
    touchedRef.current = false;
    setQuery(saved.name);
    onChange(saved.name);
    setDialog(null);
    setSaving(false);
    inputRef.current?.focus();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        data-ui="city-input"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          touchedRef.current = true;
          dismissedRef.current = null;
          setShowAll(false);
          setOpen(true);
          setTimeout(updateCoords, 0);
        }}
        onFocus={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            if (onBlur) onBlur();
            maybeAskToAdd();
          }, 200);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && coords && (
        <div
          ref={listRef}
          data-ac-popup="1"
          className="fixed z-[99999] bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto custom-scrollbar"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
        >
          {filtered.map((entry) => (
            <button
              key={entry.name}
              type="button"
              data-ui="city-suggestion"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(entry);
              }}
              className={`w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer ${
                entry.name === value ? 'bg-slate-50 text-slate-900' : ''
              }`}
            >
              <span>{entry.name}</span>
              {entry.city && (entry.city.country || entry.aliases.length > 0) ? (
                <span className="ml-1.5 font-normal text-[10px] text-slate-400">
                  {[entry.city.country, entry.aliases.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <ModalShell
        isOpen={!!dialog}
        onClose={closeDialog}
        title={dialog?.step === 'add' ? `Новый город: ${dialog.value}` : `Города «${dialog?.value || ''}» нет в базе`}
        subtitle={dialog?.step === 'add'
          ? 'Проверьте похожие — возможно, этот город уже есть в справочнике.'
          : 'Добавить его в справочник? Сначала посмотрите похожие варианты.'}
        ariaLabel="Города нет в базе — добавить?"
        maxWidth="max-w-md"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2" data-ui="city-add-dialog">
            <button type="button" onClick={closeDialog} className={UI.buttonGhost} data-ui="city-add-cancel">
              Отмена
            </button>
            {dialog?.step === 'ask' ? (
              <>
                <button type="button" onClick={pickFromList} className={UI.buttonGhost} data-ui="city-pick-from-list">
                  Выбрать из списка
                </button>
                <button
                  type="button"
                  onClick={() => setDialog(dialog ? {...dialog, step: 'add'} : dialog)}
                  className={UI.buttonPrimary}
                  data-ui="city-add-confirm"
                >
                  Добавить
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={saveNewCity}
                disabled={saving}
                className={UI.buttonPrimary}
                data-ui="city-add-save"
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {similar.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={UI.fieldLabel}>Похожие в справочнике</span>
              {similar.map((s) => (
                <button
                  key={s.entry.name}
                  type="button"
                  data-ui="city-similar"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(s.entry);
                  }}
                  className="flex items-center justify-between gap-2 w-full text-left px-3 py-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors cursor-pointer"
                >
                  <span className="text-xs font-semibold text-[#121316]">{s.entry.name}</span>
                  <span className="text-[10px] text-[#6B7280]">{REASON_LABEL[s.reason] || 'похожее'}</span>
                </button>
              ))}
            </div>
          )}
          {similar.length === 0 && dialog?.step === 'ask' && (
            <p className={UI.hint}>Похожих записей в справочнике нет.</p>
          )}
          {dialog?.step === 'add' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={UI.fieldLabel}>Страна *</span>
                <input
                  type="text"
                  value={country}
                  data-ui="city-add-country"
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="BY, RU, TR… или название"
                  className={UI.input}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={UI.fieldLabel}>Тип</span>
                <select
                  value={cityType}
                  data-ui="city-add-type"
                  onChange={(e) => setCityType(e.target.value as CityKind)}
                  className={UI.input}
                >
                  {CITY_KINDS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <p className={UI.hint}>
                Сохранится в справочник городов от имени «{author || '—'}» (source: user).
              </p>
            </>
          )}
        </div>
      </ModalShell>
    </>
  );
}
