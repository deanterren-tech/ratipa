import React, { useState, useEffect, useMemo } from 'react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { dbService, directoryService } from '../../firebase';
import { Truck, Plus, Trash2, Pencil, Search, Link2, User, X } from 'lucide-react';
import { UserProfile } from '../../types';

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
  driverId?: string;
  driverName?: string;
  dispatcher?: string;
  rateGroupId?: string;
  status?: string;
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
  const [statusTypes, setStatusTypes] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CouplingRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    const u1 = dbService.getVehicleDriverData((list: any[]) => {
      setCouplings((list || []).map((c) => ({
        id: c.id,
        carNumber: c.carNumber || c.vehicleNumbers || '',
        trailerNumber: c.trailerNumber || '',
        brand: c.brand || c.brandModel || '',
        trailerBrand: c.trailerBrand || c.trailerMake || '',
        driverId: c.driverId || '',
        driverName: c.driverNameRu || c.driverName || c.driverShortNameRu || '',
        dispatcher: c.dispatcher || '',
        rateGroupId: c.rateGroupId || '',
        status: c.status || 'base',
      })));
    });
    const u2 = dbService.getDrivers((l: any[]) => setDrivers(l || []));
    const u3 = directoryService.getDispatchers((l: any[]) => setDispatchers(l || []));
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
    if (!q) return couplings;
    return couplings.filter((c) =>
      [c.carNumber, c.trailerNumber, c.driverName, driverName(c.driverId), dispName(c.dispatcher)]
        .join(' ').toLowerCase().replace(/\s+/g, '').includes(q));
  }, [search, couplings, drivers, dispatchers]);

  const openAdd = () => {
    setEditing(null);
    setForm({ carNumber: '', trailerNumber: '', brand: '', trailerBrand: '', driverId: '', dispatcher: '', rateGroupId: '', status: 'base' });
    setModalOpen(true);
  };
  const openEdit = (c: CouplingRow) => {
    setEditing(c);
    setForm({
      carNumber: c.carNumber, trailerNumber: c.trailerNumber || '', brand: c.brand || '',
      trailerBrand: c.trailerBrand || '', driverId: c.driverId || '', dispatcher: c.dispatcher || '',
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
      driverId: form.driverId || null,
      driverNameRu: driverName(form.driverId) || null,
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
    }
  };

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col relative space-y-6">
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
        </div>
        {isWritePermitted && (
          <button onClick={openAdd}
            className="mt-3 md:mt-0 inline-flex items-center gap-2 bg-[#3765F6] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#2a4fd0] shadow-sm active:scale-95">
            <Plus className="w-4 h-4" /> Добавить сцепку
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по тягачу / прицепу / водителю..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-[#3765F6] font-mono" />
        </div>
        <span className="text-[10px] font-black uppercase text-slate-500 font-mono">Всего: {couplings.length}</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/60 bg-white/40">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/95">
            <tr className="text-[9px] font-black uppercase text-slate-500 font-mono border-b border-slate-200/80">
              <th className="px-4 py-3 whitespace-nowrap">Тягач</th>
              <th className="px-4 py-3 whitespace-nowrap">Прицеп</th>
              <th className="px-4 py-3 whitespace-nowrap">Марка</th>
              <th className="px-4 py-3 whitespace-nowrap">Водитель</th>
              <th className="px-4 py-3 whitespace-nowrap">Диспетчер</th>
              <th className="px-4 py-3 whitespace-nowrap">Тариф</th>
              <th className="px-4 py-3 whitespace-nowrap">Статус</th>
              {isWritePermitted && <th className="px-4 py-3 text-right w-[80px]"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80 text-xs text-slate-700 font-mono">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-black text-slate-900">{c.carNumber}</td>
                <td className="px-4 py-2.5 text-slate-600">{c.trailerNumber || '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{[c.brand, c.trailerBrand].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-4 py-2.5">{c.driverName || driverName(c.driverId) || '—'}</td>
                <td className="px-4 py-2.5">{dispName(c.dispatcher)}</td>
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
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={isWritePermitted ? 8 : 7} className="px-4 py-8 text-center text-xs text-slate-400">Пусто</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
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
                <SelectField label="Водитель" value={form.driverId} onChange={(v) => setForm({ ...form, driverId: v })}
                  options={drivers.map((d) => ({ v: d.id, l: d.shortNameRu || d.name || d.firstNameRu || d.id }))} />
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
        </div>
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
