import {useState, useEffect, useMemo} from 'react'
import {createPortal} from 'react-dom'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService, directoryService} from '../../../api'
import {getDriversFlat, getDispatchersFlat, getCouplingsFlat} from '../../../services/fleetService'
import {Users, Plus, Trash2, Pencil, Check, Layers, User, Star, Calendar, AlertTriangle} from 'lucide-react'
import {UserProfile, Driver, PhoneNumber} from '../../../types'
import {
  driverFullName,
  driverPhones,
  isArchivedDriver,
  isServiceDriver,
  driverMatchesQuery,
  primaryPhone,
  sortDrivers,
  type DriverRecord,
} from '../../../utils/driverRegistry'
import DateTextInput from '../../common/DateTextInput'
import {toISODate} from '../../../utils/dateText'
import {formatDriverShortName} from '../../../utils/driverSync'
import DriverCard from '../DriverCard'
import VehicleCard from '../VehicleCard'
import {useFleetCardStack, fleetCardRefKey} from '../../../hooks/useFleetCards'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../../ui/components'

interface Props {
  user: UserProfile;
  isWritePermitted?: boolean;
}

const EMPTY_FORM: Record<string, string> = {
  lastNameRu: '', firstNameRu: '', middleNameRu: '',
  lastNameLat: '', firstNameLat: '', middleNameLat: '',
  passport: '', passportIssued: '', personalId: '', licenseNumber: '',
  birthDate: '', passportStart: '', passportEnd: '',
  dispatcher: '', rateGroupId: '', comment: '', archived: '',
};

/** Поле даты с подписью: дату можно ввести цифрами или выбрать в календаре; хранит ISO. */
function DriverDateField({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={UI.fieldLabel} htmlFor={`drv-date-${id}-text`}>{label}</label>
      <DateTextInput
        id={`drv-date-${id}`}
        value={value}
        onChange={onChange}
        label={label}
        textDataUi={`driver-date-${id}`}
      />
    </div>
  );
}

