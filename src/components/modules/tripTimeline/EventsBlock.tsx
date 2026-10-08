/**
 * События машины: ремонт / на базе / простой / другое.
 * CRUD: форма добавления (машина из базы сцепок, тип, даты, комментарий) и
 * список с правкой строк на месте (debounce, merge — поля не перетираются).
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { TimelineVehicleEvent, UserProfile } from '../../../types';
import { UI } from '../../../ui/kit';
import { EmptyState, SectionHeader } from '../../../ui/components';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import { dbService } from '../../../api';
import { formatPlate } from '../../../utils/salaryAutofill';
import CouplingPicker from '../../common/CouplingPicker';
import DateInput from './DateInput';
import { DEFAULT_EVENT_TYPES, eventTypeOf } from './lib/catalog';
import { dayNum, fmtFull, todayStr } from './lib/timeline';

interface Props {
  events: TimelineVehicleEvent[];
  user: UserProfile;
  canWrite: boolean;
}

const selectCls =
  'bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] disabled:opacity-60';

export default function EventsBlock({ events, user, canWrite }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  // Черновики строк: правки идут локально, в базу — с debounce
  const [drafts, setDrafts] = useState<Record<string, TimelineVehicleEvent>>({});
  const dirty = useRef<Set<string>>(new Set());
  const pending = useRef<Map<string, Partial<TimelineVehicleEvent>>>(new Map());
  const timers = useRef<Map<string, number>>(new Map());

  // Внешние изменения подтягиваем только для строк без незасохранённых правок
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, TimelineVehicleEvent> = {};
      events.forEach((ev) => {
        next[ev.id] = dirty.current.has(ev.id) && prev[ev.id] ? prev[ev.id] : ev;
      });
      return next;
    });
  }, [events]);

  // Уход со страницы — сохраняем всё, что в буфере
  useEffect(() => {
    const flushAll = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
      pending.current.forEach((patch, id) => {
        dbService.updateVehicleEvent(id, { ...patch, updatedAt: new Date().toISOString() });
      });
      pending.current.clear();
      dirty.current.clear();
    };
    return flushAll;
  }, []);

  const flushRow = (id: string) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    const patch = pending.current.get(id);
    if (patch) {
      pending.current.delete(id);
      dbService.updateVehicleEvent(id, { ...patch, updatedAt: new Date().toISOString() });
    }
    dirty.current.delete(id);
  };

  const editRow = (id: string, patch: Partial<TimelineVehicleEvent>) => {
    if (!canWrite) return;
    dirty.current.add(id);
    setDrafts((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
    const merged = { ...(pending.current.get(id) || {}), ...patch };
    pending.current.set(id, merged);
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.set(id, window.setTimeout(() => flushRow(id), 700));
  };

  // Форма добавления
  const [carNumber, setCarNumber] = useState('');
  const [vehicleId, setVehicleId] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState('repair');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const addEvent = () => {
    if (!canWrite) return;
    if (!carNumber.trim()) {
      setError('Укажите машину.');
      return;
    }
    if (!dateFrom) {
      setError('Укажите дату начала.');
      return;
    }
    if (dayNum(dateTo) != null && dayNum(dateFrom) != null && (dayNum(dateTo) as number) < (dayNum(dateFrom) as number)) {
      setError('Дата «по» раньше даты «с».');
      return;
    }
    const iso = new Date().toISOString();
    const ev: TimelineVehicleEvent = {
      id: `ve_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      vehicleId,
      carNumber: carNumber.trim(),
      kind,
      dateFrom,
      dateTo: dateTo || dateFrom,
      note: note.trim(),
      createdAt: iso,
      updatedAt: iso,
    };
    dbService.saveVehicleEvent(ev, user.name, user.role);
    toast('Событие добавлено', 'success');
    setCarNumber('');
    setVehicleId(undefined);
    setKind('repair');
    setDateFrom(todayStr());
    setDateTo('');
    setNote('');
    setError('');
  };

  const removeEvent = async (ev: TimelineVehicleEvent) => {
    if (!canWrite) return;
    if (!(await showConfirm(`Удалить событие «${eventTypeOf(ev.kind).name}» машины ${formatPlate(ev.carNumber)}?`))) return;
    flushRow(ev.id);
    dbService.deleteVehicleEvent(ev.id, user.name, user.role);
    toast('Событие удалено', 'success');
  };

  const sorted = [...events].sort((a, b) => (dayNum(b.dateFrom) || 0) - (dayNum(a.dateFrom) || 0));

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<Plus className="w-4 h-4" aria-hidden="true" />}
        tone="graphite"
        title="События машины: ремонт, база, простой"
        subtitle="Промежутки между рейсами без события показываются на таймлайне автоматически как «на базе»"
      >
        <span className={UI.countBadge}>{events.length}</span>
      </SectionHeader>

      {/* Форма добавления */}
      {canWrite ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end border border-[#E5E7EB] rounded-2xl bg-white p-4">
          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>Машина (из базы сцепок) *</label>
            <CouplingPicker
              value={carNumber}
              onSelect={(rec: { carNumber?: string; couplingId?: string; id?: string } | null) => {
                if (!rec) {
                  setCarNumber('');
                  setVehicleId(undefined);
                  return;
                }
                setCarNumber(rec.carNumber || '');
                setVehicleId(rec.couplingId || rec.id || undefined);
                setError('');
              }}
              mode="coupling"
              placeholder="Поиск сцепки…"
              compact
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>Тип</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${selectCls} py-1.5`}>
              {DEFAULT_EVENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>С</label>
            <DateInput value={dateFrom} onChange={setDateFrom} ariaLabel="Событие: дата с" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>По</label>
            <DateInput value={dateTo} onChange={setDateTo} ariaLabel="Событие: дата по" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>Комментарий</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="замена сцепления"
              className={UI.inputSm}
            />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={addEvent} className={UI.buttonPrimary}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Добавить
            </button>
          </div>
          {error ? <div className={`${UI.errorBox} lg:col-span-6 sm:col-span-2`}>{error}</div> : null}
        </div>
      ) : null}

      {/* Список событий */}
      {sorted.length === 0 ? (
        <EmptyState
          title="Событий нет"
          hint="Добавьте ремонт, простой или другое событие машины — оно появится на таймлайне."
        />
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left min-w-[860px]">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Машина</th>
                <th className={UI.th}>Тип</th>
                <th className={UI.th}>С</th>
                <th className={UI.th}>По</th>
                <th className={UI.th}>Комментарий</th>
                <th className={UI.th}>{''}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((raw) => {
                const ev = drafts[raw.id] || raw;
                const meta = eventTypeOf(ev.kind);
                return (
                  <tr key={ev.id} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors">
                    <td className={`${UI.tdStrong} whitespace-nowrap`}>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} aria-hidden="true" />
                        {formatPlate(ev.carNumber)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={ev.kind}
                        disabled={!canWrite}
                        onChange={(e) => editRow(ev.id, { kind: e.target.value })}
                        className={selectCls}
                      >
                        {DEFAULT_EVENT_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <DateInput
                        value={ev.dateFrom || ''}
                        disabled={!canWrite}
                        ariaLabel="Событие: дата с"
                        onChange={(v) => editRow(ev.id, { dateFrom: v })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <DateInput
                        value={ev.dateTo || ''}
                        disabled={!canWrite}
                        ariaLabel="Событие: дата по"
                        onChange={(v) => editRow(ev.id, { dateTo: v })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={ev.note || ''}
                        disabled={!canWrite}
                        onChange={(e) => editRow(ev.id, { note: e.target.value })}
                        placeholder="—"
                        className={`${UI.inputSm} w-[220px]`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {canWrite ? (
                        <button
                          type="button"
                          onClick={() => removeEvent(ev)}
                          aria-label="Удалить событие"
                          title="Удалить событие"
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={UI.hint + ' mt-2'}>
            Даты отображаются как ДД/ММ/ГГГГ, в базе хранятся строкой ГГГГ-ММ-ДД. Правки сохраняются автоматически.
            {sorted.length ? ` Диапазон: ${fmtFull(sorted[sorted.length - 1]?.dateFrom)} – ${fmtFull(sorted[0]?.dateTo || sorted[0]?.dateFrom)}.` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
