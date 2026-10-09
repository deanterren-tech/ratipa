/**
 * «СОБЫТИЯ РЕЙСА» — единый журнал событий внутри карточки целого рейса.
 *
 * Основной сценарий (замена отдельных полей «Комментарий к рейсу», «Причина»,
 * «Меры при просрочке» и дублирующего блока «События машины за период рейса»):
 *  - новое событие создаётся и редактируется ЗДЕСЬ, без отдельной вкладки;
 *  - событие содержит дату и одно большое поле «Что произошло и что сделали»
 *    (подсказка, авто-высота, переносы строк, безопасный текстовый рендер);
 *  - событие автоматически связано с рейсом и его машиной, необязательно — с
 *    этапом (компактная подпись этапа; даты этапа не меняются);
 *  - список от новых к старым, редактирование и удаление с подтверждением,
 *    длинные тексты сворачиваются («Развернуть»);
 *  - СТАРЫЕ данные не теряются: прежние «Причина», «Меры», «Комментарий к рейсу»
 *    и тексты этапов показываются отдельными записями с исходным контекстом и
 *    пометкой «Дата не указана»; кнопка «Указать дату» переносит текст в
 *    настоящее событие ОДНОЙ атомарной записью (событие + очистка источника) —
 *    повторное открытие карточки дублей не создаёт;
 *  - события машины без связи с рейсом не привязываются наугад: они показаны в
 *    отдельном списке и привязываются только явным действием;
 *  - сохранение в модели карточки: несохранённый черновик виден, при ошибке
 *    черновик остаётся, при закрытии карточки с несохранённым текстом — вопрос
 *    подтверждения (общий механизм карточки); после сохранения журнал и маркеры
 *    на таймлайне обновляются подпиской, без перезагрузки.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, Link2, TriangleAlert } from 'lucide-react';
import type { TimelineStage, TimelineStageType, TimelineVehicleEvent, UserProfile } from '../../../types';
import { UI } from '../../../ui/kit';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import { dbService } from '../../../api';
import DateInput from './DateInput';
import { eventTypeOf, stageFullName } from './lib/catalog';
import { dayNum, fmtFull, todayStr } from './lib/timeline';
import type { WholeTrip } from './lib/sources';

const TEXTAREA_CLS =
  'w-full min-h-[68px] resize-y bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs leading-5 text-[#121316] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60 disabled:bg-[#F9FAFB]';

/** Многострочное поле с автоматической высотой (абзацы и длинные тексты). */
function AutoGrow({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
  rows = 3,
  dataUi,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  rows?: number;
  dataUi?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, rows * 22)}px`;
  }, [value, rows]);
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-ui={dataUi}
      onChange={(e) => onChange(e.target.value)}
      className={TEXTAREA_CLS}
    />
  );
}

interface JournalEventForm {
  /** id правимого события; null — новое. */
  id: string | null;
  date: string;
  stageId: string;
  text: string;
}

interface LegacyEntry {
  key: string;
  field: 'reason' | 'measures' | 'comment';
  /** «Причина», «Меры», «Комментарий к рейсу» или «Причина (этап «…»)». */
  label: string;
  text: string;
  stageId?: string;
}

interface ClarifyState {
  entry: LegacyEntry;
  date: string;
  error: string;
}

const shortDate = (iso?: string): string => (dayNum(iso) != null ? fmtFull(iso) : 'Дата не указана');
const sigOf = (e: TimelineVehicleEvent): string => `${e.dateFrom || ''}|${e.note || ''}|${e.stageId || ''}`;

interface Props {
  trip: WholeTrip;
  stageTypes: TimelineStageType[];
  /** Этапы текущего рейса (черновик карточки) — для выбора и старых текстов. */
  stages: TimelineStage[];
  /** Все события машины (связанные и без связи). */
  events: TimelineVehicleEvent[];
  /** Прежние общие тексты рейса (причина / меры / комментарий). */
  meta: { reason: string; measures: string; comment: string };
  canWrite: boolean;
  /** Архив — только просмотр. */
  readOnly: boolean;
  user: UserProfile;
  /** Переход с маркера таймлайна: id события для прокрутки и подсветки. */
  focusEventId?: string | null;
  onFocusEventDone?: () => void;
  /** Запрос «Добавить событие по этапу» из таблицы этапов. */
  formRequest?: { stageId?: string; nonce: number } | null;
  onFormRequestHandled?: () => void;
  /** Несохранённый черновик журнала — для предупреждения при закрытии карточки. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Оптимистичная очистка прежних текстов после переноса. */
  onClearLegacyStage?: (stageId: string, field: 'reason' | 'action') => void;
  onClearLegacyMeta?: (field: 'reason' | 'measures' | 'comment') => void;
}

export default function TripEventsJournal({
  trip,
  stageTypes,
  stages,
  events,
  meta,
  canWrite,
  readOnly,
  user,
  focusEventId,
  onFocusEventDone,
  formRequest,
  onFormRequestHandled,
  onDirtyChange,
  onClearLegacyStage,
  onClearLegacyMeta,
}: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const blockRef = useRef<HTMLDivElement | null>(null);

  const writable = canWrite && !readOnly;

  const [form, setForm] = useState<JournalEventForm | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [clarify, setClarify] = useState<ClarifyState | null>(null);
  const [unlinkedDate, setUnlinkedDate] = useState<Record<string, string>>({});

  /** Ожидание подтверждения записи: пока событие не появилось в подписке, черновик живёт. */
  const pendingRef = useRef<{ id: string; sig: string; mode: 'save' | 'migrate' } | null>(null);
  const timerRef = useRef<number | null>(null);

  const linked = useMemo(() => events.filter((e) => e.tripKey === trip.key), [events, trip.key]);
  const unlinked = useMemo(() => events.filter((e) => !e.tripKey), [events]);

  const sortedLinked = useMemo(
    () =>
      [...linked].sort(
        (a, b) =>
          (dayNum(b.dateFrom) || 0) - (dayNum(a.dateFrom) || 0) ||
          String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
          String(b.id).localeCompare(String(a.id)),
      ),
    [linked],
  );

  const stageById = useMemo(() => {
    const m = new Map<string, TimelineStage>();
    stages.forEach((s) => m.set(s.id, s));
    return m;
  }, [stages]);

  const stageOptionLabel = useCallback(
    (s: TimelineStage) => `${stageFullName(stageTypes, s)}${s.plannedDate ? ` · план ${fmtFull(s.plannedDate)}` : ''}`,
    [stageTypes],
  );

  const stageCaption = useCallback(
    (stageId?: string): string => {
      if (!stageId) return '';
      const s = stageById.get(stageId);
      return s ? `Этап: ${stageFullName(stageTypes, s)}` : 'Этап: связь с этапом не найдена';
    },
    [stageById, stageTypes],
  );

  /** Счётчики событий по этапам — для таблицы этапов. */
  // (счётчики считает карточка рейса из тех же events)

  /** Прежние тексты, сохранённые до журнала: причина/меры рейса и тексты этапов. */
  const legacy: LegacyEntry[] = useMemo(() => {
    const out: LegacyEntry[] = [];
    if (meta.comment.trim()) out.push({ key: 'meta:comment', field: 'comment', label: 'Комментарий к рейсу', text: meta.comment.trim() });
    if (meta.reason.trim()) out.push({ key: 'meta:reason', field: 'reason', label: 'Причина', text: meta.reason.trim() });
    if (meta.measures.trim()) out.push({ key: 'meta:measures', field: 'measures', label: 'Меры', text: meta.measures.trim() });
    stages.forEach((s) => {
      if (s.reason && s.reason.trim()) {
        out.push({ key: `stage:${s.id}:reason`, field: 'reason', stageId: s.id, label: `Причина (этап «${stageFullName(stageTypes, s)}»)`, text: s.reason.trim() });
      }
      if (s.action && s.action.trim()) {
        out.push({ key: `stage:${s.id}:action`, field: 'measures', stageId: s.id, label: `Меры (этап «${stageFullName(stageTypes, s)}»)`, text: s.action.trim() });
      }
    });
    return out;
  }, [meta, stages, stageTypes]);

  // Черновик журнала — часть несохранённых изменений карточки.
  useEffect(() => {
    onDirtyChange?.(!!form || !!clarify || !!pendingRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, clarify, saving]);

  // Подтверждение записи: событие появилось в подписке с ожидаемым содержимым.
  useEffect(() => {
    const p = pendingRef.current;
    if (!p) return;
    const found = events.find((e) => e.id === p.id);
    if (!found || sigOf(found) !== p.sig) return;
    pendingRef.current = null;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSaving(false);
    setForm(null);
    setFormError('');
    setClarify(null);
    toast(p.mode === 'migrate' ? 'Старые сведения перенесены в событие' : 'Событие сохранено', 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  /** Запись отправлена, но подписка ещё не подтвердила: черновик не теряем. */
  const startWaiting = useCallback(
    (ev: TimelineVehicleEvent, mode: 'save' | 'migrate') => {
      pendingRef.current = { id: ev.id, sig: sigOf(ev), mode };
      if (dbService.isOnline()) {
        setSaving(true);
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          if (!pendingRef.current) return;
          pendingRef.current = null;
          setSaving(false);
          setFormError('Не удалось подтвердить сохранение — черновик остался здесь, повторите попытку.');
          toast('Сохранение не подтвердилось — текст сохранён в черновике', 'error');
        }, 6000);
      }
    },
    [toast],
  );

  /** Новое событие журнала: связь с рейсом и машиной задана явно. */
  const buildEvent = (fields: { id: string; date: string; stageId: string; text: string }): TimelineVehicleEvent => {
    const iso = new Date().toISOString();
    return {
      id: fields.id,
      vehicleId: trip.vehicleId,
      carNumber: trip.carNumber,
      kind: 'other',
      dateFrom: fields.date,
      dateTo: fields.date,
      note: fields.text,
      tripKey: trip.key,
      ...(fields.stageId ? { stageId: fields.stageId } : {}),
      createdAt: iso,
      updatedAt: iso,
    };
  };

  const openAddForm = useCallback(
    (stageId?: string) => {
      if (!writable) return;
      const stage = stageId ? stageById.get(stageId) : undefined;
      const prefill = stage?.actualDate || stage?.plannedDate || todayStr();
      setForm({ id: null, date: prefill, stageId: stageId || '', text: '' });
      setFormError('');
    },
    [writable, stageById],
  );

  // Запрос из таблицы этапов: открыть форму с предвыбранным этапом.
  useEffect(() => {
    if (!formRequest) return;
    openAddForm(formRequest.stageId);
    onFormRequestHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRequest?.nonce]);

  const openEditForm = (e: TimelineVehicleEvent) => {
    if (!writable) return;
    setForm({ id: e.id, date: e.dateFrom || '', stageId: e.stageId || '', text: e.note || '' });
    setFormError('');
  };

  const submitForm = () => {
    if (!form || saving) return;
    const text = form.text.trim();
    if (dayNum(form.date) == null) {
      setFormError('Укажите дату события.');
      return;
    }
    if (!text) {
      setFormError('Опишите, что произошло и что сделали.');
      return;
    }
    setFormError('');
    const id = form.id || `ve_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (form.id) {
      // Правка: merge, содержимое доступно полностью, связь с рейсом не меняется.
      const patch = { dateFrom: form.date, dateTo: form.date, note: text, stageId: form.stageId || null, updatedAt: new Date().toISOString() };
      dbService.updateVehicleEvent(form.id, patch);
      if (dbService.isOnline()) {
        startWaiting({ ...buildEvent({ id, date: form.date, stageId: form.stageId, text }), createdAt: '' }, 'save');
      } else {
        setForm(null);
        toast('Событие сохранено', 'success');
      }
      return;
    }
    const ev = buildEvent({ id, date: form.date, stageId: form.stageId, text });
    dbService.saveVehicleEvent(ev, user.name, user.role);
    if (dbService.isOnline()) {
      startWaiting(ev, 'save');
    } else {
      setForm(null);
      toast('Событие добавлено', 'success');
    }
  };

  const removeEvent = async (e: TimelineVehicleEvent) => {
    if (!writable) return;
    const ok = await showConfirm(`Удалить событие от ${shortDate(e.dateFrom)}?${e.note ? `\n\n«${e.note.slice(0, 160)}${e.note.length > 160 ? '…' : ''}»` : ''}`);
    if (!ok) return;
    dbService.deleteVehicleEvent(e.id, user.name, user.role);
    toast('Событие удалено', 'success');
  };

  /** Перенос старого текста в настоящее событие: одна атомарная запись, без дублей. */
  const convertLegacy = () => {
    if (!clarify || saving) return;
    const { entry, date } = clarify;
    if (dayNum(date) == null) {
      setClarify({ ...clarify, error: 'Укажите дату события.' });
      return;
    }
    const id = `ve_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ev: TimelineVehicleEvent = {
      id,
      vehicleId: trip.vehicleId,
      carNumber: trip.carNumber,
      kind: 'other',
      dateFrom: date,
      dateTo: date,
      note: `${entry.label}: ${entry.text}`,
      tripKey: trip.key,
      ...(entry.stageId ? { stageId: entry.stageId } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const clearPath = entry.stageId
      ? trip.kind === 'plan'
        ? `tripTimeline/tripStages/${trip.plan?.id || ''}/${entry.stageId}/${entry.field === 'measures' ? 'action' : entry.field}`
        : `tripTimeline/trips/${trip.id}/stages/${entry.stageId}/${entry.field === 'measures' ? 'action' : entry.field}`
      : `tripTimeline/tripMeta/${trip.key}/${entry.field}`;
    dbService.migrateLegacyToEvent(ev, [clearPath], user.name, user.role);
    // Оптимистичная очистка источника в текущем черновике карточки.
    if (entry.stageId) onClearLegacyStage?.(entry.stageId, entry.field === 'measures' ? 'action' : 'reason');
    else onClearLegacyMeta?.(entry.field);
    setClarify(null);
    if (dbService.isOnline()) {
      startWaiting(ev, 'migrate');
    } else {
      toast('Старые сведения перенесены в событие', 'success');
    }
  };

  const bindUnlinked = async (e: TimelineVehicleEvent) => {
    if (!writable) return;
    const ok = await showConfirm(
      `Привязать событие от ${shortDate(e.dateFrom)} к рейсу${trip.route ? ` «${trip.route}»` : ` ${trip.carNumber}`}? Связь с другим рейсом не подставляется автоматически.`,
    );
    if (!ok) return;
    dbService.updateVehicleEvent(e.id, { tripKey: trip.key, updatedAt: new Date().toISOString() });
    toast('Событие привязано к рейсу', 'success');
  };

  const saveUnlinkedDate = (e: TimelineVehicleEvent) => {
    const v = unlinkedDate[e.id] || '';
    if (dayNum(v) == null) {
      toast('Укажите дату события', 'error');
      return;
    }
    dbService.updateVehicleEvent(e.id, { dateFrom: v, dateTo: v, updatedAt: new Date().toISOString() });
    toast('Дата события сохранена', 'success');
  };

  // Переход с маркера таймлайна: прокрутка к записи и краткая подсветка.
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusEventId) return;
    setExpandedIds((prev) => {
      if (prev.has(focusEventId)) return prev;
      const next = new Set(prev);
      next.add(focusEventId);
      return next;
    });
    setHighlightId(focusEventId);
    window.requestAnimationFrame(() => {
      const el = focusRef.current?.querySelector(`[data-ev="${focusEventId}"]`) || blockRef.current?.querySelector(`[data-ev="${focusEventId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = window.setTimeout(() => setHighlightId((cur) => (cur === focusEventId ? null : cur)), 2200);
    onFocusEventDone?.();
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId]);

  const renderEventRow = (e: TimelineVehicleEvent) => {
    const text = e.note || '';
    const long = text.length > 240;
    const expanded = expandedIds.has(e.id);
    const highlighted = highlightId === e.id;
    return (
      <div
        key={e.id}
        data-ev={e.id}
        data-ui="event-row"
        className={`px-3 py-2.5 flex flex-col gap-1.5 border-b border-[#E5E7EB] last:border-b-0 transition-colors ${
          highlighted ? 'bg-[var(--accent-10)] ring-1 ring-inset ring-[var(--accent-30)]' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          <span className="font-semibold text-[#121316] tabular-nums">{shortDate(e.dateFrom)}</span>
          {e.stageId ? <span className={UI.chip}>{stageCaption(e.stageId)}</span> : null}
          {writable ? (
            <span className="flex items-center gap-0.5 ml-auto">
              <button
                type="button"
                data-ui="event-edit"
                onClick={() => openEditForm(e)}
                title="Редактировать событие"
                aria-label="Редактировать событие"
                className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-ui="event-delete"
                onClick={() => removeEvent(e)}
                title="Удалить событие"
                aria-label="Удалить событие"
                className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>
        <div className={`text-xs text-[#4B5563] whitespace-pre-wrap break-words ${long && !expanded ? 'line-clamp-4' : ''}`}>{text}</div>
        {long ? (
          <button
            type="button"
            data-ui="event-expand"
            onClick={() =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(e.id)) next.delete(e.id);
                else next.add(e.id);
                return next;
              })
            }
            className="self-start inline-flex items-center gap-1 text-[11px] text-[var(--accent-ink)] hover:bg-[var(--accent-10)] rounded-md px-1.5 py-0.5 transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
            {expanded ? 'Свернуть' : 'Развернуть'}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={blockRef} data-ui="trip-events" className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <span className={UI.sectionTitle}>События рейса</span>
          <span className={UI.countBadge}>{linked.length}</span>
        </span>
        <span className="text-[10px] text-[#9CA3AF]">
          события связаны именно с этим рейсом и его машиной; этап — необязательно
        </span>
      </div>

      {writable ? (
        <div>
          <button type="button" data-ui="add-event" onClick={() => openAddForm()} className={UI.buttonGhost}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Добавить событие
          </button>
        </div>
      ) : null}

      {/* Форма добавления / редактирования — внутри журнала, без вложенных окон */}
      {form && writable ? (
        <div data-ui="event-form" className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-2.5 bg-[#F9FAFB]">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={UI.fieldLabel}>Дата события</span>
              <span data-ui="event-date">
                <DateInput value={form.date} onChange={(v) => setForm((f) => (f ? { ...f, date: v } : f))} ariaLabel="Дата события" />
              </span>
            </label>
            <label className="flex flex-col gap-1 min-w-[220px]">
              <span className={UI.fieldLabel}>Этап рейса (необязательно)</span>
              <select
                data-ui="event-stage"
                value={form.stageId}
                onChange={(e) => setForm((f) => (f ? { ...f, stageId: e.target.value } : f))}
                className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] max-w-[320px]"
              >
                <option value="">— не связан с этапом —</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {stageOptionLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={UI.fieldLabel}>Что произошло и что сделали</span>
            <AutoGrow
              value={form.text}
              onChange={(v) => setForm((f) => (f ? { ...f, text: v } : f))}
              ariaLabel="Что произошло и что сделали"
              placeholder="Опишите ситуацию, причину, предпринятые действия и результат"
              rows={3}
              dataUi="event-text"
            />
          </label>
          {formError ? (
            <div className={UI.errorBox} role="alert">
              <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
              {formError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-ui="event-save" onClick={submitForm} disabled={saving} className={UI.buttonPrimary}>
              {saving ? 'Сохраняется…' : form.id ? 'Сохранить изменения' : 'Сохранить событие'}
            </button>
            <button
              type="button"
              data-ui="event-cancel"
              onClick={() => {
                setForm(null);
                setFormError('');
              }}
              className={UI.buttonGhost}
            >
              Отмена
            </button>
            <span className="text-[10px] text-[#9CA3AF]">переносы строк и длинные тексты сохраняются полностью</span>
          </div>
        </div>
      ) : null}

      {/* Журнал: от новых к старым */}
      <div ref={focusRef} className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB] bg-white">
        {sortedLinked.length ? (
          sortedLinked.map(renderEventRow)
        ) : (
          <div data-ui="events-empty" className="px-3 py-4 text-center">
            <div className="text-xs font-medium text-[#4B5563]">События пока не добавлены</div>
            <div className="text-[11px] text-[#6B7280] mt-1">
              Добавьте событие — дата появится компактным маркером на таймлайне, а запись — в этом журнале.
            </div>
          </div>
        )}
      </div>
      {sortedLinked.length ? (
        <p className="text-[10px] text-[#9CA3AF] -mt-1.5">
          Показаны от новых к старым; при одинаковых датах порядок стабилен. Длинные записи сворачиваются кнопкой «Развернуть».
        </p>
      ) : null}

      {/* Прежние сведения (до журнала): показываются с исходным контекстом, без выдуманных дат */}
      {legacy.length ? (
        <div data-ui="legacy-entries" className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-[#6B7280]">
            Ранее внесённые сведения ({legacy.length}) — перенесены в журнал безопасно
          </span>
          <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB] bg-[#F9FAFB]">
            {legacy.map((entry) => (
              <div key={entry.key} data-ui="legacy-entry" className="px-3 py-2.5 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                  <span className="font-semibold text-[#121316]">{entry.label}</span>
                  <span className="text-[10px] font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                    Дата не указана
                  </span>
                  {writable ? (
                    <button
                      type="button"
                      data-ui="legacy-clarify"
                      onClick={() => setClarify({ entry, date: '', error: '' })}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--accent-ink)] hover:bg-[var(--accent-10)] rounded-md px-1.5 py-1 transition-colors cursor-pointer"
                    >
                      Указать дату
                    </button>
                  ) : null}
                </div>
                <div className="text-xs text-[#4B5563] whitespace-pre-wrap break-words">{entry.text}</div>
                {clarify && clarify.entry.key === entry.key ? (
                  <div data-ui="legacy-form" className="flex flex-wrap items-end gap-2 pt-1">
                    <label className="flex flex-col gap-1">
                      <span className={UI.fieldLabel}>Дата произошедшего</span>
                      <span data-ui="legacy-date">
                        <DateInput value={clarify.date} onChange={(v) => setClarify((c) => (c ? { ...c, date: v, error: '' } : c))} ariaLabel="Дата переносимого сведения" />
                      </span>
                    </label>
                    <button type="button" data-ui="legacy-convert" onClick={convertLegacy} disabled={saving} className={UI.buttonPrimary}>
                      Перенести в событие
                    </button>
                    <button type="button" data-ui="legacy-cancel" onClick={() => setClarify(null)} className={UI.buttonGhost}>
                      Отмена
                    </button>
                    {clarify.error ? <span className="text-[11px] text-rose-600">{clarify.error}</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#9CA3AF]">
            Текст не мигрирует сам: при переносе он одной записью становится событием, а исходное поле очищается — дублей при повторном открытии нет.
          </p>
        </div>
      ) : null}

      {/* События машины без связи с рейсом: не привязываются наугад */}
      {unlinked.length ? (
        <div data-ui="unlinked-events" className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-[#6B7280]">
            События машины без привязки к рейсу ({unlinked.length}) — связь не подставлялась автоматически
          </span>
          <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB] bg-white">
            {unlinked.map((e) => {
              const metaE = eventTypeOf(e.kind);
              return (
                <div key={e.id} data-ui="unlinked-event" className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#121316]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: metaE.color }} aria-hidden="true" />
                    {metaE.name}
                  </span>
                  <span className={dayNum(e.dateFrom) != null ? 'text-[#6B7280] tabular-nums' : 'text-[#B45309] font-medium'}>
                    {shortDate(e.dateFrom)}
                  </span>
                  {e.note ? <span className="text-[#6B7280] break-words min-w-0">{e.note}</span> : null}
                  {writable ? (
                    <span className="flex flex-wrap items-center gap-2 ml-auto">
                      {dayNum(e.dateFrom) == null ? (
                        <>
                          <span data-ui="unlinked-date">
                            <DateInput value={unlinkedDate[e.id] || ''} onChange={(v) => setUnlinkedDate((m) => ({ ...m, [e.id]: v }))} ariaLabel="Уточнить дату события машины" />
                          </span>
                          <button type="button" data-ui="unlinked-save-date" onClick={() => saveUnlinkedDate(e)} className={UI.buttonGhost}>
                            Сохранить дату
                          </button>
                        </>
                      ) : null}
                      <button type="button" data-ui="unlinked-bind" onClick={() => bindUnlinked(e)} title="Привязать событие к этому рейсу" className={UI.buttonGhost}>
                        <Link2 className="w-4 h-4" aria-hidden="true" />
                        Привязать к этому рейсу
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-[#9CA3AF]">
            Старые события машины сохранены как есть и не привязываются по совпадению дат — у машины бывают соседние рейсы.
          </p>
        </div>
      ) : null}
    </div>
  );
}
