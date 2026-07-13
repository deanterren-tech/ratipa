import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Truck, User, X } from 'lucide-react';
import { dbService } from '../../firebase';
import { formatDriverShortName } from '../../utils/driverSync';

interface CouplingPickerProps {
  value?: string;            // selected coupling id
  onSelect: (rec: any) => void;
  placeholder?: string;
  excludeIds?: string[];
}

/**
 * Reusable coupling (tractor+trailer) picker.
 * Reads from the single source of truth (vehicleFleet via dbService.getVehicleDriverData).
 * On select, returns the full coupling record so callers can auto-fill driver, brand, etc.
 */
export default function CouplingPicker({ value, onSelect, placeholder = 'Поиск сцепки (тягач / прицеп / водитель)...', excludeIds = [] }: CouplingPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = dbService.getVehicleDriverData((list: any[]) => setAll(list || []));
    return unsub;
  }, []);

  useEffect(() => {
    if (value && all.length) {
      const found = all.find((c) => c.id === value);
      if (found) setSelected(found);
    }
  }, [value, all]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '');
    return all
      .filter((c) => !excludeIds.includes(c.id))
      .filter((c) => {
        if (!q) return true;
        const hay = [
          c.carNumber || c.vehicleNumbers || '',
          c.trailerNumber || c.trailerMake || '',
          c.driverNameRu || c.driverName || c.driverShortNameRu || '',
          c.brandModel || c.brands || '',
        ].join(' ').toLowerCase().replace(/\s+/g, '');
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [query, all, excludeIds]);

  const handlePick = (rec: any) => {
    setSelected(rec);
    setQuery('');
    setOpen(false);
    onSelect(rec);
  };

  return (
    <div className="relative" ref={boxRef}>
      {selected && !open ? (
        <div className="flex items-center justify-between gap-2 bg-[#3765F6]/5 border border-[#3765F6]/20 rounded-xl px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#3765F6] font-mono truncate">
              {selected.carNumber || selected.vehicleNumbers}
              {selected.trailerNumber ? ` + ${selected.trailerNumber}` : ''}
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              {formatDriverShortName(selected.driverNameRu || selected.driverName || '') || 'нет водителя'}
              {selected.brandModel ? ` · ${selected.brandModel}` : ''}
            </div>
          </div>
          <button onClick={() => { setSelected(null); onSelect(null); }} className="text-slate-400 hover:text-rose-500 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-[#3765F6] bg-white"
          />
          {open && (
            <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
              {filtered.length === 0 && (
                <div className="p-3 text-center text-xs text-slate-400">Не найдено</div>
              )}
              {filtered.map((rec) => (
                <button
                  key={rec.id}
                  onClick={() => handlePick(rec)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
                >
                  <Truck className="w-4 h-4 text-[#3765F6] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-800 font-mono truncate">
                      {rec.carNumber || rec.vehicleNumbers}
                      {rec.trailerNumber ? ` + ${rec.trailerNumber}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {formatDriverShortName(rec.driverNameRu || rec.driverName || '') || 'нет водителя'}
                      {rec.brandModel ? ` · ${rec.brandModel}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
