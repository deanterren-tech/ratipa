import {useState, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {dbService, directoryService} from '../../api'
import {getCouplingsFlat, getDriversFlat, getDispatchersFlat} from '../../services/fleetService'
import {Truck, Plus, Trash2, Pencil, Search, Link2, X, Check, Layers, Tag, Users} from 'lucide-react'
import {UserProfile} from '../../types'
import CouplingCard from './CouplingCard';
import DriverCard from './DriverCard';

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
  виталий: '#3765F6', матвей: '#8b5cf6', сергей: '#f59e0b', юрий: '#10b981',
};
const dispColor = (key?: string) => DISP_COLORS[(key || '').toLowerCase()] || '#64748b';

export default function CouplingDirectoryEditor({ user, isWritePermitted }: CouplingDirectoryEditorProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [couplings, setCouplings] = useState<CouplingRow[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [dispatchers, setDispatchers] = useState<any[]>([]);
  const [rateGroups, setRateGroups] = useState<any[]>([]);
  const [vehicleBrands, setVehicleBrands] = useState<any[]>([]);
  const [trailerBrands, setTrailerBrands] = useState<any[]>([]);
  const [statusTypes, setStatusTypes] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [activeDisp, setActiveDisp] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CouplingRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [viewCard, setViewCard] = useState<{ type: 'coupling' | 'driver'; carNumber?: string; driverId?: string; driverName?: string } | null>(null);

  // multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<'rateGroupId' | 'dispatcher' | null>(null);

  useEffect(() => {
    const u1 = getCouplingsFlat((list: any[]) => {
      setCouplings((list || []).map((c) => ({
        id: c.id,
        carNumber: c.carNumber || c.vehicleNumbers || '',
        trailerNumber: c.trailerNumber || '',
        brand: c.brand || c.brandModel || '',
        trailerBrand: c.trailerBrand || c.trailerMake || '',
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
      })));
    });
    const u2 = getDriversFlat((l: any[]) => setDrivers(l || []));
    const u3 = getDispatchersFlat((l: any[]) => setDispatchers(l || []));
    const u4 = directoryService.getRateGroups((l: any[]) => setRateGroups(l || []));
    const u5 = directoryService.getVehicleBrands((l: any[]) => setVehicleBrands(l || []));
    const u6 = directoryService.getTrailerBrands((l: any[]) => setTrailerBrands(l || []));
    const u7 = directoryService.getStatusTypes((l: any[]) => setStatusTypes(l || []));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  const driverName = (id?: string) => {
    const d = drivers.find((x) => x.id === id);
    return d ? (d.shortNameRu || d.name || d.firstNameRu || '') : '';
  };
  const dispName = (id?: string) => {
    const d = dispatchers.find((x) => (x.id || x.key) === id);
    return d ? d.name : (id || '—');
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
      if (activeDisp !== 'all' && c.dispatcher !== activeDisp) return false;
      if (!q) return true;
      return [c.carNumber, c.trailerNumber, c.driverName, driverName(c.driverId), dispName(c.dispatcher)]
        .join(' ').toLowerCase().replace(/\s+/g, '').includes(q);
    });
  }, [search, couplings, drivers, dispatchers, activeDisp]);

  const openAdd = () => {
    setEditing(null);
    setForm({ carNumber: '', trailerNumber: '', brand: '', trailerBrand: '', driverId: '', dispatcher: '', rateGroupId: '', status: 'base' });
    setModalOpen(true);
  };
  const openEdit = (c: CouplingRow) => {
    setEditing(c);
    setForm({
      carNumber: c.carNumber, trailerNumber: c.trailerNumber || '', brand: c.brand || '',
      trailerBrand: c.trailerBrand || '', brandRu: c.brandRu || '', vehicleType: c.vehicleType || '',
      dimensions: c.dimensions || '', weight: c.weight || '', driverId: c.driverId || '',
      driver2: c.driver2 || '', dispatcher: c.dispatcher || '',
      rateGroupId: c.rateGroupId || '', status: c.status || 'base',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.carNumber.trim()) {
      toast('Укажите госномер тягача', 'error');
      return;
    }
    const normPlate = form.carNumber.trim().toUpperCase().replace(/\s+/g, '');
    const id = editing ? editing.id : normPlate;
    const rec: any = {
      id,
      carNumber: form.carNumber.trim().toUpperCase(),
      trailerNumber: form.trailerNumber.trim().toUpperCase(),
      brand: form.brand.trim(),
      trailerBrand: form.trailerBrand.trim(),
      brandRu: form.brandRu.trim(),
      vehicleType: form.vehicleType.trim(),
      dimensions: form.dimensions.trim(),
      weight: form.weight.trim(),
      driverId: form.driverId || null,
      driverNameRu: driverName(form.driverId) || null,
      driver2: form.driver2.trim() || null,
      dispatcher: form.dispatcher || '',
      rateGroupId: form.rateGroupId || null,
      status: form.status || 'base',
    };
    await dbService.saveVehicleDriverRecord(rec, user.name, user.role);
    toast(editing ? 'Сцепка обновлена' : 'Сцепка добавлена', 'success');
    setModalOpen(false);
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
    await dbService.bulkUpdateCouplings(ids, { [bulkField]: bulkValue });
    toast(`Обновлено ${ids.length} сцепок`, 'success');
    setBulkOpen(false); setBulkField(null); setBulkValue(''); setSelected(new Set());
  };
  const [bulkValue, setBulkValue] = useState('');

  const stats = useMemo(() => {
    const total = couplings.length;
    const base = couplings.filter(c => (c.status || 'base') === 'base').length;
    const trip = couplings.filter(c => (c.status || 'base') === 'trip').length;
    return { total, base, trip };
  }, [couplings]);

  // initials for driver avatar
  const initials = (name?: string) => {
    if (!name) return '—';
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  };

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-slate-200/60">
        <div>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Truck className="h-4.5 w-4.5 text-blue-500" />
            </div>
            <span>База сцепок (Авто + Прицеп + Водитель)</span>
          </h2>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            Единая база: тягач, прицеп, марка, водитель, диспетчер и тариф. Связана со всеми модулями.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <div className="flex items-center gap-2 bg-slate-900 text-white rounded-xl px-3 py-1.5">
              <Truck className="w-3.5 h-3.5 text-slate-300" />
              <span className="text-[10px] font-semibold text-slate-300">Всего</span>
              <span className="text-sm font-black font-mono">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2 bg-emerald-500 text-white rounded-xl px-3 py-1.5">
              <span className="text-[10px] font-semibold">На базе</span>
              <span className="text-sm font-black font-mono">{stats.base}</span>
            </div>
            <div className="flex items-center gap-2 bg-amber-500 text-white rounded-xl px-3 py-1.5">
              <span className="text-[10px] font-semibold">В рейсе</span>
              <span className="text-sm font-black font-mono">{stats.trip}</span>
            </div>
          </div>
        </div>
        {isWritePermitted && (
          <button onClick={openAdd}
            className="mt-3 md:mt-0 inline-flex items-center gap-2 bg-[#3765F6] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#2a4fd0] shadow-sm active:scale-95">
            <Plus className="w-4 h-4" /> Добавить сцепку
          </button>
        )}
        </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/60 max-w-max">
        <button onClick={() => setActiveDisp('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeDisp === 'all' ? 'bg-[#3765F6] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
          Все ({couplings.length})
        </button>
        {dispatchers.map((d) => {
          const cnt = couplings.filter((c) => c.dispatcher === (d.id || d.key)).length;
          const isActive = activeDisp === (d.id || d.key);
          const col = dispColor(d.id || d.key);
          return (
            <button key={d.id || d.key} onClick={() => setActiveDisp(d.id || d.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${isActive ? 'bg-[#3765F6] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
              {d.name}
              <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${isActive ? 'bg-white/20' : 'bg-slate-200'}`}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* SEARCH + multi-select bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по тягачу / прицепу / водителю..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-[#3765F6] font-mono" />
        </div>
        {isWritePermitted && (
          <button onClick={toggleAll}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition ${allVisibleSelected ? 'bg-[#3765F6] text-white border-[#3765F6]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Check className="w-4 h-4" /> Выбрать все (видимые)
          </button>
        )}
        {selected.size > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#3765F6]/10 text-[#3765F6] text-xs font-bold">
            <Layers className="w-4 h-4" /> Выбрано: {selected.size}
          </div>
        )}
      </div>

      {/* BULK ACTION PANEL */}
      {isWritePermitted && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-[#3765F6]/5 border border-[#3765F6]/20">
          <span className="text-xs font-bold text-slate-700">Массово для {selected.size}:</span>
          <button onClick={() => { setBulkField('rateGroupId'); setBulkValue(''); setBulkOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Tag className="w-3.5 h-3.5" /> Применить ставку
          </button>
          <button onClick={() => { setBulkField('dispatcher'); setBulkValue(''); setBulkOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Users className="w-3.5 h-3.5" /> Назначить диспетчера
          </button>
          <button onClick={async () => {
            if (await showConfirm(`Удалить ${selected.size} сцепок?`)) {
              for (const id of Array.from(selected)) dbService.deleteVehicleDriverRecord(id, user.name, user.role);
              toast(`Удалено ${selected.size} сцепок`, 'success');
              setSelected(new Set());
            }
          }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-100">
            <Trash2 className="w-3.5 h-3.5" /> Удалить
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-100">Сбросить</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/60 bg-white/40">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/95">
            <tr className="text-[9px] font-black uppercase text-slate-500 font-mono border-b border-slate-200/80">
              {isWritePermitted && <th className="px-2 py-3 w-[36px]"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-[#3765F6]" /></th>}
              <th className="px-4 py-3 whitespace-nowrap">Сцепка (Тягач / Прицеп)</th>
              <th className="px-4 py-3 whitespace-nowrap">Марка</th>
              <th className="px-4 py-3 whitespace-nowrap">Водитель</th>
              <th className="px-4 py-3 whitespace-nowrap">Диспетчер</th>
              <th className="px-4 py-3 whitespace-nowrap">Тариф</th>
              <th className="px-4 py-3 whitespace-nowrap">Статус</th>
              {isWritePermitted && <th className="px-4 py-3 text-right w-[80px]"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80 text-xs text-slate-700 font-mono">
            {filtered.map((c) => {
              const isSel = selected.has(c.id);
              const col = dispColor(c.dispatcher);
              return (
              <tr key={c.id} onClick={() => isWritePermitted ? toggle(c.id) : setViewCard({ type: 'coupling', carNumber: c.carNumber })}
                  className={`hover:bg-slate-50/60 cursor-pointer transition ${isSel ? 'bg-[#3765F6]/10' : ''}`}>
                {isWritePermitted && (
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSel} onChange={() => toggle(c.id)} className="accent-[#3765F6]" />
                  </td>
                )}
                <td className="px-4 py-2.5 font-mono">
                  <span className="font-black text-slate-900">{c.carNumber}</span>
                  {c.trailerNumber && <span className="text-slate-400"> / {c.trailerNumber}</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{[c.brand, c.trailerBrand].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-4 py-2.5">
                  <button onClick={(e) => { e.stopPropagation(); setViewCard({ type: 'driver', driverId: c.driverId || '', driverName: c.driverName || driverName(c.driverId) }); }}
                    className="inline-flex items-center gap-1.5 text-left hover:underline font-medium text-slate-700">
                    <span className="w-5 h-5 rounded-full bg-[#3765F6]/15 text-[#3765F6] flex items-center justify-center text-[9px] font-black">
                      {initials(c.driverName || driverName(c.driverId))}
                    </span>
                    {c.driverName || driverName(c.driverId) || '—'}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold text-white" style={{ background: col }}>
                    {dispName(c.dispatcher)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{rateName(c.rateGroupId)}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold"
                    style={{ background: statusColor(c.status) + '22', color: statusColor(c.status) }}>
                    {statusLabel(c.status)}
                  </span>
                </td>
                {isWritePermitted && (
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(c); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(c); }} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={isWritePermitted ? 9 : 8} className="px-4 py-8 text-center text-xs text-slate-400">Пусто</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL add/edit */}
      {modalOpen && createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#3765F6]" />
                {editing ? 'Редактировать сцепку' : 'Новая сцепка'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Тягач *" value={form.carNumber} onChange={(v) => setForm({ ...form, carNumber: v })} placeholder="АС 0246-7" />
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
              <SelectField label="Статус" value={form.status} onChange={(v) => setForm({ ...form, status: v })}
                options={statusTypes.map((s) => ({ v: s.id || s.key, l: s.label }))} />
            </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl">Отмена</button>
              <button onClick={handleSave} className="px-4 py-2 text-xs font-bold text-white bg-[#3765F6] hover:bg-[#2a4fd0] rounded-xl shadow-sm">Сохранить</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* BULK modal */}
      {bulkOpen && createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setBulkOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#3765F6]" />
                {bulkField === 'rateGroupId' ? 'Применить ставку' : 'Назначить диспетчера'} ({selected.size})
              </h3>
              <button onClick={() => setBulkOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            {bulkField === 'rateGroupId' ? (
              <SelectField label="Группа ставок" value={bulkValue} onChange={setBulkValue}
                options={rateGroups.map((g) => ({ v: g.id || g.key, l: `${g.name} (€${g.rate}/км)` }))} />
            ) : (
              <SelectField label="Диспетчер" value={bulkValue} onChange={setBulkValue}
                options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl">Отмена</button>
              <button onClick={applyBulk} disabled={!bulkValue}
                className="px-4 py-2 text-xs font-bold text-white bg-[#3765F6] hover:bg-[#2a4fd0] rounded-xl shadow-sm disabled:opacity-40">Применить</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Soft-link cards */}
      {viewCard?.type === 'coupling' && viewCard.carNumber && createPortal(
        <CouplingCard
          carNumber={viewCard.carNumber}
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

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-[#3765F6]" />
    </div>
  );
}

function SelectField({ label, value, onChange, options, allowCustom }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[]; allowCustom?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-[#3765F6]">
        <option value="">—</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        {allowCustom && value && !options.some((o) => o.v === value) && <option value={value}>{value}</option>}
      </select>
    </div>
  );
}