export default function DriverDirectoryBlock({ user, isWritePermitted = true }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [dispatchers, setDispatchers] = useState<any[]>([]);
  const [rateGroups, setRateGroups] = useState<any[]>([]);
  const [couplings, setCouplings] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DriverRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({...EMPTY_FORM});
  const [phones, setPhones] = useState<PhoneNumber[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // Полные карточки — общий стек портала (водитель → его машина).
  const {stack: cards, push: pushCard, pop: popCard} = useFleetCardStack();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState<'dispatcher' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  useEffect(() => {
    const u1 = getDriversFlat((list: any[]) => {
      setDrivers((list || []) as DriverRecord[]);
      setIsLoaded(true);
    });
    const u2 = getDispatchersFlat((l: any[]) => setDispatchers(l || []));
    const u4 = getCouplingsFlat((l: any[]) => setCouplings(l || []));
    const u5 = directoryService.getRateGroups((l: any[]) => setRateGroups(l || []));
    return () => { u1(); u2(); u4(); u5(); };
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
    const q = search.trim();
    const list = q
      ? drivers.filter((d) => driverMatchesQuery(d, q) || String(d.passport || '').toLowerCase().includes(q.toLowerCase()))
      : drivers;
    return sortDrivers(list);
  }, [search, drivers]);

  const openAdd = () => {
    setEditing(null);
    setForm({...EMPTY_FORM});
    setPhones([{ id: 'phone_1', number: '', isPrimary: true }]);
    setFormError('');
    setIsSaving(false);
    setModalOpen(true);
  };
  const openEdit = (d: DriverRecord) => {
    setEditing(d);
    setForm({
      ...EMPTY_FORM,
      lastNameRu: String(d.lastNameRu || ''), firstNameRu: String(d.firstNameRu || ''), middleNameRu: String(d.middleNameRu || ''),
      lastNameLat: String(d.lastNameLat || ''), firstNameLat: String(d.firstNameLat || ''), middleNameLat: String(d.middleNameLat || ''),
      passport: String(d.passport || d.passportNumber || ''), passportIssued: String(d.passportIssued || ''),
      personalId: String(d.personalId || ''), licenseNumber: String(d.licenseNumber || d.license || ''),
      birthDate: String(d.birthDate || ''), passportStart: String(d.passportStart || ''), passportEnd: String(d.passportEnd || ''),
      dispatcher: String(d.dispatcherId || d.dispatcherName || d.dispatcher || ''),
      rateGroupId: String(d.rateGroupId || ''), comment: String(d.comment || ''),
      archived: isArchivedDriver(d) ? '1' : '',
    });
    const existingPhones = driverPhones(d);
    setPhones(existingPhones.length > 0 ? existingPhones : [{ id: 'phone_1', number: '', isPrimary: true }]);
    setFormError('');
    setIsSaving(false);
    setModalOpen(true);
  };

  const addPhoneField = () => {
    setPhones((p) => [...p, {
      id: 'phone_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      number: '',
      isPrimary: p.length === 0,
    }]);
  };
  const updatePhoneField = (id: string, number: string) =>
    setPhones((p) => p.map((x) => (x.id === id ? { ...x, number } : x)));
  const setPrimaryPhone = (id: string) =>
    setPhones((p) => p.map((x) => ({ ...x, isPrimary: x.id === id })));
  const removePhoneField = (id: string) => {
    setPhones((p) => {
      const next = p.filter((x) => x.id !== id);
      if (next.length > 0 && !next.some((x) => x.isPrimary)) next[0].isPrimary = true;
      return next;
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    setFormError('');
    const lastRu = form.lastNameRu.trim();
    if (!lastRu) {
      setFormError('Укажите фамилию водителя.');
      return;
    }
    const firstRu = form.firstNameRu.trim();
    const midRu = form.middleNameRu.trim();
    const fullRu = [lastRu, firstRu, midRu].filter(Boolean).join(' ');
    const lastLat = form.lastNameLat.trim();
    const firstLat = form.firstNameLat.trim();
    const midLat = form.middleNameLat.trim();
    const fullLat = [lastLat, firstLat, midLat].filter(Boolean).join(' ');

    const cleanedPhones = phones
      .map((p) => ({ ...p, number: p.number.trim() }))
      .filter((p) => p.number !== '');
    if (cleanedPhones.length > 0 && !cleanedPhones.some((p) => p.isPrimary)) cleanedPhones[0].isPrimary = true;

    const id = editing ? String(editing.id) : 'drv_' + Date.now();
    const rec: any = {
      id,
      name: fullRu,
      lastNameRu: lastRu,
      firstNameRu: firstRu,
      middleNameRu: midRu,
      nameLat: fullLat,
      lastNameLat: lastLat,
      firstNameLat: firstLat,
      middleNameLat: midLat,
      shortNameRu: formatDriverShortName(lastRu, firstRu, midRu) || fullRu,
      shortNameLat: formatDriverShortName(lastLat, firstLat, midLat) || fullLat,
      phones: cleanedPhones,
      // phone — зеркало основного номера (его читают старые разделы);
      // источник — единое поле phones.
      phone: (cleanedPhones.find((p) => p.isPrimary) || cleanedPhones[0])?.number || '',
      passport: form.passport.trim(),
      passportIssued: form.passportIssued.trim(),
      personalId: form.personalId.trim(),
      licenseNumber: form.licenseNumber.trim(),
      license: form.licenseNumber.trim(),
      birthDate: toISODate(form.birthDate) || form.birthDate.trim(),
      passportStart: toISODate(form.passportStart) || form.passportStart.trim(),
      passportEnd: toISODate(form.passportEnd) || form.passportEnd.trim(),
      comment: form.comment.trim(),
      rateGroupId: form.rateGroupId || '',
      archived: form.archived === '1',
    };
    // Диспетчер — ссылка на учётную запись: id + имя (единая модель)
    const dispEntry = form.dispatcher ? dispatchers.find((d) => (d.id || d.key) === form.dispatcher) : null;
    rec.dispatcherId = dispEntry ? (dispEntry.id || dispEntry.key) : (form.dispatcher || '');
    rec.dispatcherName = dispEntry ? dispEntry.name : (form.dispatcher || '');
    rec.dispatcher = dispEntry ? dispEntry.name : (form.dispatcher || '');

    setIsSaving(true);
    try {
      dbService.saveDriver(rec as Driver, user.name, user.role);
      toast(editing ? 'Водитель обновлён' : 'Водитель добавлен', 'success');
      setModalOpen(false);
    } catch (err: any) {
      setFormError('Ошибка сохранения: ' + (err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (d: DriverRecord) => {
    if (await showConfirm(`Удалить водителя ${driverFullName(d)}?`)) {
      dbService.deleteDriver(String(d.id), user.name, user.role);
      toast('Водитель удалён', 'success');
      setSelected((s) => { const n = new Set(s); n.delete(String(d.id)); return n; });
    }
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selected.has(String(d.id)));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) filtered.forEach((d) => n.delete(String(d.id)));
    else filtered.forEach((d) => n.add(String(d.id)));
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
        subtitle="Единый реестр водителей: ФИО (рус/лат), контакты, паспортные данные и привязка к диспетчеру. Все списки выбора водителя строятся из этих записей."
      >
        {isWritePermitted && (
          <button type="button" onClick={openAdd} data-ui="driver-add" className={UI.buttonPrimary}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Добавить водителя
          </button>
        )}
      </SectionHeader>

      {/* Counters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatRow color="graphite" label="Всего" value={drivers.length} />
        <StatRow color="emerald" label="С диспетчером" value={drivers.filter(d => d.dispatcher || d.dispatcherName).length} />
        <StatRow color="amber" label="Без диспетчера" value={drivers.filter(d => !(d.dispatcher || d.dispatcherName)).length} />
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

      {!isLoaded ? (
        <div className={UI.loading} role="status">
          <span>Загрузка справочника водителей…</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() ? undefined : 'Водителей пока нет'}
          hint={search.trim() ? undefined : 'Добавьте первого водителя — он появится в этом реестре и во всех списках выбора.'}
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
                <th className={UI.th}>Диспетчер</th>
                <th className={UI.th}>Машина</th>
                {isWritePermitted && <th className={UI.th + ' text-right w-[80px]'}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const id = String(d.id);
                const isSel = selected.has(id);
                const name = driverFullName(d);
                const service = isServiceDriver(d);
                const archived = isArchivedDriver(d);
                return (
                  <tr
                    key={id}
                    data-ui="driver-row"
                    onClick={() => pushCard({ type: 'driver', driverId: id, driverName: name })}
                    className={`${UI.tr} cursor-pointer ${isSel ? 'bg-[var(--accent-10)]' : ''} ${focusIdx === i ? 'ring-2 ring-[var(--accent-50)] ring-inset' : ''}`}
                    onMouseEnter={() => setFocusIdx(i)}
                  >
                    {isWritePermitted && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(id)} aria-label={`Выбрать ${name}`} className={UI.checkbox} />
                      </td>
                    )}
                    <td className={UI.tdStrong}>
                      <div className="inline-flex items-center gap-2 max-w-[260px]">
                        <span className="w-5 h-5 rounded-full bg-[var(--accent-10)] text-[var(--accent-ink)] flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {initials(name)}
                        </span>
                        <span className="truncate">{name || '—'}</span>
                        {service && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600" title="Служебная запись — не человек; из списков выбора скрывается">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" /> служебная
                          </span>
                        )}
                        {archived && (
                          <span className="shrink-0 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md" title="Архивная запись — не предлагается в новых назначениях">архив</span>
                        )}
                      </div>
                    </td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{primaryPhone(d) || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{String(d.passport || '') || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{String(d.personalId || '') || '—'}</td>
                    <td className={UI.td}>{dispName(String(d.dispatcherId || d.dispatcherName || d.dispatcher || '')) || '—'}</td>
                    <td className={`${UI.td} font-mono whitespace-nowrap`}>{couplingOf(id)}</td>
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

      {/* Полные карточки — один стек: водитель → его машина. Нижние остаются
          смонтированными (hidden) — возврат сохраняет контекст и несохранённые
          изменения открытой формы редактирования. Рендерятся ДО форм, чтобы
          открытая из карточки форма была выше карточки. */}
      {cards.map((card, i) => {
        const isTop = i === cards.length - 1;
        const node = card.type === 'driver' ? (
          <DriverCard
            driverId={card.driverId}
            driverName={card.driverName}
            canEdit={isWritePermitted}
            onEdit={(id) => {
              const rec = drivers.find((d) => String(d.id) === String(id));
              if (rec) openEdit(rec);
            }}
            onClose={popCard}
            onOpenCoupling={(carNumber) => pushCard({ type: 'vehicle', carNumber })}
          />
        ) : (
          <VehicleCard
            carNumber={card.carNumber}
            vehicleId={card.vehicleId}
            canEdit={false}
            onOpenDriver={(driverId, driverName) => pushCard({ type: 'driver', driverId, driverName })}
            onClose={popCard}
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
          title={editing ? 'Редактировать водителя' : 'Новый водитель'}
          subtitle="Единая запись реестра: изменения сразу видны во всех разделах и списках выбора."
          icon={<User className="w-4 h-4" aria-hidden="true" />}
          ariaLabel={editing ? 'Редактировать водителя' : 'Новый водитель'}
          maxWidth="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={() => setModalOpen(false)} disabled={isSaving} className={UI.buttonGhost}>Отмена</button>
              <button type="button" onClick={handleSave} disabled={isSaving} data-ui="driver-save" className={UI.buttonPrimary}>
                {isSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            {/* 1. ФИО */}
            <div className="flex flex-col gap-3">
              <div className={UI.caption}>ФИО (русский)</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Фамилия *" value={form.lastNameRu} onChange={(v) => setForm({ ...form, lastNameRu: v })} placeholder="Иванов" dataUi="driver-last-ru" />
                <Field label="Имя" value={form.firstNameRu} onChange={(v) => setForm({ ...form, firstNameRu: v })} placeholder="Иван" dataUi="driver-first-ru" />
                <Field label="Отчество" value={form.middleNameRu} onChange={(v) => setForm({ ...form, middleNameRu: v })} placeholder="Иванович" dataUi="driver-middle-ru" />
              </div>
            </div>

            {/* 2. ФИО (латиница) */}
            <div className="flex flex-col gap-3">
              <div className={UI.caption}>ФИО (латиница)</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Фамилия" value={form.lastNameLat} onChange={(v) => setForm({ ...form, lastNameLat: v })} placeholder="IVANOV" />
                <Field label="Имя" value={form.firstNameLat} onChange={(v) => setForm({ ...form, firstNameLat: v })} placeholder="IVAN" />
                <Field label="Отчество" value={form.middleNameLat} onChange={(v) => setForm({ ...form, middleNameLat: v })} placeholder="IVANOVICH" />
              </div>
            </div>

            {/* 3. Телефоны — единый реестр телефонов водителя */}
            <div className="flex flex-col gap-3 bg-white border border-[#E5E7EB] rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5E7EB]">
                <span className={UI.fieldLabel}>Телефоны связи</span>
                <button type="button" onClick={addPhoneField} className={UI.buttonGhost} data-ui="driver-phone-add">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Добавить телефон</span>
                </button>
              </div>
              {phones.length === 0 ? (
                <div className="text-xs text-[#6B7280] italic py-3 text-center border border-dashed border-[#E5E7EB] rounded-xl">
                  Нет добавленных телефонов. Нажмите «Добавить телефон» выше.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {phones.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 bg-[#F9FAFB] p-2 border border-[#E5E7EB] rounded-xl">
                      <input
                        type="text"
                        value={p.number}
                        onChange={(e) => updatePhoneField(p.id, e.target.value)}
                        placeholder="+375 (29) 123-45-67"
                        aria-label="Номер телефона"
                        data-ui="driver-phone-input"
                        className={`${UI.input} flex-1 font-mono`}
                      />
                      <button
                        type="button"
                        onClick={() => setPrimaryPhone(p.id)}
                        className={
                          p.isPrimary
                            ? "inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-10)] text-[var(--accent-ink)] border border-[var(--accent-30)] transition-colors cursor-pointer shrink-0 min-h-[44px]"
                            : "inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white text-[#4B5563] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 min-h-[44px]"
                        }
                      >
                        {p.isPrimary
                          ? <><Star className="w-3 h-3" aria-hidden="true" /> Основной</>
                          : "Сделать основным"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhoneField(p.id)}
                        aria-label="Удалить телефон"
                        title="Удалить телефон"
                        className="inline-flex items-center justify-center p-2 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer min-h-[44px] min-w-[44px]"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Паспорт и документы */}
            <div className="flex flex-col gap-3">
              <div className={UI.caption}>Паспорт и документы</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DriverDateField id="birth" label="Дата рождения" value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })} />
                <Field label="Серия и номер паспорта" value={form.passport} onChange={(v) => setForm({ ...form, passport: v })} placeholder="МР 5065058" dataUi="driver-passport" />
                <Field label="Кем выдан" value={form.passportIssued} onChange={(v) => setForm({ ...form, passportIssued: v })} placeholder="Фрунзенским РУВД г. Минска" />
                <DriverDateField id="passport-start" label="Дата выдачи" value={form.passportStart} onChange={(v) => setForm({ ...form, passportStart: v })} />
                <DriverDateField id="passport-end" label="Срок действия (до)" value={form.passportEnd} onChange={(v) => setForm({ ...form, passportEnd: v })} />
                <Field label="Личный номер" value={form.personalId} onChange={(v) => setForm({ ...form, personalId: v })} placeholder="3080273A018PB6" dataUi="driver-personal-id" />
                <Field label="Вод. удостоверение" value={form.licenseNumber} onChange={(v) => setForm({ ...form, licenseNumber: v })} placeholder="Номер ВУ" />
              </div>
            </div>

            {/* 5. Организация */}
            <div className="flex flex-col gap-3">
              <div className={UI.caption}>Организация</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField label="Диспетчер" value={form.dispatcher} onChange={(v) => setForm({ ...form, dispatcher: v })}
                  options={dispatchers.map((d) => ({ v: d.id || d.key, l: d.name }))} />
                <SelectField label="Группа ставок" value={form.rateGroupId} onChange={(v) => setForm({ ...form, rateGroupId: v })}
                  options={rateGroups.map((g) => ({ v: g.id || g.key, l: `${g.name} (€${g.rate}/км)` }))} />
                <div className="sm:col-span-2">
                  <Field label="Комментарий" value={form.comment} onChange={(v) => setForm({ ...form, comment: v })} placeholder="Например: второй водитель, примечание" />
                </div>
                <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs font-medium text-[#4B5563] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.archived === '1'}
                    data-ui="driver-archived"
                    onChange={(e) => setForm({ ...form, archived: e.target.checked ? '1' : '' })}
                    className={UI.checkbox}
                  />
                  Архивная запись — не предлагать в новых назначениях (уже назначенный показывается с пометкой)
                </label>
              </div>
            </div>

            {formError ? (
              <div className="text-xs font-medium text-rose-600" role="alert" data-ui="driver-form-error">{formError}</div>
            ) : null}
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
