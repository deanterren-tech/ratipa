import {useState, useRef, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {Search, Truck, X, MapPin, Check} from 'lucide-react'
import {dbService} from '../../api'
import {getCouplingsFlat} from '../../services/fleetService'
import {formatDriverShortName} from '../../utils/driverSync'
import {formatCoupling} from '../../utils/salaryAutofill'

interface CouplingPickerProps {
  value?: string;            // selected coupling id (or raw string for combined)
  onSelect: (rec: any) => void;
  placeholder?: string;
  excludeIds?: string[];
  mode?: 'coupling' | 'driver' | 'combined';  // 'combined': couplings + locations in one field
  locations?: string[];      // for mode='combined' — list of locations (e.g. offices, borders)
  /**
   * Компактная типографика для ячеек таблицы: поле встаёт в ритм строки
   * (та же высота и кегль, что у «Примечания» и «Даты выдачи»), поэтому номер
   * автомобиля не выглядит крупнее остальных данных строки.
   * По умолчанию — обычная форма.
   */
  compact?: boolean;
}

/**
 * Reusable coupling (tractor+trailer) picker.
 * Reads from the single source of truth (vehicleFleet via dbService.getVehicleDriverData).
 * On select, returns the full coupling record so callers can auto-fill driver, brand, etc.
 * mode="driver"  — search by driver name (returns full coupling rec).
 * mode="combined" — single field that suggests BOTH locations and couplings (Дозволы: Авто/Локация).
 *
 * The dropdown is rendered via a portal to document.body with position:fixed and a very high
 * z-index so it is never clipped or overlapped by sibling sections (cards, tables, etc.).
 */
export default function CouplingPicker({ value, onSelect, placeholder, excludeIds = [], mode = 'coupling', locations = [], compact = false }: CouplingPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [all, setAll] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ЕДИНАЯ БАЗА: плоский список сцепок (совместимый с вызывающим кодом)
    const unsub = getCouplingsFlat((list: any[]) => setAll(list || []));
    return unsub;
  }, []);

  useEffect(() => {
    if (value) {
      const found = all.length > 0 ? (
        all.find((c) => c.id === value)
        || all.find((c) => {
            const v = (value || '').toUpperCase().replace(/\s+/g, '').replace(/\//g, '');
            const car = (c.carNumber || c.vehicleNumbers || '').toUpperCase().replace(/\s+/g, '').replace(/\//g, '');
            return v === car || v.startsWith(car) || car.startsWith(v);
          })
      ) : null;
      if (found) {
        setSelected(found);
        if (mode === 'combined') {
          const label = found.carNumber || found.vehicleNumbers || '';
          const trail = found.trailerNumber || found.trailerMake || '';
          setQuery(trail ? `${label} / ${trail}` : label);
        }
      } else if (mode === 'combined' && locations.indexOf(value) !== -1) {
        setSelected({ carNumber: value, isLocation: true });
        setQuery(value);
      } else {
        // Fallback: show the raw value as text even if no match in DB
        setSelected({ carNumber: value, vehicleNumbers: value, id: value });
      }
    }
    // NOTE: intentionally NOT depending on `locations` (it's a fresh array each render)
    // to avoid an infinite render/setQuery loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, all, mode]);

  // Position the portal dropdown under the input whenever it opens
  useEffect(() => {
    if (open && boxRef.current) {
      const r = boxRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    } else {
      setCoords(null);
    }
  }, [open]);

  // Close on outside click (input box OR portal list) and on page scroll/resize
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current && boxRef.current.contains(t)) return;
      if (listRef.current && listRef.current.contains(t)) return;
      setOpen(false);
    };
    const onScrollResize = (e: Event) => {
      if (listRef.current && listRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      window.addEventListener('scroll', onScrollResize, true);
      window.addEventListener('resize', onScrollResize);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open]);

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

  const couplingsFiltered = useMemo(() => {
    if (mode === 'combined' && !query.trim()) {
      return all.filter((c) => !excludeIds.includes(c.couplingId || c.id)).slice(0, 8);
    }
    const q = norm(query);
    return all
      .filter((c) => !excludeIds.includes(c.couplingId || c.id))
      .filter((c) => {
        if (!q) return true;
        const car = c.carNumber || c.tractor?.carNumber || '';
        const trail = c.trailerNumber || c.trailer?.trailerNumber || '';
        const drv = c.driverName || c.driverNameRu || c.driver?.shortNameRu || c.driver?.name || '';
        const brand = c.brandModel || c.brand || c.tractor?.brandModel || c.tractor?.brandsRu || c.tractor?.brand || '';
        const hay = mode === 'driver'
          ? drv.toLowerCase().replace(/\s+/g, '')
          : [car, trail, drv, brand].join(' ').toLowerCase().replace(/\s+/g, '');
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [query, all, excludeIds, mode]);

  const locFiltered = useMemo(() => {
    if (mode !== 'combined') return [];
    const q = norm(query);
    if (!q) return locations.slice(0, 8);
    return locations
      .filter((l) => norm(l).includes(q))
      .slice(0, 8);
  }, [locations, mode, query]);

  const handlePick = (rec: any) => {
    setSelected(rec);
    if (mode === 'combined') {
      const label = rec.carNumber || rec.tractor?.carNumber || rec.couplingId || '';
      const trail = rec.trailerNumber || rec.trailer?.trailerNumber || '';
      setQuery(formatCoupling(trail ? `${label} / ${trail}` : label));
    } else {
      setQuery('');
    }
    setOpen(false);
    onSelect(rec);
  };
  const handlePickLoc = (loc: string) => {
    const rec = { carNumber: loc, isLocation: true };
    setSelected(rec);
    setQuery(loc);
    setOpen(false);
    onSelect(rec);
  };

  const ph = placeholder
    || (mode === 'driver' ? 'Поиск водителя (по базе сцепок)...'
      : mode === 'combined' ? 'Авто (из базы) или локация...'
      : 'Поиск сцепки (тягач / прицеп / водитель)...');

  const displayLabel = (rec: any) => {
    if (mode === 'driver') {
      return formatDriverShortName(rec.driverName || rec.driverNameRu || rec.driver?.shortNameRu || rec.driver?.name || '') || 'нет водителя';
    }
    const car = rec.carNumber || rec.tractor?.carNumber || rec.couplingId || '';
    const trail = rec.trailerNumber || rec.trailer?.trailerNumber || '';
    return formatCoupling(trail ? `${car} / ${trail}` : car);
  };
  const displaySub = (rec: any) => {
    const car = rec.carNumber || rec.tractor?.carNumber || '';
    const trail = rec.trailerNumber || rec.trailer?.trailerNumber || '';
    const brand = rec.brandModel || rec.brand || rec.tractor?.brandModel || rec.tractor?.brandsRu || rec.tractor?.brand || '';
    if (mode === 'driver') {
      return [car + (trail ? ` + ${trail}` : ''), brand].filter(Boolean).join(' · ');
    }
    if (mode === 'combined') return brand || '';
    return [
      formatDriverShortName(rec.driverName || rec.driverNameRu || rec.driver?.shortNameRu || rec.driver?.name || '') || 'нет водителя',
      brand,
    ].filter(Boolean).join(' · ');
  };

  /* Текст в поле: выбранная машина — как значение поля, ровно та же высота и рамка,
     что и при пустом поле. Пока список открыт, в поле — запрос поиска. */
  const fieldText = open ? query : (selected && mode !== 'combined' ? displayLabel(selected) : query);
  const fullValue = selected && mode !== 'combined' ? [displayLabel(selected), displaySub(selected)].filter(Boolean).join(' · ') : '';
  const hasValue = !open && (!!selected || !!query.trim());

  const clearSelection = () => {
    setSelected(null);
    setQuery('');
    setOpen(false);
    onSelect(null);
  };

  const pickSame = (rec: any) => (
    (selected?.id && (rec.id === selected.id || rec.couplingId === selected.id))
    || displayLabel(rec) === displayLabel(selected || {})
  );

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        {/* В компактном режиме иконку поиска не дублируем: в ячейке таблицы
            слева уже стоит Truck/MapPin, два знака подряд создавали шум. */}
        {!compact && <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />}
        <input
          value={fieldText}
          title={fullValue || undefined}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onClick={() => { if (selected && mode !== 'combined') setQuery(''); setOpen(true); }}
          onFocus={() => { if (selected && mode !== 'combined') setQuery(''); }}
          placeholder={ph}
          aria-label={ph}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={`${compact
            ? "w-full h-8 px-2.5 text-xs font-medium text-[#121316]"
            : "w-full h-9 pl-9 text-xs"} ${hasValue ? 'pr-8' : compact ? 'pr-2.5' : 'pr-3'} truncate text-ellipsis bg-white border border-[#E5E7EB] outline-none transition-colors placeholder:text-[#9CA3AF] placeholder:font-normal hover:border-[#D1D5DB] ${compact ? 'rounded-lg focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)]' : 'rounded-xl focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]'}`}
        />
        {hasValue && (
          <button
            type="button"
            onClick={clearSelection}
            title="Очистить выбор"
            aria-label="Очистить выбор автомобиля"
            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-rose-500 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && coords && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 99999 }}
          className={compact
            ? "max-h-72 overflow-y-auto bg-white border border-[#E5E7EB] rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.10)]"
            : "max-h-80 overflow-y-auto bg-white border border-[#E5E7EB] rounded-xl shadow-[0_6px_20px_rgba(15,23,42,0.10)]"}
        >
          {couplingsFiltered.length === 0 && locFiltered.length === 0 && (
            <div className={compact ? "p-3 text-center text-[11px] text-[#9CA3AF]" : "p-3 text-center text-xs text-[#9CA3AF]"}>Не найдено</div>
          )}
          {couplingsFiltered.map((rec) => {
            const isCurrent = pickSame(rec);
            return (
              <button
                key={rec.id}
                onClick={() => handlePick(rec)}
                aria-selected={isCurrent}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b last:border-0 border-[#F3F4F6] ${isCurrent ? 'bg-[var(--accent-5)]' : 'hover:bg-[#F9FAFB]'}`}
              >
                <Truck className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-[var(--accent-ui)]' : compact ? 'text-[#9CA3AF]' : 'text-[var(--accent-ink)]'}`} />
                <div className="min-w-0 flex-1">
                  <div className={compact ? "text-xs font-medium text-[#121316] truncate" : "text-xs font-semibold text-[#121316] font-mono truncate"}>{displayLabel(rec)}</div>
                  <div className="text-[10px] text-[#6B7280] truncate">{displaySub(rec)}</div>
                </div>
                {isCurrent && <Check className="w-4 h-4 shrink-0 text-[var(--accent-ui)]" />}
              </button>
            );
          })}
          {mode === 'coupling' && query.trim() && !couplingsFiltered.some((c) => {
            const car = (c.carNumber || c.vehicleNumbers || '').toUpperCase().replace(/\s+/g, '');
            return car === query.trim().toUpperCase().replace(/\s+/g, '');
          }) && (
            <button
              key="__new__"
              onClick={() => handlePick({ carNumber: query.trim().toUpperCase(), vehicleNumbers: query.trim().toUpperCase(), isNew: true })}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--accent-5)] text-left border-t border-[#E5E7EB] bg-[#F9FAFB]"
            >
              <Truck className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={compact ? "text-xs font-medium text-emerald-700 truncate" : "text-xs font-bold text-emerald-600 font-mono truncate"}>+ Добавить: {query.trim().toUpperCase()}</div>
                <div className={compact ? "text-[10px] text-[#6B7280] truncate" : "text-[10px] text-[#6B7280] truncate"}>новый автомобиль (не из базы сцепок)</div>
              </div>
            </button>
          )}
          {locFiltered.length > 0 && (
            <div className={compact ? "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] bg-[#F9FAFB]" : "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] bg-[#F9FAFB]"}>Локации</div>
          )}
          {locFiltered.map((loc) => (
            <button
              key={'loc-' + loc}
              onClick={() => handlePickLoc(loc)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b last:border-0 ${compact ? "hover:bg-[#F9FAFB] border-[#F3F4F6]" : "hover:bg-[#F9FAFB] border-[#F3F4F6]"}`}
            >
              <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={compact ? "text-xs font-medium text-[#121316] truncate" : "text-xs font-semibold text-[#121316] truncate"}>{loc}</div>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
