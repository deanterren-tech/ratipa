import {useState, useEffect, useMemo, useRef} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {dbService, directoryService} from '../../api'
import {getCouplingsFlat, getDriversFlat, getDispatchersFlat} from '../../services/fleetService'
import {Truck, Plus, Trash2, Pencil, Link2, Check, Layers, Tag, Users} from 'lucide-react'
import {UserProfile} from '../../types'
import {normalizePlate, formatPlate} from '../../utils/salaryAutofill'
import CouplingCard from './CouplingCard';
import DriverCard from './DriverCard';
import {UI} from '../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../ui/components'

// Дефолтные характеристики ТС (присваиваются каждому авто, пользователь может менять)
const DEFAULT_VEHICLE = {
  vehicleType: 'Тенты 90м3',
  dimensions: '13,6м x 2,45м x 2,7м',
  weight: '14,6т',
};

interface CouplingDirectoryEditorProps {
  user: UserProfile;
  isWritePermitted: boolean;
}

interface CouplingRow {
  id: string;
  carNumber: string;
  trailerNumber?: string;
  brand?: string;
  trailerBrand?: string;
  brandRu?: string;
  vehicleType?: string;
  dimensions?: string;
  weight?: string;
  driverId?: string;
  driverName?: string;
  driver2?: string;
  dispatcher?: string;
  rateGroupId?: string;
  status?: string;
}

// dispatcher color palette (stable per dispatcher)
const DISP_COLORS: Record<string, string> = {
  виталий: '#0EA5E9', матвей: '#8B5CF6', сергей: '#F59E0B', юрий: '#10B981',
};
const dispColor = (key?: string) => DISP_COLORS[(key || '').toLowerCase()] || '#9CA3AF';

function useLockBodyScroll(open: boolean) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      document.querySelectorAll('main, .overflow-y-auto').forEach((el) => {
        (el as HTMLElement).style.overflow = 'hidden';
      });
    } else {
      document.body.style.overflow = '';
      document.querySelectorAll('main, .overflow-y-auto').forEach((el) => {
        (el as HTMLElement).style.overflow = '';
      });
    }
    return () => {
      document.body.style.overflow = '';
      document.querySelectorAll('main, .overflow-y-auto').forEach((el) => {
        (el as HTMLElement).style.overflow = '';
      });
    };
  }, [open]);
}

