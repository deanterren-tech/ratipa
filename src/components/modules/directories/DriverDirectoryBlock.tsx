import {useState, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService, directoryService} from '../../../api'
import {getDriversFlat, getDispatchersFlat, getCouplingsFlat} from '../../../services/fleetService'
import {Users, Plus, Trash2, Pencil, Search, Check, Layers, Tag, User, X, Phone, FileText} from 'lucide-react'
import {UserProfile, Driver} from '../../../types'
import DriverCard from '../DriverCard'

interface Props {
  user: UserProfile;
  isWritePermitted?: boolean;
}

interface DriverRow {
  id: string;
  name: string;
  nameLat?: string;
  phone?: string;
  license?: string;
  passport?: string;
  personalId?: string;
  birthDate?: string;
  dispatcher?: string;
  rateGroupId?: string;
  coupling?: string;
}

const DISP_COLORS: Record<string, string> = {
  виталий: '#3765F6', матвей: '#8b5cf6', сергей: '#f59e0b', юрий: '#10b981',
};
const dispColor = (key?: string) => DISP_COLORS[(key || '').toLowerCase()] || '#64748b';

export default function DriverDirectoryBlock({ user, isWritePermitted = true }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [dispatchers, setDispatchers] = useState<any[]>([]);
  const [rateGroups, setRateGroups] = useState<any[]>([]);
  const [couplings, setCouplings] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const [activeDisp, setActiveDisp] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [viewCard, setViewCard] = useState<{ type: 'driver'; driverId?: string; driverName?: string } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<'dispatcher' | 'rateGroupId' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  useEffect(() => {
    const u1 = getDriversFlat((list: any[]) => {
      setDrivers((list || []).map((d) => ({
        id: d.id,
        name: d.name || d.nameRu || '',
        nameLat: d.nameLat || d.shortNameLat || '',
        phone: d.phone || '',
        license: d.license || '',
        passport: d.passport || '',
        personalId: d.personalId || '',
        birthDate: d.birthDate || '',
        dispatcher: d.dispatcher || '',
        rateGroupId: d.rateGroupId || '',
      })));
    });
    const u2 = getDispatchersFlat((l: any[]) => setDispatchers(l || []));
    const u3 = directoryService.getRateGroups((l: any[]) => setRateGroups(l || []));
    const u4 = getCouplingsFlat((l: any[]) => setCouplings(l || []));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const dispName = (id?: string) => {
    const d = dispatchers.find((x) => (x.id || x.key) === id);
    return d ? d.name : (id || '—');
  };
  const rateName = (id?: string) => {
    const g = rateGroups.find((x) => (x.id || x.key) === id);
    return g ? `${g.name} (€${g.rate}/км)` : '—';
  };
  const couplingOf = (id?: string) => {
    const c = couplings.find((x) => x.driverId === id);
    return c ? (c.carNumber || c.vehicleNumbers || '') : '—';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, '');
    return drivers.filter((d) => {
      if (activeDisp !== 'all' && d.dispatcher !== activeDisp) return false;
      if (!q) return true;
      return [d.name, d.phone, d.passport, d.personalId, dispName(d.dispatcher)]
        .join(' ').toLowerCase().replace(/\s+/g, '').includes(q);
    });
  }, [search, drivers, dispatchers, activeDisp]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', phone: '', license: '', passport: '', personalId: '', birthDate: '', dispatcher: '', rateGroupId: '' });
    setModalOpen(true);
  };
  const openEdit = (d: DriverRow) => {
    setEditing(d);
    setForm({
      name: d.name || '', phone: d.phone || '', license: d.license || '',
      passport: d.passport || '', personalId: d.personalId || '', birthDate: d.birthDate || '',
      dispatcher: d.dispatcher || '', rateGroupId: d.rateGroupId || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast('Укажите ФИО водителя', 'error');
      return;
    }
    const id = editing ? editing.id : `drv_${Date.now()}`;
    const rec: any = {
      id,
      name: form.name.trim(),
      phone: form.phone.trim(),
      license: form.license.trim(),
      passport: form.passport.trim(),
      personalId: form.personalId.trim(),
      birthDate: form.birthDate.trim(),
      dispatcher: form.dispatcher || '',
      rateGroupId: form.rateGroupId || '',
    };
    await dbService.saveDriver(rec as Driver, user.name, user.role);
    toast(editing ? 'Водитель обновлён' : 'Водитель добавлен', 'success');
    setModalOpen(false);
  };

  const handleDelete = async (d: DriverRow) => {
    if (await showConfirm(`Удалить водителя ${d.name}?`)) {
      dbService.deleteDriver(d.id, user.name, user.role);
      toast('Водитель удалён', 'success');
      setSelected((s) => { const n = new Set(s); n.delete(d.id); return n; });
    }
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) filtered.forEach((d) => n.delete(d.id));
    else filtered.forEach((d) => n.add(d.id));
    return n;
  });

  const applyBulk = async () => {
    if (!bulkField || !bulkValue) return;
    const ids = Array.from(selected);
    await dbService.bulkUpdateDrivers(ids, { [bulkField]: bulkValue });
    toast(`Обновлено ${ids.length} водителей`, 'success');
    setBulkOpen(false); setBulkField(null); setBulkValue(''); setSelected(new Set());
  };

  const initials = (name?: string) => {
    if (!name) return '—';
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  };

  return (
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-slate-200/60">
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
            База водителей
          </span>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Users className="w-7 h-7 text-slate-800" /> База водителей (ФИО, телефон, паспорт)
          </h1>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            Единый реестр водителей: ФИО, контакты, паспортные данные и привязка к диспетчеру.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <div className="flex items-center gap-2 bg-slate-900 text-white rounded-xl px-3 py-1.5">
              <Users className="w-3.5 h-3.5 text-slate-300" />
              <span className="text-[10px] font-semibold text-slate-300">Всего</span>
              <span className="text-sm font-black font-mono">{drivers.length}</span>
            </div>
            <div className="flex items-center gap-2 bg-[#3765F6] text-white rounded-xl px-3 py-1.5">
              <span className="text-[10px] font-semibold">С диспетчером</span>
              <span className="text-sm font-black font-mono">{drivers.filter(d => d.dispatcher).length}</span>
            </div>
            <div className="flex items-center gap-2 bg-amber-500 text-white rounded-xl px-3 py-1.5">
              <span className="text-[10px] font-semibold">Без диспетчера</span>
              <span className="text-sm font-black font-mono">{drivers.filter(d => !d.dispatcher).length}</span>
            </div>
          </div>
        </div>
        {isWritePermitted && (
          <button onClick={openAdd}
            className="mt-3 md:mt-0 inline-flex items-center gap-2 bg-[#3765F6] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-[#2a4fd0] shadow-sm active:scale-95">
            <Plus className="w-4 h-4" /> Добавить водителя
          </button>
        )}
      </div>

      {/* TABS по диспетчерам */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/60 max-w-max">
        <button onClick={() => setActiveDisp('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeDisp === 'all' ? 'bg-[#3765F6] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
          Все ({drivers.length})
        </button>
        {dispatchers.map((d) => {
          const cnt = drivers.filter((x) => x.dispatcher === (d.id || d.key)).length;
          const isActive = activeDisp === (d.id || d.key);
          return (
            <button key={d.id || d.key} onClick={() => setActiveDisp(d.id || d.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${isActive ? 'bg-[#3765F6] text-white shadow' : 'text-slate-600 hover:bg-white'}`}>
              {d.name}
              <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${isActive ? 'bg-white/20' : 'bg-slate-200'}`}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* SEARCH + multi-select */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ФИО / телефону / паспорту..."
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
            <User className="w-3.5 h-3.5" /> Назначить диспетчера
          </button>
          <button onClick={async () => {
            if (await showConfirm(`Удалить ${selected.size} водителей?`)) {
              for (const id of Array.from(selected)) dbService.deleteDriver(id, user.name, user.role);
              toast(`Удалено ${selected.size} водителей`, 'success');
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
              <th className="px-4 py-3 whitespace-nowrap">Водитель</th>
              <th className="px-4 py-3 whitespace-nowrap">Телефон</th>
              <th className="px-4 py-3 whitespace-nowrap">Паспорт</th>
              <th className="px-4 py-3 whitespace-nowrap">Личный №</th>
              <th className="px-4 py-3 whitespace-nowrap">Ставка</th>
              <th className="px-4 py-3 whitespace-nowrap">Машина</th>
              {isWritePermitted && <th className="px-4 py-3 text-right w-[80px]"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80 text-xs text-slate-700 font-mono">
            {filtered.map((d, i) => {
              const isSel = selected.has(d.id);
              return (
                <tr key={d.id} onClick={() => setViewCard({ type: 'driver', driverId: d.id, driverName: d.name })}
                  className={`hover:bg-slate-50/60 cursor-pointer transition ${isSel ? 'bg-[#3765F6]/10' : ''} ${focusIdx === i ? 'ring-2 ring-[#3765F6]/40 ring-inset' : ''}`} onMouseEnter={() => setFocusIdx(i)}>
                  {isWritePermitted && (
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(d.id)} className="accent-[#3765F6]" />
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <button onClick={(e) => { e.stopPropagation(); setViewCard({ type: 'driver', driverId: d.id, driverName: d.name }); }}
                      className="inline-flex items-center gap-1.5 text-left hover:underline font-medium text-slate-700">
                      <span className="w-5 h-5 rounded-full bg-[#3765F6]/15 text-[#3765F6] flex items-center justify-center text-[9px] font-black">
                        {initials(d.name)}
                      </span>
                      {d.name || '—'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{d.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{d.passport || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{d.personalId || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{rateName(d.rateGroupId)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{couplingOf(d.id)}</td>
                  {isWritePermitted && (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(d); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(d); }} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={isWritePermitted ? 8 : 7} className="px-4 py-8 text-center text-xs text-slate-400">Пусто</td></tr>
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
                <User className="w-4 h-4 text-[#3765F6]" />
                {editing ? 'Редактировать водителя' : 'Новый водитель'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="ФИО *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Иванов Иван Иванович" />
                <Field label="Телефон" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+375 29 ..." />
                <Field label="Паспорт" value={form.passport} onChange={(v) => setForm({ ...form, passport: v })} placeholder="AB 1234567" />
                <Field label="Личный №" value={form.personalId} onChange={(v) => setForm({ ...form, personalId: v })} placeholder="ИНН / личный №" />
                <Field label="Вод. удостоверение" value={form.license} onChange={(v) => setForm({ ...form, license: v })} placeholder="Номер ВУ" />
                <Field label="Дата рождения" value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })} placeholder="01.01.1980" />
                <SelectField label="Диспетчер" value={form.dispatcher} onChange={(v) => setForm({ ...form, dispatcher: v })}
                  options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
                <SelectField label="Группа ставок" value={form.rateGroupId} onChange={(v) => setForm({ ...form, rateGroupId: v })}
                  options={rateGroups.map((g) => ({ v: g.id || g.key, l: `${g.name} (€${g.rate}/км)` }))} />
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

      {/* Driver card */}
      {viewCard?.type === 'driver' && createPortal(
        <DriverCard
          driverId={viewCard.driverId || ''}
          driverName={viewCard.driverName || ''}
          onClose={() => setViewCard(null)}
          onOpenCoupling={(carNumber) => setViewCard(null)}
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

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-[#3765F6]">
        <option value="">—</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
