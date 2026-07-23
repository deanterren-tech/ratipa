import {useState, useRef, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {Search, Truck, X, MapPin} from 'lucide-react'
import {dbService} from '../../api'
import {getCouplings} from '../../services/fleetService'
import {formatDriverShortName} from '../../utils/driverSync'

interface CouplingPickerProps {
  value?: string;            // selected coupling id (or raw string for combined)
  onSelect: (rec: any) => void;
  placeholder?: string;
  excludeIds?: string[];
  mode?: 'coupling' | 'driver' | 'combined';  // 'combined': couplings + locations in one field
  locations?: string[];      // for mode='combined' — list of locations (e.g. offices, borders)
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
export default function CouplingPicker({ value, onSelect, placeholder, excludeIds = [], mode = 'coupling', locations = [] }: CouplingPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [all, setAll] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ЕДИНАЯ БАЗА: сцепки (авто+прицеп+водитель+диспетчер) из fleetService
    const unsub = getCouplings((list: any[]) => setAll(list || []));
    return unsub;
  }, []);

  useEffect(() => {
    if (value && all.length) {
      const found = all.find((c) => c.id === value)
        || all.find((c) => {
            const v = (value || '').toUpperCase().replace(/\s+/g, '').replace(/\//g, '');
            const car = (c.carNumber || c.vehicleNumbers || '').toUpperCase().replace(/\s+/g, '').replace(/\//g, '');
            return v === car || v.startsWith(car) || car.startsWith(v);
          });
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
      return all.filter((c) => !excludeIds.includes(c.id)).slice(0, 8);
    }
    const q = norm(query);
    return all
      .filter((c) => !excludeIds.includes(c.id))
      .filter((c) => {
        if (!q) return true;
        const hay = mode === 'driver'
          ? [c.driverNameRu || c.driverName || c.driverShortNameRu || ''].join(' ').toLowerCase().replace(/\s+/g, '')
          : [
              c.carNumber || c.vehicleNumbers || '',
              c.trailerNumber || c.trailerMake || '',
              c.driverNameRu || c.driverName || c.driverShortNameRu || '',
              c.brandModel || c.brands || '',
            ].join(' ').toLowerCase().replace(/\s+/g, '');
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
      const label = rec.carNumber || rec.vehicleNumbers || '';
      const trail = rec.trailerNumber || rec.trailerMake || '';
      setQuery(trail ? `${label} / ${trail}` : label);
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
      return formatDriverShortName(rec.driverNameRu || rec.driverName || '') || 'нет водителя';
    }
    const car = rec.carNumber || rec.vehicleNumbers || '';
    const trail = rec.trailerNumber || rec.trailerMake || '';
    return trail ? `${car} / ${trail}` : car;
  };
  const displaySub = (rec: any) => {
    if (mode === 'driver') {
      const car = (rec.carNumber || rec.vehicleNumbers) + (rec.trailerNumber ? ` + ${rec.trailerNumber}` : '');
      return [car, rec.brandModel].filter(Boolean).join(' · ');
    }
    if (mode === 'combined') return rec.brandModel || '';
    return [
      formatDriverShortName(rec.driverNameRu || rec.driverName || '') || 'нет водителя',
      rec.brandModel,
    ].filter(Boolean).join(' · ');
  };

  return (
    <div className="relative" ref={boxRef}>
      {selected && !open && mode !== 'combined' ? (
        <div className="flex items-center justify-between gap-2 bg-[#3765F6]/5 border border-[#3765F6]/20 rounded-xl px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#3765F6] font-mono truncate">{displayLabel(selected)}</div>
            <div className="text-[10px] text-slate-500 truncate">{displaySub(selected)}</div>
          </div>
          <button onClick={() => { setSelected(null); onSelect(null); }} className="text-slate-400 hover:text-rose-500 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={mode === 'combined' ? query : (selected ? displayLabel(selected) : query)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onClick={() => setOpen(true)}
            placeholder={ph}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-[#3765F6] bg-white"
          />
        </div>
      )}
      {open && coords && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 99999 }}
          className="max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl"
        >
          {couplingsFiltered.length === 0 && locFiltered.length === 0 && (
            <div className="p-3 text-center text-xs text-slate-400">Не найдено</div>
          )}
          {couplingsFiltered.map((rec) => (
            <button
              key={rec.id}
              onClick={() => handlePick(rec)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
            >
              <Truck className="w-4 h-4 text-[#3765F6] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 font-mono truncate">{displayLabel(rec)}</div>
                <div className="text-[10px] text-slate-500 truncate">{displaySub(rec)}</div>
              </div>
            </button>
          ))}
          {locFiltered.length > 0 && (
            <div className="px-3 py-1 text-[9px] font-black uppercase text-slate-400 bg-slate-50">Локации</div>
          )}
          {locFiltered.map((loc) => (
            <button
              key={'loc-' + loc}
              onClick={() => handlePickLoc(loc)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
            >
              <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 truncate">{loc}</div>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