export default function CouplingDirectoryEditor({ user, isWritePermitted }: CouplingDirectoryEditorProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [couplings, setCouplings] = useState<CouplingRow[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [dispatchers, setDispatchers] = useState<any[]>([]);
  const [rateGroups, setRateGroups] = useState<any[]>([]);
  const [vehicleBrands, setVehicleBrands] = useState<any[]>([]);
  const [trailerBrands, setTrailerBrands] = useState<any[]>([]);
  const [tractors, setTractors] = useState<any[]>([]);
  const [statusTypes, setStatusTypes] = useState<any[]>([]);
  // Номера авто из «Учёта выезда» (baza) для статуса «На базе / В рейса»
  const [bazaCars, setBazaCars] = useState<string[]>([]);
  const savedMapRef = useRef<Record<string, any>>({});

  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const [activeDisp, setActiveDisp] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  useLockBodyScroll(modalOpen);
  const [editing, setEditing] = useState<CouplingRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [viewCard, setViewCard] = useState<{ type: 'coupling' | 'driver'; carNumber?: string; driverId?: string; driverName?: string; record?: any } | null>(null);

  // multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<'rateGroupId' | 'dispatcher' | null>(null);

  useEffect(() => {
    const u1 = getCouplingsFlat((list: any[]) => {
      setCouplings((list || []).map((c) => {
        const saved = savedMapRef.current[c.id];
        return {
          id: c.id,
          carNumber: c.carNumber || c.vehicleNumbers || '',
          trailerNumber: saved?.trailerNumber || c.trailerNumber || '',
          brand: saved?.brand || c.brand || c.brandModel || '',
          trailerBrand: saved?.trailerBrand || c.trailerBrand || c.trailerMake || '',
          brandRu: c.brandRu || '',
          vehicleType: c.vehicleType || '',
          dimensions: c.dimensions || '',
          weight: c.weight || '',
          driverId: c.driverId || '',
          driverName: c.driverNameRu || c.driverName || c.driverShortNameRu || '',
          driver2: c.driver2 || '',
          dispatcher: c.dispatcher || '',
          rateGroupId: c.rateGroupId || '',
          status: c.status || 'base',
        };
      }));
    });
    const u2 = getDriversFlat((l: any[]) => setDrivers(l || []));
    const u3 = getDispatchersFlat((l: any[]) => setDispatchers(l || []));
    const u4 = directoryService.getRateGroups((l: any[]) => setRateGroups(l || []));
    const u5 = directoryService.getVehicleBrands((l: any[]) => setVehicleBrands(l || []));
    const u6 = directoryService.getTrailerBrands((l: any[]) => setTrailerBrands(l || []));
    const u7 = directoryService.getStatusTypes((l: any[]) => setStatusTypes(l || []));
    const u8 = dbService.getTractors((l: any[]) => setTractors(l || []));
    // Подписка на «Учёт выезда» (baza) для статуса «На базе / В рейса»
    const u9 = (dbService as any).getBazaRecords
      ? (dbService as any).getBazaRecords((list: any[]) => {
          const plates = (list || []).map((c: any) => normalizePlate(c.carNumber || c.vehicleNumbers || '')).filter(Boolean);
          setBazaCars(plates);
        })
      : () => {};
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u9(); };
  }, []);

  const driverName = (id?: string) => {
    const d = drivers.find((x) => x.id === id);
    return d ? (d.shortNameRu || d.name || d.firstNameRu || '') : '';
  };
  const dispName = (id?: string) => {
    const d = dispatchers.find((x) => (x.id || x.key) === id);
    return d ? d.name : (id || '—');
  };
  // Обратный маппинг: имя диспетчера → его id (для корректного выбора в SelectField)
  const dispIdByName = (name?: string) => {
    const d = dispatchers.find((x) => x.name === name);
    return d ? (d.id || d.key) : (name || '');
  };
  const rateName = (id?: string) => {
    const g = rateGroups.find((x) => (x.id || x.key) === id);
    return g ? `${g.name} (€${g.rate}/км)` : '—';
  };
  const statusLabel = (id?: string) => {
    const s = statusTypes.find((x) => (x.id || x.key) === id);
    return s ? s.label : (id || 'base');
  };
  const statusColor = (id?: string) => {
    const s = statusTypes.find((x) => (x.id || x.key) === id);
    return s?.color || '#94a3b8';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, '');
    return couplings.filter((c) => {
      if (activeDisp !== 'all' && (c.dispatcher || '') !== activeDisp) return false;
      if (!q) return true;
      return [c.carNumber, c.trailerNumber, c.driverName, driverName(c.driverId), dispName(c.dispatcher)]
        .join(' ').toLowerCase().replace(/\s+/g, '').includes(q);
    });
  }, [search, couplings, drivers, dispatchers, activeDisp]);

  // Вкладки диспетчеров: уникальные имена из самих записей (как колонка «Диспетчер»)
  // + имена из справочника (чтобы показывать всех зарегистрированных, даже с 0 записей).
  const dispTabs = useMemo(() => {
    const set = new Set<string>();
    couplings.forEach((c) => { if (c.dispatcher) set.add(c.dispatcher); });
    dispatchers.forEach((d) => { if (d.name) set.add(d.name); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [couplings, dispatchers]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      carNumber: '', trailerNumber: '', brand: '', trailerBrand: '', brandRu: '',
      vehicleType: DEFAULT_VEHICLE.vehicleType, dimensions: DEFAULT_VEHICLE.dimensions, weight: DEFAULT_VEHICLE.weight,
      driverId: '', driver2: '',
      dispatcher: '', rateGroupId: '', status: 'base',
    });
    setModalOpen(true);
  };
  const openEdit = (c: CouplingRow) => {
    setEditing(c);
    setForm({
      carNumber: c.carNumber, trailerNumber: c.trailerNumber || '', brand: c.brand || '',
      trailerBrand: c.trailerBrand || '', brandRu: c.brandRu || '', vehicleType: c.vehicleType || '',
      dimensions: c.dimensions || '', weight: c.weight || '', driverId: c.driverId || '',
      driver2: c.driver2 || '', dispatcher: dispIdByName(c.dispatcher),
      rateGroupId: c.rateGroupId || '', status: c.status || 'base',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const carNumber = (form.carNumber || '').toString().trim();
    if (!carNumber) {
      toast('Укажите госномер тягача', 'error');
      return;
    }
    const normPlate = carNumber.toUpperCase().replace(/[^A-ZА-Я0-9-]/g, '');
    const id = editing ? editing.id : normPlate;
    const dispId = (form.dispatcher || '').toString();
    const dispEntry = dispId ? dispatchers.find((d) => (d.id || d.key) === dispId) : null;
    const dispName = dispId ? (dispEntry?.name || dispId) : '';
    // Стабильная связь с учётной записью: пишем её идентификатор рядом с именем
    const dispAccountId = dispEntry ? (dispEntry as any).id || (dispEntry as any).key || '' : '';
    const safe = (v: any) => (v ?? '').toString().trim();
    const hasEdit = !!editing;
    const editBrand = (editing as any)?.brand || (editing as any)?.brandModel || '';
    const editTrailerBrand = (editing as any)?.trailerBrand || (editing as any)?.trailerMake || '';
    // Защита: НЕ затирать поля в БД пустотой из формы (SelectField может
    // сбросить brand в '' если марка переименована в Справочниках и
    // перестала совпадать с опцией выпадающего списка).
    const brandVal = (form.brand && form.brand.trim() !== '') ? safe(form.brand) : (hasEdit ? editBrand : '');
    const trailerBrandVal = (form.trailerBrand && form.trailerBrand.trim() !== '') ? safe(form.trailerBrand) : (hasEdit ? editTrailerBrand : '');
    const rec: any = {
      id,
      carNumber: carNumber.toUpperCase(),
      trailerNumber: safe(form.trailerNumber).toUpperCase(),
      brand: brandVal,
      trailerBrand: trailerBrandVal,
      brandRu: safe(form.brandRu),
      vehicleType: safe(form.vehicleType) || DEFAULT_VEHICLE.vehicleType,
      dimensions: safe(form.dimensions) || DEFAULT_VEHICLE.dimensions,
      weight: safe(form.weight) || DEFAULT_VEHICLE.weight,
      driverId: form.driverId || null,
      driverNameRu: driverName(form.driverId) || null,
      driver2: safe(form.driver2) || null,
      dispatcher: dispName,
      dispatcherName: dispName,
      dispatcherId: dispAccountId || null,
      rateGroupId: form.rateGroupId || null,
      status: form.status || 'base',
    };
    console.log('[handleSave] start', { carNumber: form.carNumber, dispatcher: form.dispatcher });
    try {
      await dbService.saveVehicleDriverRecord(rec, user.name, user.role);
      console.log('[handleSave] saved ok');
      // Немедленно обновляем локальный список, чтобы избежать гонки с кешем getCouplingsFlat
      savedMapRef.current[id] = {
        trailerNumber: (rec.trailerNumber || '').toUpperCase(),
        trailerBrand: rec.trailerBrand || '',
        brand: rec.brand || '',
        carNumber: rec.carNumber || '',
      };
      setCouplings((prev) => prev.map((c) =>
        c.id === id ? {
          ...c,
          trailerNumber: (rec.trailerNumber || c.trailerNumber || '').toUpperCase(),
          trailerBrand: (rec.trailerBrand || c.trailerBrand || ''),
          brand: rec.brand || c.brand || '',
          carNumber: rec.carNumber || c.carNumber || '',
        } : c
      ));
      toast(editing ? 'Сцепка обновлена' : 'Сцепка добавлена', 'success');
    } catch (err: any) {
      console.error('[handleSave] saveVehicleDriverRecord failed:', err);
      toast('Ошибка сохранения: ' + (err?.message || err), 'error');
    } finally {
      setModalOpen(false);
      // Проверяем один раз (не внутри подписки, чтобы не дублировать toasts).
      // couplings пишется под НОРМАЛИЗОВАННЫМ ключом — сравниваем с ним.
      const normId = String(id || '').toUpperCase().replace(/[^A-ZА-Я0-9-]/g, '');
      setTimeout(() => {
        setCouplings((prev) => {
          const found = prev.find((c) => {
            const cid = String(c.id || '').toUpperCase().replace(/[^A-ZА-Я0-9-]/g, '');
            return cid === normId;
          });
          if (!found) {
            console.warn('[handleSave] запись не найдена в списке после сохранения', id);
            toast('Внимание: запись сохранена, но не отображается в списке. Обновите страницу.', 'error');
          }
          return prev;
        });
      }, 600);
    }
  };

  const handleDelete = async (c: CouplingRow) => {
    if (await showConfirm(`Удалить сцепку ${c.carNumber}${c.trailerNumber ? ' + ' + c.trailerNumber : ''}?`)) {
      dbService.deleteVehicleDriverRecord(c.id, user.name, user.role);
      toast('Сцепка удалена', 'success');
      setSelected((s) => { const n = new Set(s); n.delete(c.id); return n; });
    }
  };

  // ---- multi-select helpers ----
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) filtered.forEach((c) => n.delete(c.id));
    else filtered.forEach((c) => n.add(c.id));
    return n;
  });

  const applyBulk = async () => {
    if (!bulkField || !bulkValue) return;
    const ids = Array.from(selected);
    // Диспетчер хранится в couplings.dispatcherName как ИМЯ (не id). Резолвим id→имя.
    const patch: Record<string, any> = { [bulkField]: bulkValue };
    if (bulkField === 'dispatcher') {
      // Единая модель записи: имя для показа и идентификатор учётной записи для связи.
      // Без dispatcherId запись оставалась привязанной к прежнему диспетчеру.
      const entry = dispatchers.find((d) => (d.id || d.key) === bulkValue);
      const name = entry?.name || bulkValue;
      patch.dispatcher = name;
      patch.dispatcherName = name;
      patch.dispatcherId = entry ? (entry.id || entry.key) : null;
    }
    await dbService.bulkUpdateCouplings(ids, patch);
    toast(`Обновлено ${ids.length} сцепок`, 'success');
    setBulkOpen(false); setBulkField(null); setBulkValue(''); setSelected(new Set());
  };
  const [bulkValue, setBulkValue] = useState('');

  // Статус по «Учёту выезда»: номер в baza → На базе, иначе → В рейса
  const getBazaStatusForCoupling = (c: CouplingRow): 'base' | 'trip' => {
    const plate = normalizePlate(c.carNumber);
    return plate && bazaCars.includes(plate) ? 'base' : 'trip';
  };

  const stats = useMemo(() => {
    const total = couplings.length;
    const base = couplings.filter(c => getBazaStatusForCoupling(c) === 'base').length;
    const trip = couplings.filter(c => getBazaStatusForCoupling(c) === 'trip').length;
    return { total, base, trip };
  }, [couplings, bazaCars]);

  // initials for driver avatar
  const initials = (name?: string) => {
    if (!name) return '—';
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  };

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<Truck className="w-4 h-4" />}
        tone="graphite"
        title="База сцепок (Авто + Прицеп + Водитель)"
        subtitle="Единая база: тягач, прицеп, марка, водитель, диспетчер и тариф. Связана со всеми модулями."
      >
        {isWritePermitted && (
          <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Добавить сцепку
          </button>
        )}
      </SectionHeader>

      {/* Counters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatRow color="graphite" label="Всего" value={stats.total} />
        <StatRow color="emerald" label="На базе" value={stats.base} />
        <StatRow color="amber" label="В рейсе" value={stats.trip} />
      </div>

      {/* TABS — строим по именам диспетчеров из самих записей (как колонка «Диспетчер»),
          чтобы фильтрация делила записи правильно и счётчики совпадали с таблицей */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActiveDisp('all')}
          aria-pressed={activeDisp === 'all'}
          className={`${UI.filterPill} ${activeDisp === 'all' ? UI.filterPillActive : UI.filterPillIdle}`}
        >
          Все ({couplings.length})
        </button>
        {dispTabs.map((name) => {
          const cnt = couplings.filter((c) => (c.dispatcher || '') === name).length;
          const isActive = activeDisp === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setActiveDisp(name)}
              aria-pressed={isActive}
              className={`${UI.filterPill} inline-flex items-center gap-1.5 ${isActive ? UI.filterPillActive : UI.filterPillIdle}`}
            >
              {name}
              <span className={`${UI.tabBadge} ${isActive ? 'bg-white/20 text-white' : 'bg-[#E5E7EB] text-[#4B5563]'}`}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* SEARCH + multi-select bar */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Поиск по тягачу / прицепу / водителю…"
          ariaLabel="Поиск по сцепкам"
          className="max-w-md"
        />
        {isWritePermitted && (
          <button type="button" onClick={toggleAll} className={`${allVisibleSelected ? UI.buttonDark : UI.buttonGhost}`}>
            <Check className="w-4 h-4" aria-hidden="true" /> Выбрать все (видимые)
          </button>
        )}
        {selected.size > 0 && (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-[#4B5563] px-2.5 py-1 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB]">
            <Layers className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" /> Выбрано: {selected.size}
          </span>
        )}
      </div>

      {/* BULK ACTION PANEL */}
      {isWritePermitted && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-[#E5E7EB] rounded-xl">
          <span className="text-xs font-semibold text-[#121316]">Массово для {selected.size}:</span>
          <button type="button" onClick={() => { setBulkField('rateGroupId'); setBulkValue(''); setBulkOpen(true); }} className={UI.buttonGhost}>
            <Tag className="w-3.5 h-3.5" aria-hidden="true" /> Применить ставку
          </button>
          <button type="button" onClick={() => { setBulkField('dispatcher'); setBulkValue(''); setBulkOpen(true); }} className={UI.buttonGhost}>
            <Users className="w-3.5 h-3.5" aria-hidden="true" /> Назначить диспетчера
          </button>
          <button type="button" onClick={async () => {
            if (await showConfirm(`Удалить ${selected.size} сцепок?`)) {
              for (const id of Array.from(selected)) dbService.deleteVehicleDriverRecord(id, user.name, user.role);
              toast(`Удалено ${selected.size} сцепок`, 'success');
              setSelected(new Set());
            }
          }} className={UI.buttonDanger}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Удалить
          </button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="ml-auto px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-medium text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer">
            Сбросить
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() || activeDisp !== 'all' ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() || activeDisp !== 'all' ? undefined : 'Сцепок пока нет'}
          hint={search.trim() || activeDisp !== 'all' ? undefined : 'Добавьте первую сцепку — она появится в базе.'}
          actionLabel="Обновить"
          onAction={() => window.location.reload()}
        />
      ) : (
        <div className={UI.tableWrap}>
          <table className={UI.table}>
            <thead>
              <tr className={UI.theadRow}>
                {isWritePermitted && (
                  <th className={UI.th + ' w-[36px]'}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Выбрать всех видимых" className={UI.checkbox} />
                  </th>
                )}
                <th className={UI.th}>Сцепка (Тягач / Прицеп)</th>
                <th className={UI.th}>Марка</th>
                <th className={UI.th}>Водитель</th>
                <th className={UI.th}>Диспетчер</th>
                <th className={UI.th}>Тариф</th>
                {isWritePermitted && <th className={UI.th + ' text-right w-[80px]'}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const isSel = selected.has(c.id);
                return (
                  <tr
                    key={c.id}
                    data-nav-item
                    onClick={() => setViewCard({ type: 'coupling', carNumber: c.carNumber })}
                    className={`${UI.tr} cursor-pointer ${isSel ? 'bg-[var(--accent-10)]' : ''} ${focusIdx === i ? 'ring-2 ring-[var(--accent-50)] ring-inset' : ''}`}
                    onMouseEnter={() => setFocusIdx(i)}
                  >
                    {isWritePermitted && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(c.id)} aria-label={`Выбрать ${c.carNumber}`} className={UI.checkbox} />
                      </td>
                    )}
                    <td className={UI.tdMono}>
                      <span className="text-[#121316]">{formatPlate(c.carNumber)}</span>
                      {c.trailerNumber && <span className="text-[#9CA3AF]"> / {formatPlate(c.trailerNumber)}</span>}
                    </td>
                    <td className={UI.td}>{[c.brand, c.trailerBrand].filter(Boolean).join(' / ') || '—'}</td>
                    <td className={UI.td}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setViewCard({ type: 'driver', driverId: c.driverId || '', driverName: c.driverName || driverName(c.driverId) }); }}
                        className="inline-flex items-center gap-2 text-left hover:underline cursor-pointer max-w-[220px]"
                      >
                        <span className="w-5 h-5 rounded-full bg-[var(--accent-10)] text-[#A55329] flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {initials(c.driverName || driverName(c.driverId))}
                        </span>
                        <span className="truncate text-[#121316] font-semibold">{c.driverName || driverName(c.driverId) || '—'}</span>
                      </button>
                    </td>
                    <td className={UI.td}>
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#4B5563] whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dispColor(c.dispatcher) }} aria-hidden="true" />
                        {dispName(c.dispatcher)}
                      </span>
                    </td>
                    <td className={UI.td}>{rateName(c.rateGroupId)}</td>
                    {isWritePermitted && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(c); }} aria-label="Изменить" title="Изменить" className={UI.buttonIcon}>
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(c); }} aria-label="Удалить" title="Удалить"
                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL add/edit */}
      {createPortal(
        <ModalShell
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? 'Редактировать сцепку' : 'Новая сцепка'}
          icon={<Link2 className="w-4 h-4" aria-hidden="true" />}
          ariaLabel={editing ? 'Редактировать сцепку' : 'Новая сцепка'}
          footer={
            <>
              <button type="button" onClick={() => setModalOpen(false)} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={handleSave} className={UI.buttonPrimary}>Сохранить</button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Тягач *" value={form.carNumber} onChange={(v) => setForm({ ...form, carNumber: v })} placeholder="AB 9271-7" />
            <p className={`${UI.hint} text-amber-600 sm:col-span-2 -mt-1`}>Госномера тягача и прицепа вносите на латинице (напр. AB 9271-7, A 1635 E-7).</p>
            <Field label="Прицеп" value={form.trailerNumber} onChange={(v) => setForm({ ...form, trailerNumber: v })} placeholder="А 1635 Е-7" />
            <SelectField label="Марка тягача" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })}
              options={vehicleBrands.map((b) => ({ v: b.key || b.name, l: b.name }))} allowCustom />
            <SelectField label="Марка прицепа" value={form.trailerBrand} onChange={(v) => setForm({ ...form, trailerBrand: v })}
              options={trailerBrands.map((b) => ({ v: b.key || b.name, l: b.name }))} allowCustom />
            <Field label="Марка/модель (рус.)" value={form.brandRu} onChange={(v) => setForm({ ...form, brandRu: v })} placeholder="Мерседес Бенц" />
            <SelectField label="Водитель" value={form.driverId} onChange={(v) => setForm({ ...form, driverId: v })}
              options={drivers.map((d) => ({ v: d.id, l: d.shortNameRu || d.name || d.firstNameRu || d.id }))} />
            <Field label="Тип ТС" value={form.vehicleType} onChange={(v) => setForm({ ...form, vehicleType: v })} placeholder="Тенты 90м3" />
            <Field label="Габариты полуприцепа" value={form.dimensions} onChange={(v) => setForm({ ...form, dimensions: v })} placeholder="13,6м x 2,45м x 2,7м" />
            <Field label="Вес ТС (Тягач+пп)" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} placeholder="1) 14,6т" />
            <Field label="Водитель №2 (если есть)" value={form.driver2} onChange={(v) => setForm({ ...form, driver2: v })} placeholder="ФИО второго водителя" />
            <SelectField label="Диспетчер" value={form.dispatcher} onChange={(v) => setForm({ ...form, dispatcher: v })}
              options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
            <SelectField label="Группа ставок" value={form.rateGroupId} onChange={(v) => setForm({ ...form, rateGroupId: v })}
              options={rateGroups.map((g) => ({ v: g.id || g.key, l: `${g.name} (€${g.rate}/км)` }))} />
          </div>
        </ModalShell>,
        document.body
      )}

      {/* BULK modal */}
      {createPortal(
        <ModalShell
          isOpen={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title={`${bulkField === 'rateGroupId' ? 'Применить ставку' : 'Назначить диспетчера'} (${selected.size})`}
          icon={<Layers className="w-4 h-4" aria-hidden="true" />}
          ariaLabel={bulkField === 'rateGroupId' ? 'Применить ставку' : 'Назначить диспетчера'}
          maxWidth="max-w-sm"
          footer={
            <>
              <button type="button" onClick={() => setBulkOpen(false)} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={applyBulk} disabled={!bulkValue} className={UI.buttonPrimary}>Применить</button>
            </>
          }
        >
          {bulkField === 'rateGroupId' ? (
            <SelectField label="Группа ставок" value={bulkValue} onChange={setBulkValue}
              options={rateGroups.map((g) => ({ v: g.id || g.key, l: `${g.name} (€${g.rate}/км)` }))} />
          ) : (
            <SelectField label="Диспетчер" value={bulkValue} onChange={setBulkValue}
              options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
          )}
        </ModalShell>,
        document.body
      )}

      {/* Soft-link cards */}
      {viewCard?.type === 'coupling' && viewCard.carNumber && createPortal(
        <CouplingCard
          carNumber={viewCard.carNumber}
          bazaRec={filtered.find((r: any) => r.carNumber === viewCard.carNumber || r.id === viewCard.carNumber)}
          onClose={() => setViewCard(null)}
          onOpenDriver={(driverId, driverName) => setViewCard({ type: 'driver', driverId, driverName })}
        />,
        document.body
      )}
      {viewCard?.type === 'driver' && createPortal(
        <DriverCard
          driverId={viewCard.driverId || ''}
          driverName={viewCard.driverName || ''}
          onClose={() => setViewCard(null)}
          onOpenCoupling={(carNumber) => setViewCard({ type: 'coupling', carNumber })}
          onPrev={() => {
            const list = drivers || [];
            const idx = list.findIndex((d: any) =>
              (d.id && d.id === viewCard.driverId) ||
              ((d.name || d.shortNameRu || '').trim() === (viewCard.driverName || '').trim() && viewCard.driverName)
            );
            const prev = list[(idx - 1 + list.length) % list.length];
            if (prev) setViewCard({ type: 'driver', driverId: prev.id || '', driverName: prev.name || prev.shortNameRu || '' });
          }}
          onNext={() => {
            const list = drivers || [];
            const idx = list.findIndex((d: any) =>
              (d.id && d.id === viewCard.driverId) ||
              ((d.name || d.shortNameRu || '').trim() === (viewCard.driverName || '').trim() && viewCard.driverName)
            );
            const next = list[(idx + 1) % list.length];
            if (next) setViewCard({ type: 'driver', driverId: next.id || '', driverName: next.name || next.shortNameRu || '' });
          }}
        />,
        document.body
      )}
    </div>
  );
}

function StatRow({ color, label, value }: { color: 'graphite' | 'emerald' | 'amber'; label: string; value: number }) {
  const dot = color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : 'bg-[#121316]';
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
      <span className={UI.hint}>{label}</span>
      <span className="text-xs font-semibold font-mono tabular-nums text-[#121316]">{value}</span>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={UI.fieldLabel}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={UI.input} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, allowCustom }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[]; allowCustom?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={UI.fieldLabel}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${UI.select} w-full`}>
        <option value="">—</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        {allowCustom && value && !options.some((o) => o.v === value) && <option value={value}>{value}</option>}
      </select>
    </div>
  );
}
