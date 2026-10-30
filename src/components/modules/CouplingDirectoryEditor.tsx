import {useState, useEffect, useMemo, useRef} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {dbService, directoryService} from '../../api'
import {getCouplingsFlat, getDriversFlat, getDispatchersFlat, getTrailersFlat} from '../../services/fleetService'
import {Truck, Plus, Trash2, Pencil, Link2, Check, Layers, Tag, Users, AlertTriangle} from 'lucide-react'
import {UserProfile} from '../../types'
import {normalizePlate} from '../../utils/salaryAutofill'
import {
  buildDriverDirectory,
  driverFullName,
  driverLinkNotice,
  resolveDriverLink,
} from '../../utils/driverRegistry'
import DriverAutocomplete from '../common/DriverAutocomplete';
import VehicleCard from './VehicleCard';
import DriverCard from './DriverCard';
import {useFleetCardStack, fleetCardRefKey} from '../../hooks/useFleetCards';
import {UI} from '../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../ui/components'
import { formatPlate, plateKey } from '../../utils/plate';

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
  trailerId?: string;
  brand?: string;
  trailerBrand?: string;
  brandRu?: string;
  vehicleType?: string;
  dimensions?: string;
  weight?: string;
  year?: string;
  driverId?: string;
  driverName?: string;
  driver2?: string;
  driver2Id?: string;
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
  const [trailers, setTrailers] = useState<any[]>([]);
  const [statusTypes, setStatusTypes] = useState<any[]>([]);
  // Номера авто из «Учёта выезда» (baza) для статуса «На базе / В рейса»
  const [bazaCars, setBazaCars] = useState<string[]>([]);
  const savedMapRef = useRef<Record<string, any>>({});
  /** Идёт сохранение — кнопка блокируется (нет дублей при повторном нажатии). */
  const [isSaving, setIsSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const [activeDisp, setActiveDisp] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  useLockBodyScroll(modalOpen);
  const [editing, setEditing] = useState<CouplingRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  // Полные карточки — общий стек: автомобиль → водитель; закрытие верхней
  // возвращает к нижней без потери контекста (нижние остаются смонтированными).
  const {stack: cards, push: pushCard, replaceTop: replaceTopCard, pop: popCard} = useFleetCardStack();

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
          trailerId: c.trailerId || '',
          brand: saved?.brand || c.brand || c.brandModel || '',
          trailerBrand: saved?.trailerBrand || c.trailerBrand || c.trailerMake || '',
          brandRu: c.brandRu || '',
          vehicleType: c.vehicleType || '',
          dimensions: c.dimensions || '',
          weight: c.weight || '',
          year: c.year != null ? String(c.year) : '',
          driverId: c.driverId || '',
          // Имя для отображения: при живой связи с реестром берётся из записи
          // водителя (см. driverLinkOf), текст couplings — только запасной вариант
          // для записей без ссылки (показывается вместе с пометкой проблемы).
          driverName: c.driverNameRu || c.driverName || '',
          driver2: saved?.driver2 || c.driver2 || '',
          driver2Id: c.driver2Id || '',
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
    // Реестр прицепов — единая база прицепов (trailers) для ссылки trailerId
    const u8b = getTrailersFlat((l: any[]) => setTrailers(l || []));
    // Подписка на «Учёт выезда» (baza) для статуса «На базе / В рейса»
    const u9 = (dbService as any).getBazaRecords
      ? (dbService as any).getBazaRecords((list: any[]) => {
          const plates = (list || []).map((c: any) => normalizePlate(c.carNumber || c.vehicleNumbers || '')).filter(Boolean);
          setBazaCars(plates);
        })
      : () => {};
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u8b(); u9(); };
  }, []);

  // Единый реестр водителей: и список выбора, и подписи в таблице строятся здесь.
  const driverDir = useMemo(() => buildDriverDirectory(drivers), [drivers]);

  /** Актуальное ФИО водителя из реестра по id (или ''. если связи нет). */
  const driverName = (id?: string) => {
    if (!id) return '';
    const d = driverDir.byId.get(String(id));
    return d ? driverFullName(d) : '';
  };
  /** Состояние связи строки со справочником водителей (проблемы показываем явно). */
  const driverLinkOf = (c: CouplingRow) => resolveDriverLink({ driverId: c.driverId, driverNameRu: c.driverName }, driverDir);
  const driver2LinkOf = (c: CouplingRow) => resolveDriverLink({ driver2Id: c.driver2Id, driver2: c.driver2 }, driverDir, 'driver2');
  const driverNoticeOf = (c: CouplingRow) => {
    const l1 = driverLinkOf(c);
    if (l1.status === 'missing' || l1.status === 'service') return driverLinkNotice(l1);
    const l2 = driver2LinkOf(c);
    if (l2.status === 'missing' || l2.status === 'service') return driverLinkNotice(l2, 'driver2');
    return '';
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
      carNumber: '', trailerNumber: '', trailerId: '', brand: '', trailerBrand: '', brandRu: '',
      vehicleType: DEFAULT_VEHICLE.vehicleType, dimensions: DEFAULT_VEHICLE.dimensions, weight: DEFAULT_VEHICLE.weight,
      year: '',
      driverId: '', driver2: '', driver2Id: '',
      dispatcher: '', rateGroupId: '', status: 'base',
    });
    setModalOpen(true);
  };
  const openEdit = (c: CouplingRow) => {
    setEditing(c);
    // Живую связь восстанавливаем до стабильного id (реестр), текст — запасной вариант.
    const l1 = driverLinkOf(c);
    const linkedDriverId = (l1.status === 'ok' || l1.status === 'archived') ? l1.id : (c.driverId || '');
    setForm({
      carNumber: c.carNumber, trailerNumber: c.trailerNumber || '', trailerId: c.trailerId || '',
      brand: c.brand || '',
      trailerBrand: c.trailerBrand || '', brandRu: c.brandRu || '', vehicleType: c.vehicleType || '',
      dimensions: c.dimensions || '', weight: c.weight || '', year: c.year || '',
      driverId: linkedDriverId,
      driver2: c.driver2 || '', driver2Id: c.driver2Id || '',
      dispatcher: dispIdByName(c.dispatcher),
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
    // Ключ новой машины — единый ключ номера (латиница, без знаков), как у остальных записей.
    const normPlate = plateKey(carNumber);
    if (!editing && couplings.some((c) => plateKey(c.carNumber) === normPlate)) {
      toast('Машина с таким номером уже есть в справочнике', 'error');
      return;
    }
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
    // Водители — ССЫЛКИ на единый реестр: id + актуальное ФИО из записи.
    const driverRec = form.driverId ? driverDir.byId.get(String(form.driverId)) : null;
    const driver2Rec = form.driver2Id ? driverDir.byId.get(String(form.driver2Id)) : null;
    // Прицеп: связываем с единым реестром прицепов (trailers) по нормализованному номеру.
    const trailerNumber = formatPlate(safe(form.trailerNumber));
    const trailerRec = trailerNumber
      ? (trailers || []).find((t: any) => normalizePlate(t.trailerNumber || t.id || '') === normalizePlate(trailerNumber))
      : null;
    const rec: any = {
      id,
      carNumber: formatPlate(carNumber),
      trailerNumber,
      trailerId: trailerRec ? (trailerRec.id || null) : (form.trailerId || null),
      brand: brandVal,
      trailerBrand: trailerBrandVal,
      brandRu: safe(form.brandRu),
      vehicleType: safe(form.vehicleType) || DEFAULT_VEHICLE.vehicleType,
      dimensions: safe(form.dimensions) || DEFAULT_VEHICLE.dimensions,
      weight: safe(form.weight) || DEFAULT_VEHICLE.weight,
      year: safe(form.year) || null,
      driverId: driverRec ? String(driverRec.id) : null,
      driverNameRu: driverRec ? driverFullName(driverRec) : null,
      driver2: driver2Rec ? driverFullName(driver2Rec) : (safe(form.driver2) || null),
      driver2Id: driver2Rec ? String(driver2Rec.id) : null,
      dispatcher: dispName,
      dispatcherName: dispName,
      dispatcherId: dispAccountId || null,
      rateGroupId: form.rateGroupId || null,
      status: form.status || 'base',
    };
    if (isSaving) return;
    setIsSaving(true);
    try {
      await dbService.saveVehicleDriverRecord(rec, user.name, user.role);
      // Немедленно обновляем локальный список, чтобы избежать гонки с кешем getCouplingsFlat
      savedMapRef.current[id] = {
        trailerNumber: (rec.trailerNumber || '').toUpperCase(),
        trailerBrand: rec.trailerBrand || '',
        brand: rec.brand || '',
        carNumber: rec.carNumber || '',
        driver2: rec.driver2 || '',
      };
      setCouplings((prev) => prev.map((c) =>
        c.id === id ? {
          ...c,
          trailerNumber: (rec.trailerNumber || c.trailerNumber || '').toUpperCase(),
          trailerBrand: (rec.trailerBrand || c.trailerBrand || ''),
          brand: rec.brand || c.brand || '',
          carNumber: rec.carNumber || c.carNumber || '',
          year: rec.year != null ? String(rec.year) : c.year,
          driverId: rec.driverId || '',
          driverName: rec.driverNameRu || '',
          driver2: rec.driver2 || '',
          driver2Id: rec.driver2Id || '',
        } : c
      ));
      toast(editing ? 'Сцепка обновлена' : 'Сцепка добавлена', 'success');
    } catch (err: any) {
      console.error('[handleSave] saveVehicleDriverRecord failed:', err);
      toast('Ошибка сохранения: ' + (err?.message || err), 'error');
    } finally {
      setIsSaving(false);
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
                    onClick={() => pushCard({ type: 'vehicle', carNumber: c.carNumber, vehicleId: c.id })}
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
                      {(() => {
                        const link = driverLinkOf(c);
                        const l2 = driver2LinkOf(c);
                        const name = link.displayName;
                        const warn = link.status === 'missing' || link.status === 'service';
                        const empty = link.status === 'empty' && !name;
                        return (
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="inline-flex items-center gap-2 min-w-0">
                              <button
                                type="button"
                                data-ui="coupling-driver-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (link.status === 'ok' || link.status === 'archived' || link.status === 'service') {
                                    pushCard({ type: 'driver', driverId: link.id, driverName: name });
                                  }
                                }}
                                className={`inline-flex items-center gap-2 text-left max-w-[220px] ${empty ? 'cursor-default' : 'hover:underline cursor-pointer'}`}
                                title={driverNoticeOf(c) || name || undefined}
                              >
                                <span className="w-5 h-5 rounded-full bg-[var(--accent-10)] text-[var(--accent-ink)] flex items-center justify-center text-[10px] font-semibold shrink-0">
                                  {initials(name)}
                                </span>
                                <span className={`truncate font-semibold ${empty ? 'text-[#9CA3AF] italic font-normal' : 'text-[#121316]'}`}>
                                  {name || 'Без водителя'}
                                </span>
                              </button>
                              {link.status === 'archived' && (
                                <span className="shrink-0 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">архив</span>
                              )}
                              {warn && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-rose-600" title={driverNoticeOf(c)}>
                                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                  {link.status === 'service' ? 'служебное' : 'нет в реестре'}
                                </span>
                              )}
                              {l2.status !== 'empty' && (
                                <span className="shrink-0 text-[10px] text-[#9CA3AF]" title={`Второй водитель: ${l2.displayName}`}>+2-й</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
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

      {/* Полные карточки — один стек (автомобиль → водитель). Нижние карточки
          остаются смонтированными (hidden), поэтому возврат к автомобилю
          сохраняет контекст и состояние; данные в них обновляются живьём.
          Рендерятся ДО форм, чтобы открытая из карточки форма была выше. */}
      {cards.map((card, i) => {
        const isTop = i === cards.length - 1;
        const node = card.type === 'vehicle' ? (
          <VehicleCard
            carNumber={card.carNumber}
            vehicleId={card.vehicleId}
            canEdit={isWritePermitted}
            onEdit={(carNumber, vehicleId) => {
              const row = couplings.find((c) => c.id === vehicleId)
                || couplings.find((c) => normalizePlate(c.carNumber) === normalizePlate(carNumber));
              if (row) openEdit(row);
            }}
            onOpenDriver={(driverId, driverName) => pushCard({ type: 'driver', driverId, driverName })}
            onClose={popCard}
          />
        ) : (
          <DriverCard
            driverId={card.driverId}
            driverName={card.driverName}
            canEdit={false}
            onClose={popCard}
            onOpenCoupling={(carNumber) => pushCard({ type: 'vehicle', carNumber })}
            onPrev={() => {
              const list = drivers || [];
              const idx = list.findIndex((d: any) => String(d.id) === String(card.driverId));
              if (idx < 0 || list.length === 0) return;
              const prev = list[(idx - 1 + list.length) % list.length];
              if (prev) replaceTopCard({ type: 'driver', driverId: String(prev.id || ''), driverName: prev.name || prev.shortNameRu || '' });
            }}
            onNext={() => {
              const list = drivers || [];
              const idx = list.findIndex((d: any) => String(d.id) === String(card.driverId));
              if (idx < 0 || list.length === 0) return;
              const next = list[(idx + 1) % list.length];
              if (next) replaceTopCard({ type: 'driver', driverId: String(next.id || ''), driverName: next.name || next.shortNameRu || '' });
            }}
          />
        );
        return createPortal(
          <div key={fleetCardRefKey(card)} className={isTop ? undefined : 'hidden'} aria-hidden={isTop ? undefined : true}>
            {node}
          </div>,
          document.body,
        );
      })}

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
              <button type="button" onClick={() => setModalOpen(false)} disabled={isSaving} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={handleSave} disabled={isSaving} data-ui="coupling-save" className={UI.buttonPrimary}>
                {isSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Тягач *" value={form.carNumber} onChange={(v) => setForm({ ...form, carNumber: v })} placeholder="AB 9271-7" dataUi="coupling-car-number" />
            <p className={`${UI.hint} text-amber-600 sm:col-span-2 -mt-1`}>Госномера тягача и прицепа вносите на латинице (напр. AB 9271-7, A 1635 E-7).</p>
            <Field label="Прицеп" value={form.trailerNumber} onChange={(v) => setForm({ ...form, trailerNumber: v })} placeholder="А 1635 Е-7" dataUi="coupling-trailer-number" />
            <SelectField label="Марка тягача" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })}
              options={vehicleBrands.map((b) => ({ v: b.key || b.name, l: b.name }))} allowCustom />
            <SelectField label="Марка прицепа" value={form.trailerBrand} onChange={(v) => setForm({ ...form, trailerBrand: v })}
              options={trailerBrands.map((b) => ({ v: b.key || b.name, l: b.name }))} allowCustom />
            <Field label="Марка/модель (рус.)" value={form.brandRu} onChange={(v) => setForm({ ...form, brandRu: v })} placeholder="Мерседес Бенц" />
            <Field label="Год выпуска" value={form.year} onChange={(v) => setForm({ ...form, year: v })} placeholder="2018" dataUi="coupling-year" />
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Водитель (из справочника)</label>
              <DriverAutocomplete
                value={form.driverId || ''}
                valueName={form.driverId && driverDir.byId.get(String(form.driverId)) ? driverFullName(driverDir.byId.get(String(form.driverId))!) : ''}
                onSelect={(d, meta) => {
                  if (!d) {
                    setForm((f) => ({ ...f, driverId: '' }));
                    return;
                  }
                  if (meta.status === 'service') {
                    setForm((f) => ({ ...f, driverId: '' }));
                    toast('Это служебная запись, а не водитель — назначение очищено. Выберите водителя заново.', 'error');
                    return;
                  }
                  setForm((f) => ({ ...f, driverId: String(d.id) }));
                }}
                placeholder="Поиск по ФИО или телефону…"
                className={UI.input}
                dataUi="coupling-driver"
                allowCreate={isWritePermitted}
                author={user.name}
                authorRole={user.role}
                ariaLabel="Водитель (основной)"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Водитель №2 (если есть)</label>
              <DriverAutocomplete
                value={form.driver2Id || ''}
                valueName={form.driver2 || ''}
                onSelect={(d, meta) => {
                  if (!d) {
                    setForm((f) => ({ ...f, driver2Id: '', driver2: '' }));
                    return;
                  }
                  if (meta.status === 'service') {
                    setForm((f) => ({ ...f, driver2Id: '', driver2: '' }));
                    toast('Это служебная запись, а не водитель — назначение очищено.', 'error');
                    return;
                  }
                  setForm((f) => ({ ...f, driver2Id: String(d.id), driver2: driverFullName(d) }));
                }}
                placeholder="Поиск по ФИО или телефону…"
                className={UI.input}
                dataUi="coupling-driver2"
                allowCreate={isWritePermitted}
                author={user.name}
                authorRole={user.role}
                excludeIds={form.driverId ? [form.driverId] : []}
                ariaLabel="Водитель №2"
              />
            </div>
            <Field label="Тип ТС" value={form.vehicleType} onChange={(v) => setForm({ ...form, vehicleType: v })} placeholder="Тенты 90м3" />
            <Field label="Габариты полуприцепа" value={form.dimensions} onChange={(v) => setForm({ ...form, dimensions: v })} placeholder="13,6м x 2,45м x 2,7м" />
            <Field label="Вес ТС (Тягач+пп)" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} placeholder="1) 14,6т" />
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

function Field({ label, value, onChange, placeholder, dataUi }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; dataUi?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={UI.fieldLabel}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        data-ui={dataUi}
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
