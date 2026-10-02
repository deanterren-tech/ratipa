import {useState, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {getDriversFlat, getDispatchersFlat, getCouplingsFlat} from '../../../services/fleetService'
import {Users, Plus, Trash2, Pencil, Check, Layers, User} from 'lucide-react'
import {UserProfile, Driver} from '../../../types'
import DriverCard from '../DriverCard'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../../ui/components'

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

export default function DriverDirectoryBlock({ user, isWritePermitted = true }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [dispatchers, setDispatchers] = useState<any[]>([]);
  const [couplings, setCouplings] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [viewCard, setViewCard] = useState<{ type: 'driver'; driverId?: string; driverName?: string } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<'dispatcher' | null>(null);
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
    const u4 = getCouplingsFlat((l: any[]) => setCouplings(l || []));
    return () => { u1(); u2(); u4(); };
  }, []);

  const dispName = (id?: string) => {
    const d = dispatchers.find((x) => (x.id || x.key) === id);
    return d ? d.name : (id || '—');
  };
  const couplingOf = (id?: string) => {
    const c = couplings.find((x) => x.driverId === id);
    return c ? (c.carNumber || c.vehicleNumbers || '') : '—';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, '');
    return drivers.filter((d) => {
      if (!q) return true;
      return [d.name, d.phone, d.passport, d.personalId, dispName(d.dispatcher)]
        .join(' ').toLowerCase().replace(/\s+/g, '').includes(q);
    });
  }, [search, drivers, dispatchers]);

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
    const patch: Record<string, any> = { [bulkField]: bulkValue };
    if (bulkField === 'dispatcher') {
      // В записи храним имя для показа и идентификатор учётной записи для связи
      // (в значении селекта приходит идентификатор, а не имя).
      const entry = dispatchers.find((d) => (d.id || d.key) === bulkValue);
      const name = entry?.name || bulkValue;
      patch.dispatcher = name;
      patch.dispatcherName = name;
      patch.dispatcherId = entry ? (entry.id || entry.key) : null;
    }
    await dbService.bulkUpdateDrivers(ids, patch);
    toast(`Обновлено ${ids.length} водителей`, 'success');
    setBulkOpen(false); setBulkField(null); setBulkValue(''); setSelected(new Set());
  };

  const initials = (name?: string) => {
    if (!name) return '—';
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  };

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<Users className="w-4 h-4" />}
        tone="graphite"
        title="База водителей (ФИО, телефон, паспорт)"
        subtitle="Единый реестр водителей: ФИО, контакты, паспортные данные и привязка к диспетчеру."
      >
        {isWritePermitted && (
          <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Добавить водителя
          </button>
        )}
      </SectionHeader>

      {/* Counters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatRow color="graphite" label="Всего" value={drivers.length} />
        <StatRow color="emerald" label="С диспетчером" value={drivers.filter(d => d.dispatcher).length} />
        <StatRow color="amber" label="Без диспетчера" value={drivers.filter(d => !d.dispatcher).length} />
      </div>

      {/* SEARCH + multi-select */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Поиск по ФИО / телефону / паспорту…"
          ariaLabel="Поиск по водителям"
          className="max-w-md"
        />
        {isWritePermitted && (
          <button
            type="button"
            onClick={toggleAll}
            className={`${allVisibleSelected ? UI.buttonDark : UI.buttonGhost}`}
          >
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
          <button
            type="button"
            onClick={() => { setBulkField('dispatcher'); setBulkValue(''); setBulkOpen(true); }}
            className={UI.buttonGhost}
          >
            <User className="w-3.5 h-3.5" aria-hidden="true" /> Назначить диспетчера
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await showConfirm(`Удалить ${selected.size} водителей?`)) {
                for (const id of Array.from(selected)) dbService.deleteDriver(id, user.name, user.role);
                toast(`Удалено ${selected.size} водителей`, 'success');
                setSelected(new Set());
              }
            }}
            className={UI.buttonDanger}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Удалить
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-medium text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
          >
            Сбросить
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() ? undefined : 'Водителей пока нет'}
          hint={search.trim() ? undefined : 'Добавьте первого водителя — он появится в этом реестре.'}
          actionLabel={search.trim() || !isWritePermitted ? undefined : 'Добавить водителя'}
          onAction={search.trim() || !isWritePermitted ? undefined : openAdd}
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
                <th className={UI.th}>Водитель</th>
                <th className={UI.th}>Телефон</th>
                <th className={UI.th}>Паспорт</th>
                <th className={UI.th}>Личный №</th>
                <th className={UI.th}>Машина</th>
                {isWritePermitted && <th className={UI.th + ' text-right w-[80px]'}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const isSel = selected.has(d.id);
                return (
                  <tr
                    key={d.id}
                    onClick={() => setViewCard({ type: 'driver', driverId: d.id, driverName: d.name })}
                    className={`${UI.tr} cursor-pointer ${isSel ? 'bg-[var(--accent-10)]' : ''} ${focusIdx === i ? 'ring-2 ring-[var(--accent-50)] ring-inset' : ''}`}
                    onMouseEnter={() => setFocusIdx(i)}
                  >
                    {isWritePermitted && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(d.id)} aria-label={`Выбрать ${d.name}`} className={UI.checkbox} />
                      </td>
                    )}
                    <td className={UI.tdStrong}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setViewCard({ type: 'driver', driverId: d.id, driverName: d.name }); }}
                        className="inline-flex items-center gap-2 text-left hover:underline cursor-pointer max-w-[240px]"
                      >
                        <span className="w-5 h-5 rounded-full bg-[var(--accent-10)] text-[#A55329] flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {initials(d.name)}
                        </span>
                        <span className="truncate">{d.name || '—'}</span>
                      </button>
                    </td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{d.phone || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{d.passport || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{d.personalId || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{couplingOf(d.id)}</td>
                    {isWritePermitted && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(d); }} aria-label="Изменить" title="Изменить" className={UI.buttonIcon}>
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(d); }} aria-label="Удалить" title="Удалить"
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
          title={editing ? 'Редактировать водителя' : 'Новый водитель'}
          icon={<User className="w-4 h-4" aria-hidden="true" />}
          ariaLabel={editing ? 'Редактировать водителя' : 'Новый водитель'}
          footer={
            <>
              <button type="button" onClick={() => setModalOpen(false)} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={handleSave} className={UI.buttonPrimary}>Сохранить</button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="ФИО *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Иванов Иван Иванович" />
            <Field label="Телефон" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+375 29 …" />
            <Field label="Паспорт" value={form.passport} onChange={(v) => setForm({ ...form, passport: v })} placeholder="AB 1234567" />
            <Field label="Личный №" value={form.personalId} onChange={(v) => setForm({ ...form, personalId: v })} placeholder="ИНН / личный №" />
            <Field label="Вод. удостоверение" value={form.license} onChange={(v) => setForm({ ...form, license: v })} placeholder="Номер ВУ" />
            <Field label="Дата рождения" value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })} placeholder="01.01.1980" />
            <SelectField label="Диспетчер" value={form.dispatcher} onChange={(v) => setForm({ ...form, dispatcher: v })}
              options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
          </div>
        </ModalShell>,
        document.body
      )}

      {/* BULK modal */}
      {createPortal(
        <ModalShell
          isOpen={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title={`Назначить диспетчера (${selected.size})`}
          icon={<Layers className="w-4 h-4" aria-hidden="true" />}
          ariaLabel="Назначить диспетчера"
          maxWidth="max-w-sm"
          footer={
            <>
              <button type="button" onClick={() => setBulkOpen(false)} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={applyBulk} disabled={!bulkValue} className={UI.buttonPrimary}>Применить</button>
            </>
          }
        >
          <SelectField label="Диспетчер" value={bulkValue} onChange={setBulkValue}
            options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
        </ModalShell>,
        document.body
      )}

      {/* Driver card */}
      {viewCard?.type === 'driver' && createPortal(
        <DriverCard
          driverId={viewCard.driverId || ''}
          driverName={viewCard.driverName || ''}
          onClose={() => setViewCard(null)}
          onOpenCoupling={() => setViewCard(null)}
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

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={UI.fieldLabel}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${UI.select} w-full`}>
        <option value="">—</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
