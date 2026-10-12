/**
 * Окно «Учёт выезда / период на базе» для КОНКРЕТНОЙ машины и периода.
 *
 * Открывается по единому хелперу openDepartureAccountingPanel (lib/vyezd) из
 * всех мест: полос/отметок таймлайна, встроенного таймлайна карточек, обзора
 * машины, прямой ссылки. Окно живёт и в модуле «Учёт выезда» (BazaModule), и
 * ПОВЕРХ «Таймлайна рейсов» (editMode='module') — компонент один.
 *
 * v2 «Компактная карточка» (данные и формулы не менялись):
 *  - одна карточка БЕЗ общей прокрутки: шапка (номер, водитель, статус-бейдж),
 *    тип периода «На базе / В ремонте» (существующие поля dateRepairStart/End,
 *    без миграций), поля приезд / срок готовности / фактический выезд, одна
 *    строка итога и «Примечание»; кнопки «Сохранить» и «Машина выехала»
 *    (ставит сегодняшнюю дату) и «Закрыть»;
 *  - вся диагностика (пояснения, стыки с рейсами, конфликты, мини-таймлайн,
 *    сводка, список записей, вход в полный учёт и к рейсу) — в СВОРАЧИВАЕМОМ
 *    блоке «Подробнее», по умолчанию ЗАКРЫТОМ; ничего не выброшено;
 *  - ремонт: лента событий (вложенная ветка `baza/<id>/events` — RTDB, не
 *    Firestore) с добавлением/правкой/удалением и явным предложением сдвига
 *    срока готовности из события «Ждём запчасть» (без автосдвига).
 *
 * Расчёты (дни, сроки, статусы, сводка) — существующие функции lib/sources и
 * lib/vyezd; правка периода пишет те же поля и тот же журнал, что модуль.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  CircleCheck,
  ExternalLink,
  Hourglass,
  ListChecks,
  Pencil,
  Plus,
  Route,
  Save,
  Trash2,
  TriangleAlert,
  Truck,
  Wrench,
} from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { buildDispatcherDirectory } from '../../../utils/dispatcher';
import { resolvePermission } from '../../../utils/permissions';
import type { AppSettings, UserProfile } from '../../../types';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import { useTimelineData } from './useTimelineData';
import { CarMiniTimeline } from './TripCard';
import { DateInput } from './DateInput';
import { useWindowHotkeys } from './lib/useWindowHotkeys';
import {
  bazaToBasePeriods,
  baseBarRange,
  baseDeviation,
  buildCarIndex,
  repairBarRange,
  type BasePeriod,
  type WholeTrip,
} from './lib/sources';
import { dayStr, fmtDM, fmtFull, tripSpan } from './lib/timeline';
import {
  nearestPeriodOf,
  replaceVyezdHash,
  tripRangeOf,
  VYEZD_STATUS,
  vyezdStatusOf,
  vyezdSummaryOf,
  type ParsedVyezdRoute,
} from './lib/vyezd';
import {
  pendingWaitEvent,
  proposedReadyShift,
  repairEventDotColor,
  repairEventLabel,
  REPAIR_EVENT_TYPES,
  type RepairEvent,
} from './lib/repairEvents';
import {
  addRepairEvent,
  applyWaitEventShift,
  deleteRepairEvent,
  PERIOD_FIELD_LABELS,
  ruDate,
  savePeriodFields,
  updateRepairEvent,
  type PeriodHistoryEntry,
} from './lib/periodEdit';

interface Props {
  /** Разобранный маршрут окна (#baza/vyezd/...). */
  target: ParsedVyezdRoute;
  /** Исходная запись из данных модуля «Учёт выезда» (любая его ветка), если есть. */
  record?: Record<string, unknown> | null;
  today: number;
  user: UserProfile;
  settings?: AppSettings | null;
  /** Право правки учёта выезда (write) — при его отсутствии окно только для чтения. */
  canEdit: boolean;
  /** Поверх окна открыта существующая карточка записи — Esc закрывает её первой. */
  editorOpen: boolean;
  onEditRecord: (recordId: string) => void;
  onOpenTrip: (tripKey: string) => void;
  /** Полный «Учёт выезда»: закрыть окно и показать запись в списке (прокрутка+подсветка). */
  onOpenFull: (recordId: string | null) => void;
  onClose: () => void;
  /** Переключить окно на другую запись этой машины (список записей, мини-таймлайн). */
  onSwitchPeriod: (periodId: string) => void;
  /** Замена адреса окна при переключении периода: хост решает маршрут
   *  (BazaModule — #baza/vyezd/…; таймлайн — #tripTimeline/vehicle/…/departure/…).
   *  Не задан — используется штатный baza-маршрут (поведение модуля не меняется). */
  onReplaceTarget?: (t: { periodId: string; carKey: string | null }) => void;
  /**
   * Куда ведёт правка записи:
   *  - 'inline'  — существующая карточка записи (поведение модуля «Учёт выезда»);
   *  - 'module'  — явный переход в модуль «Учёт выезда» (таймлайн: карточка
   *    записи не дублируется, правка идёт тем же сохранением и проверками прав).
   */
  editMode?: 'inline' | 'module';
}

/** Те же дни между датами, что в карточке автомобиля (календарные, включительно по дню). */
const daysBetweenNums = (a: number | null, b: number | null): string => {
  if (a == null || b == null) return '—';
  const d = b - a;
  return d >= 0 ? `${d} дн.` : '—';
};

/** Поля периода, которые правит окно, и их ключи per-field прав (как в модуле). */
const FIELD_TO_PERM_KEY: Record<string, string> = {
  dateArrival: 'baza_dateArrival',
  dateLoading: 'baza_dateLoading',
  dateDeparture: 'baza_dateDeparture',
  comment: 'baza_comment',
  dateRepairStart: 'baza_dateRepairStart',
  dateRepairEnd: 'baza_dateRepairEnd',
};

interface DraftFields {
  dateArrival: string;
  dateLoading: string;
  dateDeparture: string;
  comment: string;
}

const emptyDraft: DraftFields = { dateArrival: '', dateLoading: '', dateDeparture: '', comment: '' };

const isoOfDayNum = (n: number | null): string => (n == null ? '' : dayStr(n));

const draftFromPeriod = (p: BasePeriod): DraftFields => ({
  dateArrival: isoOfDayNum(p.arrivalDay),
  dateLoading: isoOfDayNum(p.plannedReadyDay),
  dateDeparture: isoOfDayNum(p.departureDay),
  comment: p.comment || '',
});

/** Открытый ли ремонт у периода (тип «В ремонте» — по существующим полям). */
const repairOpenOf = (p: BasePeriod): boolean =>
  p.repairStartDay != null && p.repairEndDay == null && p.departureDay == null;

export default function VyezdPeriodWindow({
  target,
  record,
  today,
  user,
  settings,
  canEdit,
  editorOpen,
  onEditRecord,
  onOpenTrip,
  onOpenFull,
  onClose,
  onSwitchPeriod,
  onReplaceTarget,
  editMode = 'inline',
}: Props) {
  const { showUnsaved, showConfirm } = useDialog();
  const { toast } = useToast();
  const data = useTimelineData();
  /** Асинхронные подписки: до их ответа показываем «загрузку», а не «не найдено». */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const canSeeTrips = resolvePermission(user, 'tripTimeline', settings?.rolePermissions) !== 'none' || user.role === 'root_admin';

  // Тот же справочник машин/диспетчеров, что у таймлайна — для конвертации
  // записи модуля тем же существующим конвертером (без копий логики).
  const dir = useMemo(
    () => buildDispatcherDirectory(data.dispatchers.map((d) => ({ id: d.id, name: d.name }))),
    [data.dispatchers],
  );
  const carIndex = useMemo(
    () =>
      buildCarIndex(
        data.fleetCars.map((c) => ({
          couplingId: c.carId,
          carNumber: c.carNumber,
          dispatcherId: c.dispatcherId,
          dispatcherName: c.dispatcherName,
        })),
      ),
    [data.fleetCars],
  );

  const period: BasePeriod | null = useMemo(() => {
    if (target.kind === 'period' && target.periodId) {
      const found = data.bases.find((p) => p.id === target.periodId);
      if (found) return found;
      if (record) {
        const conv = bazaToBasePeriods([record], carIndex, dir);
        if (conv.length) return conv[0];
      }
      return null;
    }
    const key = target.carKey || '';
    const num = target.carNumber || '';
    const norm = (s: string) => String(s || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
    const list = data.bases.filter(
      (p) => (key && p.carKey === key) || (num && norm(p.carNumber) === norm(num)),
    );
    return nearestPeriodOf(list, today);
  }, [target, data.bases, record, carIndex, dir, today]);

  /** Все периоды этой машины — список записей в «Подробнее» (текущий включён). */
  const carPeriods = useMemo(() => {
    if (!period) return [];
    const list = data.bases.filter((p) => p.carKey && p.carKey === period.carKey);
    const has = list.some((p) => p.key === period.key);
    return [...(has ? list : [...list, period])].sort(
      (a, b) => (a.arrivalDay ?? a.repairStartDay ?? 0) - (b.arrivalDay ?? b.repairStartDay ?? 0),
    );
  }, [data.bases, period]);

  const carTrips = useMemo(
    () => (period ? data.trips.filter((t) => t.carKey === period.carKey) : []),
    [data.trips, period],
  );
  const carEvents = useMemo(() => {
    if (!period) return [];
    const plate = String(period.carNumber || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
    return data.events.filter((e) => String(e.carNumber || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '') === plate);
  }, [data.events, period]);
  const tripRanges = useMemo(
    () => carTrips.map((t) => tripRangeOf(t)).filter((r): r is NonNullable<typeof r> => !!r),
    [carTrips],
  );
  const status = useMemo(() => (period ? vyezdStatusOf(period, today, tripRanges) : null), [period, today, tripRanges]);
  const summary = useMemo(() => (period ? vyezdSummaryOf(period, today, tripRanges) : null), [period, today, tripRanges]);

  /** Рейс для кнопки «Перейти к рейсу»: пересекающийся с периодом, иначе ближайший. */
  const jumpTrip: WholeTrip | null = useMemo(() => {
    if (!period || !carTrips.length) return null;
    const rb = baseBarRange(period, today);
    const a = rb?.a ?? period.arrivalDay ?? 0;
    const b = rb?.b ?? a;
    const spanOf = (t: WholeTrip) => {
      const ov = t.spanOverride || {};
      const sp = tripSpan(t);
      const s = ov.pMin ?? sp.pMin ?? null;
      const e = ov.pMax ?? sp.pMax ?? s;
      return s == null ? null : { s, e: Math.max(e ?? s, s) };
    };
    const overlap = carTrips.filter((t) => {
      const z = spanOf(t);
      return z != null && z.s <= b && z.e >= a;
    });
    const pool = overlap.length ? overlap : carTrips;
    return (
      [...pool].sort((x, y) => {
        const zx = spanOf(x);
        const zy = spanOf(y);
        const dx = zx ? Math.min(Math.abs(zx.s - a), Math.abs(zx.e - a)) : 1e9;
        const dy = zy ? Math.min(Math.abs(zy.s - a), Math.abs(zy.e - a)) : 1e9;
        return dx - dy;
      })[0] || null
    );
  }, [period, carTrips, today]);

  // ── Права (по существующим правилам модуля: переопределение поля → модуль) ──
  const fieldAllowed = useCallback(
    (field: keyof typeof FIELD_TO_PERM_KEY): boolean => {
      const permKey = FIELD_TO_PERM_KEY[field];
      if (permKey) {
        const own = user.permissions?.[permKey];
        const ownCustom = user.customPermissions?.[permKey];
        const direct =
          ownCustom !== undefined && ownCustom !== 'inherit' ? ownCustom : own !== undefined && own !== 'inherit' ? own : null;
        if (direct) return direct === 'write';
      }
      return canEdit;
    },
    [user, canEdit],
  );
  const canEditFields = fieldAllowed('dateArrival') || fieldAllowed('dateLoading') || fieldAllowed('dateDeparture') || fieldAllowed('comment');

  // ── Черновик окна: поля периода + тип (ремонт) ─────────────────────────────
  const [draft, setDraft] = useState<DraftFields>(emptyDraft);
  const [baseline, setBaseline] = useState<DraftFields>(emptyDraft);
  const [repairDraft, setRepairDraft] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const repairData = period ? repairOpenOf(period) : false;
  const repairNow = repairDraft === null ? repairData : repairDraft;
  const pendingRepair = repairDraft !== null && repairDraft !== repairData;

  // Синхронизация черновика с данными — ТОЛЬКО когда локальных правок нет
  // (правки не перетираются ответом подписки); после сохранения — из данных.
  useEffect(() => {
    if (!period) return;
    const fieldsDirty =
      draft.dateArrival !== baseline.dateArrival ||
      draft.dateLoading !== baseline.dateLoading ||
      draft.dateDeparture !== baseline.dateDeparture ||
      draft.comment !== baseline.comment;
    const repairPending = repairDraft !== null && repairDraft !== repairOpenOf(period);
    if (fieldsDirty || repairPending) return;
    const next = draftFromPeriod(period);
    setDraft(next);
    setBaseline(next);
    setRepairDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const draftDirty =
    draft.dateArrival !== baseline.dateArrival ||
    draft.dateLoading !== baseline.dateLoading ||
    draft.dateDeparture !== baseline.dateDeparture ||
    draft.comment !== baseline.comment;
  const dirty = draftDirty || pendingRepair;

  const changedLabels = useMemo(() => {
    const out: string[] = [];
    if (draft.dateArrival !== baseline.dateArrival) out.push(PERIOD_FIELD_LABELS.dateArrival);
    if (draft.dateLoading !== baseline.dateLoading) out.push(PERIOD_FIELD_LABELS.dateLoading);
    if (draft.dateDeparture !== baseline.dateDeparture) out.push(PERIOD_FIELD_LABELS.dateDeparture);
    if (draft.comment !== baseline.comment) out.push(PERIOD_FIELD_LABELS.comment);
    if (pendingRepair) out.push(repairNow ? 'Тип периода: ремонт' : 'Тип периода: на базе');
    return out;
  }, [draft, baseline, pendingRepair, repairNow]);

  /**
   * Сохранение карточки: одной записью уходят только изменённые поля (и смена
   * типа периода по существующим полям ремонта); журнал — как в модуле.
   */
  const doSave = useCallback(
    async (extra?: Partial<DraftFields>, successMsg?: string): Promise<boolean> => {
      if (!period || saving) return false;
      const nextDraft: DraftFields = { ...draft, ...(extra || {}) };
      const fields: Record<string, string> = {};
      const entries: PeriodHistoryEntry[] = [];
      (['dateArrival', 'dateLoading', 'dateDeparture', 'comment'] as const).forEach((f) => {
        if (nextDraft[f] === baseline[f]) return;
        if (!fieldAllowed(f)) return; // нет права на поле — не пишем (как в модуле)
        fields[f] = nextDraft[f];
        const isDate = f !== 'comment';
        entries.push({
          field: PERIOD_FIELD_LABELS[f],
          was: isDate ? ruDate(baseline[f]) : baseline[f],
          became: isDate ? ruDate(nextDraft[f]) : nextDraft[f],
        });
      });
      if (pendingRepair) {
        const canStart = fieldAllowed('dateRepairStart') && fieldAllowed('dateRepairEnd');
        if (repairNow && canStart) {
          // «В ремонте»: открытый ремонт — заявка (без завершения). Дата заявки —
          // сегодня; старая заявка/завершение переносятся/очищаются, старое
          // значение остаётся в журнале (ничего не теряется).
          fields.dateRepairStart = isoOfDayNum(today);
          fields.dateRepairEnd = '';
          entries.push({
            field: PERIOD_FIELD_LABELS.dateRepairStart,
            was: period.repairStartDay != null ? ruDate(isoOfDayNum(period.repairStartDay)) : '',
            became: ruDate(isoOfDayNum(today)),
          });
          if (period.repairEndDay != null) {
            entries.push({
              field: PERIOD_FIELD_LABELS.dateRepairEnd,
              was: ruDate(isoOfDayNum(period.repairEndDay)),
              became: '',
            });
          }
        } else if (!repairNow && fieldAllowed('dateRepairEnd')) {
          // «На базе»: ремонт закрывается сегодняшней датой (данные не стираются).
          fields.dateRepairEnd = isoOfDayNum(today);
          entries.push({
            field: PERIOD_FIELD_LABELS.dateRepairEnd,
            was: period.repairEndDay != null ? ruDate(isoOfDayNum(period.repairEndDay)) : '',
            became: ruDate(isoOfDayNum(today)),
          });
        }
      }
      if (!Object.keys(fields).length) {
        setDraft(nextDraft);
        toast('Нет изменений для сохранения', 'info');
        return false;
      }
      setSaving(true);
      try {
        await savePeriodFields(period.id, fields, entries, { name: user.name, role: user.role }, period.carNumber);
        setDraft(nextDraft);
        setBaseline(nextDraft);
        setRepairDraft(null);
        toast(successMsg || `Изменения сохранены · ${period.carNumber}`, 'success');
        return true;
      } catch (e) {
        toast(`Не удалось сохранить: ${(e as Error)?.message || 'неизвестная ошибка'}. Правки остались в окне — повторите.`, 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [period, saving, draft, baseline, pendingRepair, repairNow, fieldAllowed, user.name, user.role, toast, today],
  );

  /** «Машина выехала» — ставит сегодняшнюю дату фактического выезда и сохраняет. */
  const departedToday = draft.dateDeparture === isoOfDayNum(today);
  const doDeparted = useCallback(async () => {
    if (!period || saving) return;
    const todayIso = isoOfDayNum(today);
    if (draft.dateDeparture === todayIso && !draftDirty && !pendingRepair) {
      toast(`Фактический выезд уже отмечен сегодня: ${ruDate(todayIso)}`, 'info');
      return;
    }
    await doSave({ dateDeparture: todayIso }, `Машина выехала: ${ruDate(todayIso)}`);
  }, [period, saving, draft.dateDeparture, draftDirty, pendingRepair, doSave, today, toast]);

  // ── События ремонта ─────────────────────────────────────────────────────────
  const [eventForm, setEventForm] = useState<null | { id: string | null; date: string; type: string; text: string; amount: string }>(null);
  const [eventSaving, setEventSaving] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);

  const openAddEvent = useCallback(() => {
    setEventForm({ id: null, date: isoOfDayNum(today), type: 'diag', text: '', amount: '' });
  }, [today]);
  const openEditEvent = useCallback((e: RepairEvent) => {
    setEventForm({
      id: e.id,
      date: e.dateIso || isoOfDayNum(today),
      type: e.type,
      text: e.text,
      amount: e.amount != null ? String(e.amount) : '',
    });
  }, [today]);

  const submitEvent = useCallback(async () => {
    if (!period || !eventForm || eventSaving) return;
    if (!eventForm.date) {
      toast('Укажите дату события', 'error');
      return;
    }
    const amountText = eventForm.amount.trim().replace(/\s/g, '').replace(',', '.');
    const amount = amountText === '' ? null : Number(amountText);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      toast('Сумма должна быть неотрицательным числом', 'error');
      return;
    }
    const draftEvent = { date: eventForm.date, type: eventForm.type, text: eventForm.text.trim(), amount };
    setEventSaving(true);
    try {
      if (eventForm.id) {
        const prev = period.events.find((e) => e.id === eventForm.id);
        if (!prev) {
          toast('Событие не найдено — возможно, оно удалено', 'error');
          setEventForm(null);
          return;
        }
        await updateRepairEvent(period.id, eventForm.id, draftEvent, prev, { name: user.name, role: user.role }, period.carNumber);
        toast('Событие изменено', 'success');
      } else {
        await addRepairEvent(period.id, draftEvent, { name: user.name, role: user.role }, period.carNumber);
        toast('Событие добавлено', 'success');
      }
      setEventForm(null);
    } catch (e) {
      toast(`Не удалось сохранить событие: ${(e as Error)?.message || 'неизвестная ошибка'}`, 'error');
    } finally {
      setEventSaving(false);
    }
  }, [period, eventForm, eventSaving, user.name, user.role, toast]);

  const removeEvent = useCallback(
    async (e: RepairEvent) => {
      if (!period) return;
      const ok = await showConfirm(
        `Удалить событие «${repairEventLabel(e.type)}»${e.dateIso ? ` от ${ruDate(e.dateIso)}` : ''}? Запись удалится из ленты; событие останется в журнале изменений.`,
        'Удалить событие ремонта?',
      );
      if (!ok) return;
      try {
        await deleteRepairEvent(period.id, e, { name: user.name, role: user.role }, period.carNumber);
        toast('Событие удалено', 'success');
      } catch (err) {
        toast(`Не удалось удалить событие: ${(err as Error)?.message || 'неизвестная ошибка'}`, 'error');
      }
    },
    [period, showConfirm, user.name, user.role, toast],
  );

  /** Предложение сдвига срока готовности из события «Ждём запчасть» (без автосдвига). */
  const waitEvent = useMemo(() => (period ? pendingWaitEvent(period.events) : null), [period]);
  const shiftProposal = useMemo(
    () =>
      period && waitEvent
        ? proposedReadyShift(isoOfDayNum(period.plannedReadyDay), waitEvent.dateIso, isoOfDayNum(today))
        : null,
    [period, waitEvent, today],
  );
  const applyShift = useCallback(async () => {
    if (!period || !waitEvent || !shiftProposal || shiftBusy || saving) return;
    setShiftBusy(true);
    try {
      await applyWaitEventShift(
        period.id,
        waitEvent.id,
        shiftProposal.fromIso,
        shiftProposal.toIso,
        { name: user.name, role: user.role },
        period.carNumber,
      );
      toast(
        `Срок готовности перенесён: ${shiftProposal.fromIso ? ruDate(shiftProposal.fromIso) : 'не был указан'} → ${ruDate(shiftProposal.toIso)}`,
        'success',
      );
    } catch (e) {
      toast(`Не удалось перенести срок: ${(e as Error)?.message || 'неизвестная ошибка'}`, 'error');
    } finally {
      setShiftBusy(false);
    }
  }, [period, waitEvent, shiftProposal, shiftBusy, saving, user.name, user.role, toast]);

  // ── Закрытие окна ───────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (editorOpen) return; // сначала закроется карточка записи (свой Esc сверху)
    if (!dirty) {
      onClose();
      return;
    }
    void (async () => {
      const res = await showUnsaved({ changed: changedLabels, message: 'В карточке периода есть несохранённые изменения.' });
      if (res === 'stay') return;
      onClose();
    })();
  }, [dirty, changedLabels, editorOpen, onClose, showUnsaved]);

  useWindowHotkeys({
    onEscape: () => {
      if (eventForm) {
        setEventForm(null);
        return;
      }
      requestClose();
    },
  });

  /** Переключение окна на другую запись машины: адрес заменяется (без новой записи истории). */
  const switchTo = useCallback(
    (periodId: string) => {
      if (!periodId) return;
      if (onReplaceTarget) onReplaceTarget({ periodId, carKey: period?.carKey || null });
      else replaceVyezdHash({ periodId, carKey: period?.carKey || null });
      onSwitchPeriod(periodId);
    },
    [period?.carKey, onSwitchPeriod, onReplaceTarget],
  );

  /** Блок «Подробнее»: закрыт по умолчанию; ничего из прежнего окна не выброшено. */
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ── Состояние «не найдено / загрузка» ──────────────────────────────────────
  if (!period || !status || !summary) {
    const carLabel = target.carNumber ? ` ${formatPlate(target.carNumber)}` : '';
    return (
      <ModalShell
        isOpen
        onClose={onClose}
        title="Учёт выезда"
        subtitle={`Окно периода${carLabel}`}
        icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
        ariaLabel="Учёт выезда: окно периода"
        closeTitle="Закрыть · Esc"
        hotkeysManaged
        maxWidth="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            <button type="button" data-ui="vyezd-open-full" onClick={() => onOpenFull(target.periodId)} className={UI.buttonGhost}>
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              Открыть полный учёт выезда
            </button>
            <button type="button" data-ui="vyezd-close" onClick={onClose} className={UI.buttonPrimary}>
              Закрыть
            </button>
          </div>
        }
      >
        <div className={UI.hint} data-ui="vyezd-window-missing">
          {waited
            ? target.kind === 'period'
              ? 'Запись учёта выезда не найдена: возможно, она удалена или перенесена. Полный список — в «Учёте выезда».'
              : 'По этой машине не найдено ни одной записи учёта выезда.'
            : 'Загрузка записи учёта выезда…'}
        </div>
      </ModalShell>
    );
  }

  const rb = baseBarRange(period, today);
  const rr = repairBarRange(period, today);
  const rdy = period.plannedReadyDay;
  const dev = baseDeviation(period, today);
  const isoOf = (n: number | null): string => (n == null ? '' : dayStr(n));
  const todayIso = isoOfDayNum(today);
  const carOnlyNote =
    target.kind === 'car' && period.id !== target.periodId
      ? 'Период в ссылке не указан — открыт ближайший период этой машины.'
      : '';
  const periodText = `${period.arrivalDay != null ? fmtDM(period.arrivalDay) : 'приезд не указан'} — ${
    period.departureDay != null ? fmtDM(period.departureDay) : '…'
  }`;
  const jumpTripRange = jumpTrip ? tripSpan(jumpTrip) : null;
  const jumpTripText = jumpTrip
    ? `${jumpTrip.route || jumpTrip.key}${
        jumpTripRange?.pMin != null ? ` (${fmtDM(jumpTripRange.pMin)} – ${jumpTripRange.pMax != null ? fmtDM(jumpTripRange.pMax) : '…'})` : ''
      }`
    : '';

  // ── Компактная карточка: бейдж, итог, права, ремонт ────────────────────────
  const overdueDays = dev.kind === 'overdue' && period.plannedReadyDay != null ? today - period.plannedReadyDay : null;
  const summaryLine =
    overdueDays != null && overdueDays >= 0
      ? `просрочено на ${overdueDays} дн`
      : `${summary.total} дн на базе${period.plannedReadyDay != null ? `, срок ${fmtDM(period.plannedReadyDay)}` : ''}`;

  // Бейдж: «В ремонте» / «Просрочена» / «На базе»; у закрытых записей — прежний
  // «Период закрыт» (полные формулировки статуса остались в «Подробнее»).
  const badge = repairNow
    ? { label: 'В ремонте', icon: Wrench, color: { bg: '#FDDCC0', border: '#EF9A57', text: '#8F3D0B' } }
    : overdueDays != null
      ? { label: 'Просрочена', icon: Hourglass, color: VYEZD_STATUS['no-departure'] }
      : status.kind === 'closed'
        ? { label: 'Период закрыт', icon: CircleCheck, color: VYEZD_STATUS.closed }
        : { label: 'На базе', icon: Truck, color: VYEZD_STATUS.active };
  const BadgeIcon = badge.icon;

  // Диагностика для «Подробнее»: настоящие расхождения и предупреждения записи.
  const realConflicts = status.conflicts.filter((c) => !c.boundary);
  const diagnosticCount = realConflicts.length + period.warnings.length;
  const canToggleKind = canEdit && fieldAllowed('dateRepairStart') && fieldAllowed('dateRepairEnd');
  const canAddEvents = canEdit;
  const showRepairCard = repairNow || period.events.length > 0;

  const kindToggleBtn = (active: boolean) =>
    `px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
      active ? 'bg-[#121316] text-white' : 'bg-white text-[#4B5563] hover:bg-[#F3F4F6]'
    }`;

  return (
    <ModalShell
      isOpen
      onClose={requestClose}
      title="Учёт выезда: период машины"
      subtitle={`запись ${period.key}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Учёт выезда: окно периода машины"
      closeTitle="Закрыть · Esc"
      hotkeysManaged
      maxWidth="max-w-[min(760px,94vw)]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          <button type="button" data-ui="vyezd-close" onClick={requestClose} className={UI.buttonGhost}>
            Закрыть
          </button>
          {fieldAllowed('dateDeparture') ? (
            <button
              type="button"
              data-ui="vyezd-departed"
              onClick={() => void doDeparted()}
              disabled={saving || (departedToday && !draftDirty && !pendingRepair)}
              className={UI.buttonGhost}
              title={`Поставить фактический выезд сегодняшней датой (${ruDate(todayIso)}) и сохранить`}
            >
              <Truck className="w-4 h-4" aria-hidden="true" />
              Машина выехала
            </button>
          ) : null}
          {canEditFields ? (
            <button
              type="button"
              data-ui="vyezd-save"
              onClick={() => void doSave()}
              disabled={saving}
              className={UI.buttonPrimary}
              title="Сохранить изменения периода (журнал — как в модуле «Учёт выезда»)"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-ui="vyezd-window" data-vyezd-window={period.key} data-vyezd-status={status.kind}>
        {/* Шапка карточки: статус-бейдж, госномер, водитель (диспетчер — в «Подробнее») */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 border-b border-[#E5E7EB]">
          <span
            className="inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap"
            style={{ background: badge.color.bg, color: badge.color.text, border: `1px solid ${badge.color.border}` }}
            data-ui="vyezd-status-chip"
            data-vyezd-badge={repairNow ? 'repair' : overdueDays != null ? 'overdue' : status.kind === 'closed' ? 'closed' : 'base'}
          >
            <BadgeIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {badge.label}
          </span>
          <span className="font-mono font-semibold text-sm text-[#121316] select-all">{formatPlate(period.carNumber)}</span>
          <span className="text-[11px] text-[#4B5563]" data-ui="vyezd-driver">
            {period.driverName || 'водитель не указан'}
          </span>
          {period.archived ? <span className={UI.chip}>архив</span> : null}
        </div>

        {/* Тип периода: «На базе / В ремонте» — по существующим полям ремонта */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-ui="vyezd-kind">
          {canToggleKind ? (
            <div className="inline-flex rounded-xl border border-[#E5E7EB] overflow-hidden" role="group" aria-label="Тип периода">
              <button
                type="button"
                data-ui="vyezd-kind-base"
                aria-pressed={!repairNow}
                onClick={() => setRepairDraft(false)}
                disabled={saving}
                className={kindToggleBtn(!repairNow)}
                title="Обычный период на базе (ремонт закрывается сегодняшней датой)"
              >
                На базе
              </button>
              <button
                type="button"
                data-ui="vyezd-kind-repair"
                aria-pressed={repairNow}
                onClick={() => setRepairDraft(true)}
                disabled={saving}
                className={`${kindToggleBtn(repairNow)} border-l border-[#E5E7EB]`}
                title="Период в ремонте: открытая заявка на ремонт (dateRepairStart без завершения)"
              >
                <span className="inline-flex items-center gap-1">
                  <Wrench className="w-3 h-3" aria-hidden="true" />
                  В ремонте
                </span>
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-[#4B5563]" data-ui="vyezd-kind-readonly">
              Тип периода: <b className="text-[#121316]">{repairNow ? 'В ремонте' : 'На базе'}</b>
            </span>
          )}
          {pendingRepair ? (
            <span className="text-[10px] text-[#8A5A0A]" data-ui="vyezd-kind-pending">
              тип изменится после «Сохранить»
            </span>
          ) : repairNow && period.repairStartDay != null ? (
            <span className="text-[10px] text-[#8F3D0B]">ремонт с {fmtDM(period.repairStartDay)}</span>
          ) : null}
        </div>

        {/* Поля периода: приезд, срок готовности, фактический выезд (необязательно) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <label className="flex flex-col gap-1" data-ui="vyezd-field-arrival">
            <span className={UI.fieldLabel}>Приезд</span>
            <DateInput
              value={draft.dateArrival}
              onChange={(iso) => setDraft((d) => ({ ...d, dateArrival: iso }))}
              disabled={!fieldAllowed('dateArrival') || saving}
              ariaLabel="Приезд (ДД/ММ/ГГГГ)"
            />
          </label>
          <label className="flex flex-col gap-1" data-ui="vyezd-field-loading">
            <span className={UI.fieldLabel}>Срок готовности</span>
            <DateInput
              value={draft.dateLoading}
              onChange={(iso) => setDraft((d) => ({ ...d, dateLoading: iso }))}
              disabled={!fieldAllowed('dateLoading') || saving}
              ariaLabel="Срок готовности (ДД/ММ/ГГГГ)"
            />
          </label>
          <label className="flex flex-col gap-1" data-ui="vyezd-field-departure">
            <span className={UI.fieldLabel}>Фактический выезд</span>
            <DateInput
              value={draft.dateDeparture}
              onChange={(iso) => setDraft((d) => ({ ...d, dateDeparture: iso }))}
              disabled={!fieldAllowed('dateDeparture') || saving}
              ariaLabel="Фактический выезд (ДД/ММ/ГГГГ)"
            />
          </label>
        </div>

        {/* Примечание — одна строка */}
        <label className="flex items-center gap-2" data-ui="vyezd-field-comment">
          <span className={`${UI.fieldLabel} shrink-0`}>Примечание</span>
          <input
            type="text"
            data-ui="vyezd-comment"
            value={draft.comment}
            onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
            disabled={!fieldAllowed('comment') || saving}
            placeholder="Примечание к периоду"
            className={UI.inputSm}
          />
        </label>

        {/* Итог — ОДНА строка (те же числа, что в прежней сводке) */}
        <div
          className="flex flex-wrap items-center gap-x-2 text-xs text-[#4B5563]"
          data-ui="vyezd-summary-line"
          data-vyezd-summary={summaryLine}
        >
          <CalendarClock className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
          <b className="text-[#121316]">{summaryLine}</b>
          {period.archived ? <span className="text-[10px] text-[#6B7280]">· архивная запись</span> : null}
        </div>

        {/* Ремонт: лента событий + «+ Событие» (вложенная ветка записи) */}
        {showRepairCard ? (
          <div className="flex flex-col rounded-xl border border-[#EF9A57] bg-[#FFF9F4]" data-ui="vyezd-repair">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5">
              <Wrench className="w-3.5 h-3.5 text-[#8F3D0B]" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-[#8F3D0B]">
                Ремонт
                {period.repairStartDay != null ? ` · с ${fmtDM(period.repairStartDay)}` : ''}
              </span>
              <span className="text-[10px] text-[#8F3D0B]/80">
                {period.events.length ? `событий: ${period.events.length}` : 'событий пока нет'}
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                {canAddEvents ? (
                  <button
                    type="button"
                    data-ui="vyezd-event-add"
                    onClick={() => (eventForm && !eventForm.id ? setEventForm(null) : openAddEvent())}
                    className={`${UI.buttonGhost} !min-h-[30px] !py-1`}
                    title="Добавить событие ремонта (дата, тип, текст, сумма)"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Событие
                  </button>
                ) : null}
              </span>
            </div>

            {/* Предложение сдвига срока из «Ждём запчасть» — НЕ автоматическое */}
            {waitEvent && shiftProposal && canAddEvents ? (
              <div
                className="mx-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#E3B04B] bg-[#FBEFD4] px-2.5 py-1.5"
                data-ui="vyezd-shift-proposal"
              >
                <span className="text-[11px] text-[#8A5A0A]">
                  «Ждём запчасть»{waitEvent.dateIso ? ` с ${ruDate(waitEvent.dateIso)}` : ''}: сдвинуть срок готовности{' '}
                  <b>{shiftProposal.fromIso ? ruDate(shiftProposal.fromIso) : 'не был указан'}</b> →{' '}
                  <b>{ruDate(shiftProposal.toIso)}</b> (+{shiftProposal.days} дн)?
                </span>
                <button
                  type="button"
                  data-ui="vyezd-shift-apply"
                  onClick={() => void applyShift()}
                  disabled={shiftBusy || saving}
                  className={`${UI.buttonGhost} ml-auto !min-h-[30px] !py-1`}
                  title="Явный перенос срока готовности; событие и журнал изменений будут отмечены"
                >
                  {shiftBusy ? 'Перенос…' : 'Сдвинуть срок'}
                </button>
              </div>
            ) : waitEvent && shiftProposal && !canAddEvents ? (
              <div className="mx-3 mt-2 text-[11px] text-[#8A5A0A]" data-ui="vyezd-shift-proposal">
                «Ждём запчасть»: предлагается сдвиг срока готовности (изменение недоступно: нет права правки).
              </div>
            ) : null}

            {/* Форма события (добавление/правка) */}
            {eventForm && canAddEvents ? (
              <div className="mx-3 mt-2 flex flex-col gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5" data-ui="vyezd-event-form">
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className={UI.fieldLabel}>Дата</span>
                    <DateInput
                      value={eventForm.date}
                      onChange={(iso) => setEventForm((f) => (f ? { ...f, date: iso } : f))}
                      ariaLabel="Дата события ремонта"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={UI.fieldLabel}>Тип</span>
                    <select
                      data-ui="vyezd-event-type"
                      value={eventForm.type}
                      onChange={(e) => setEventForm((f) => (f ? { ...f, type: e.target.value } : f))}
                      className={`${UI.select} !min-h-[32px] !py-1.5`}
                    >
                      {REPAIR_EVENT_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                      {/* Незнакомый тип из старой записи не теряем */}
                      {!REPAIR_EVENT_TYPES.some((t) => t.key === eventForm.type) ? (
                        <option value={eventForm.type}>{repairEventLabel(eventForm.type)}</option>
                      ) : null}
                    </select>
                  </label>
                </div>
                <input
                  type="text"
                  data-ui="vyezd-event-text"
                  value={eventForm.text}
                  onChange={(e) => setEventForm((f) => (f ? { ...f, text: e.target.value } : f))}
                  placeholder="Что происходит: заказали деталь, ждём поставку…"
                  className={UI.inputSm}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  data-ui="vyezd-event-amount"
                  value={eventForm.amount}
                  onChange={(e) => setEventForm((f) => (f ? { ...f, amount: e.target.value } : f))}
                  placeholder="Сумма, необязательно"
                  className={UI.inputSm}
                />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" data-ui="vyezd-event-cancel" onClick={() => setEventForm(null)} className={`${UI.buttonGhost} !min-h-[32px] !py-1`}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    data-ui="vyezd-event-submit"
                    onClick={() => void submitEvent()}
                    disabled={eventSaving}
                    className={`${UI.buttonPrimary} !min-h-[32px] !py-1`}
                  >
                    {eventSaving ? 'Сохранение…' : eventForm.id ? 'Сохранить событие' : 'Добавить событие'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Лента событий: своя ограниченная прокрутка, окно целиком не скроллится */}
            <div className="px-3 pb-2.5 pt-2" data-ui="vyezd-repair-feed">
              {period.events.length ? (
                <div className="flex flex-col gap-1 max-h-[148px] overflow-y-auto custom-scrollbar pr-1">
                  {period.events.map((e) => (
                    <div
                      key={e.id}
                      data-ui="vyezd-event"
                      data-vyezd-event-id={e.id}
                      data-vyezd-event-type={e.type}
                      className="flex items-center gap-2 rounded-lg border border-[#F5D9C2] bg-white/80 px-2 py-1.5"
                    >
                      <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-mono tabular-nums text-[#4B5563]">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: repairEventDotColor(e.type) }}
                          aria-hidden="true"
                        />
                        {e.dateIso ? ruDate(e.dateIso) : 'без даты'}
                      </span>
                      <span className="text-[11px] font-medium text-[#121316] shrink-0">{repairEventLabel(e.type)}</span>
                      {e.text ? (
                        <span className="text-[11px] text-[#4B5563] truncate" title={e.text}>
                          {e.text}
                        </span>
                      ) : null}
                      {e.amount != null ? <span className="text-[11px] text-[#6B7280] shrink-0">сумма {e.amount}</span> : null}
                      {e.shiftedReadyTo ? (
                        <span className="text-[10px] text-emerald-700 shrink-0" title="Из этого события явно перенесён срок готовности">
                          срок → {ruDate(e.shiftedReadyTo)}
                        </span>
                      ) : null}
                      {canAddEvents ? (
                        <span className="ml-auto inline-flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            data-ui="vyezd-event-edit"
                            onClick={() => openEditEvent(e)}
                            className={`${UI.buttonIcon} !p-1`}
                            title="Править событие"
                            aria-label={`Править событие ${repairEventLabel(e.type)}`}
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            data-ui="vyezd-event-del"
                            onClick={() => void removeEvent(e)}
                            className={`${UI.buttonIcon} !p-1 hover:!text-rose-600`}
                            title="Удалить событие (с подтверждением)"
                            aria-label={`Удалить событие ${repairEventLabel(e.type)}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-[#6B7280]">
                  Лента пуста: добавьте событие («Ждём запчасть», «Работы идут»…) — точки появятся и на полосе таймлайна.
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* «Подробнее» — все прежние пояснения, стыки, конфликты и служебные
            блоки; по умолчанию ЗАКРЫТО. Ничего не выброшено. */}
        <div className="flex flex-col">
          <button
            type="button"
            data-ui="vyezd-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#E5E7EB] text-[11px] font-medium text-[#4B5563] hover:text-[#121316] hover:bg-[#F9FAFB] transition-colors cursor-pointer"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            Подробнее: пояснения, стыки с рейсами, сводка и служебные блоки
            {diagnosticCount > 0 ? (
              <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-[#9F1239]" data-ui="vyezd-diagnostics-count">
                <TriangleAlert className="w-3 h-3" aria-hidden="true" />
                расхождений и предупреждений: {diagnosticCount}
              </span>
            ) : null}
          </button>

          {detailsOpen ? (
            <div className="flex flex-col gap-5 pt-4" data-ui="vyezd-details">
              {carOnlyNote ? (
                <div className="text-[11px] text-[#8A5A0A] bg-[#FBEFD4] border border-[#E3B04B] rounded-xl px-3 py-2" role="status">
                  {carOnlyNote}
                </div>
              ) : null}

              {/* Служебная строка: диспетчер, период, тип записи */}
              <div className={UI.hint}>
                Диспетчер: {period.dispatcherName || '—'} · период: <b className="text-[#121316]">{periodText}</b>
                {rb ? ` · ${rb.b - rb.a + 1} дн` : ''} · тип записи: {period.causeLabel}
              </div>

              {/* Действия: полный учёт, рейс, правка записи (как было в нижней панели) */}
              <div className="flex flex-wrap items-center gap-2" data-ui="vyezd-actions">
                {canEdit && editMode !== 'module' ? (
                  <button
                    type="button"
                    data-ui="vyezd-edit"
                    onClick={() => onEditRecord(period.id)}
                    className={UI.buttonGhost}
                    title="Открыть существующую карточку записи (права и журнал изменений — как в списке модуля)"
                  >
                    Исправить в учёте выезда
                  </button>
                ) : null}
                {canEdit && editMode === 'module' ? (
                  <button
                    type="button"
                    data-ui="vyezd-edit-module"
                    onClick={() => onOpenFull(period.id)}
                    className={UI.buttonGhost}
                    title="Правка записи — в модуле «Учёт выезда» (та же карточка, то же сохранение и проверки прав)"
                  >
                    Открыть в модуле «Учёт выезда»
                  </button>
                ) : null}
                {!canEdit || editMode !== 'module' ? (
                  <button type="button" data-ui="vyezd-open-full" onClick={() => onOpenFull(period.id)} className={UI.buttonGhost}>
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    Открыть полный учёт выезда
                  </button>
                ) : null}
                <button
                  type="button"
                  data-ui="vyezd-open-trip"
                  onClick={() => jumpTrip && onOpenTrip(jumpTrip.key)}
                  disabled={!jumpTrip || !canSeeTrips}
                  className={UI.buttonGhost}
                  title={
                    !canSeeTrips
                      ? 'Нет доступа к модулю «Таймлайн рейсов»'
                      : jumpTrip
                        ? `Открыть рейс ${jumpTripText}`
                        : 'Рейсов по машине не найдено'
                  }
                >
                  <Route className="w-4 h-4" aria-hidden="true" />
                  Перейти к рейсу
                </button>
              </div>

              {/* Мини-таймлайн машины за период: рейсы, база, ремонт, выделенный период */}
              <div className="flex flex-col gap-2">
                <h3 className={UI.sectionTitle}>Таймлайн машины за период</h3>
                {canSeeTrips ? (
                  <CarMiniTimeline
                    focusKey={null}
                    carTrips={carTrips}
                    carBases={carPeriods}
                    carEvents={carEvents}
                    stageTypes={data.stageTypes}
                    today={today}
                    highlightRange={rb ? { a: rb.a, b: rb.b } : null}
                    onSelectTrip={(key) => onOpenTrip(key)}
                    onOpenBasePeriod={(key) => {
                      const p = data.bases.find((b) => b.key === key);
                      if (p && p.id !== period.id) switchTo(p.id);
                    }}
                  />
                ) : (
                  <div className={UI.hint}>
                    Рейсы в мини-таймлайне скрыты: нет доступа к модулю «Таймлайн рейсов». Периоды базы и ремонта показаны ниже.
                  </div>
                )}
              </div>

              {/* Сводка: дни по состояниям + итоговые показатели записи */}
              <div className="flex flex-col gap-2">
                <h3 className={UI.sectionTitle}>Сводка по периоду</h3>
                <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
                  <div className="px-3 py-2 bg-[#F9FAFB] flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[#4B5563]">
                    <span className="inline-flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                      Дней на базе: <b className="text-[#121316] font-mono tabular-nums">{summary.total}</b>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Route className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                      Дней в рейсе: <b className="text-[#121316] font-mono tabular-nums">{summary.tripDays}</b>
                      {summary.trips.length ? (
                        <span className="text-[#6B7280]">
                          ({summary.trips.map((t) => `${t.label}${t.boundary ? ' — стык' : ''}`).join(', ')})
                        </span>
                      ) : null}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-[#D97706]" aria-hidden="true" />
                      Дней в ремонте: <b className="text-[#121316] font-mono tabular-nums">{summary.repairDays}</b>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                      Без пересечений с рейсом и ремонтом: <b className="text-[#121316] font-mono tabular-nums">{summary.freeDays}</b>
                    </span>
                  </div>
                  <div className="px-3 py-2 text-[#4B5563] flex flex-col gap-1.5 border-t border-[#E5E7EB]">
                    <span>
                      План: приезд → срок готовности:{' '}
                      <b className="text-[#121316]">
                        {period.arrivalDay != null || rdy != null
                          ? `${period.arrivalDay != null ? fmtFull(isoOf(period.arrivalDay)) : '—'} → ${rdy != null ? fmtFull(isoOf(rdy)) : 'срок готовности не указан'}`
                          : '—'}
                      </b>
                    </span>
                    <span>
                      Факт: приезд → фактический выезд:{' '}
                      <b className="text-[#121316]">
                        {period.arrivalDay != null
                          ? `${fmtFull(isoOf(period.arrivalDay))} → ${period.departureDay != null ? fmtFull(isoOf(period.departureDay)) : '—'}`
                          : '—'}
                      </b>
                    </span>
                    <span>
                      Отклонение выезда от срока готовности:{' '}
                      <b className={dev.kind === 'late' || dev.kind === 'overdue' ? 'text-rose-600' : dev.kind === 'early' ? 'text-emerald-600' : 'text-[#4B5563]'}>
                        {dev.label}
                      </b>
                    </span>
                    {rr ? (
                      <span>
                        Ремонт:{' '}
                        <b className="text-[#121316]">
                          {fmtFull(isoOf(rr.a))} →{' '}
                          {period.repairEndDay != null
                            ? fmtFull(isoOf(period.repairEndDay))
                            : rr.capped
                              ? 'до фактического выезда (окончание не указано)'
                              : 'продолжается'}
                        </b>
                      </span>
                    ) : null}
                  </div>
                  {/* Итоговые показатели записи — те же формулы и подписи, что в карточке автомобиля */}
                  <div className="px-3 py-2 border-t border-[#E5E7EB] flex flex-wrap items-center gap-x-8 gap-y-2">
                    <span className="text-[#6B7280]">Итоговые показатели записи:</span>
                    <span className="inline-flex items-center gap-1.5">
                      Дни отдыха водит.: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, rdy)}</b>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      Ожидание ремонта: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, period.repairStartDay)}</b>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      Дни ремонта: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.repairStartDay, period.repairEndDay)}</b>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      Общий простой: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, period.departureDay)}</b>
                    </span>
                  </div>
                </div>
              </div>

              {/* Список записей учёта выезда этой машины */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
                  <h3 className={UI.sectionTitle}>Записи учёта выезда этой машины ({carPeriods.length})</h3>
                </div>
                <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB]">
                  {carPeriods.map((p) => {
                    const ps = vyezdStatusOf(p, today, tripRanges);
                    const pColor = VYEZD_STATUS[ps.kind];
                    const cur = p.key === period.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        data-ui="vyezd-record-row"
                        data-vyezd-record={p.key}
                        data-vyezd-current={cur ? '1' : undefined}
                        onClick={() => {
                          if (!cur) switchTo(p.id);
                        }}
                        className={`w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 transition-colors cursor-pointer ${
                          cur ? 'bg-[var(--accent-8)]' : 'hover:bg-[#F9FAFB]'
                        }`}
                        title={ps.reason}
                      >
                        <span className="text-[11px] font-semibold" style={{ color: pColor.text }}>
                          {ps.short}
                        </span>
                        <span className="text-[11px] text-[#4B5563]">
                          база: {p.arrivalDay != null ? fmtDM(p.arrivalDay) : '—'} – {p.departureDay != null ? fmtDM(p.departureDay) : '…'}
                        </span>
                        {p.plannedReadyDay != null ? <span className="text-[11px] text-[#6B7280]">готовность: {fmtDM(p.plannedReadyDay)}</span> : null}
                        {p.repairStartDay != null ? (
                          <span className="text-[11px] text-[#B45309]">
                            ремонт: {fmtDM(p.repairStartDay)} – {p.repairEndDay != null ? fmtDM(p.repairEndDay) : '…'}
                          </span>
                        ) : null}
                        {p.archived ? <span className={UI.chip}>архив</span> : null}
                        {cur ? <span className={UI.chip}>открыта в окне</span> : null}
                        {p.warnings.length ? <span className="text-[10px] text-amber-700">предупреждения: {p.warnings.length}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Пояснения: как считается период, что значит статус, стыки, что сделать */}
              <div className="flex flex-col gap-2" data-ui="vyezd-explanations">
                <h3 className={UI.sectionTitle}>Пояснения</h3>
                <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
                  <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]">
                    <b className="text-[#121316]">Как считается период.</b> Период «учёта выезда» — от даты приезда на базу до фактического
                    выезда. Пока выезд не внесён, период показывается открытым до сегодняшней даты; сегодняшняя дата в данные не записывается,
                    срок готовности не продлевается автоматически.
                  </div>
                  <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]">
                    <b className="text-[#121316]">Что значит статус «{status.label}».</b> {status.reason}
                  </div>
                  <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]" data-ui="vyezd-conflicts">
                    <b className="text-[#121316]">Пересечения с рейсами.</b>{' '}
                    {status.conflicts.length ? (
                      <span className="flex flex-col gap-1 mt-1">
                        {status.conflicts.map((c) => (
                          <span key={`${c.label}-${c.a}`} className={c.boundary ? 'text-[#6B7280]' : 'text-[#9F1239] font-medium'}>
                            • {c.label} {fmtDM(c.a)} – {fmtDM(c.b)}:{' '}
                            {c.boundary
                              ? `общий день стыка (${fmtDM(c.overlapA)}) — это не расхождение`
                              : `общих дней — ${c.days} (${fmtDM(c.overlapA)} – ${fmtDM(c.overlapB)}): проверьте даты`}
                          </span>
                        ))}
                      </span>
                    ) : (
                      'Пересечений периода с рейсами этой машины нет.'
                    )}
                  </div>
                  {period.warnings.length ? (
                    <div className="px-3 py-2 border-b border-[#E5E7EB] text-[#8A5A0A] bg-[#FBEFD4]" role="alert">
                      <b>Предупреждения записи.</b>{' '}
                      <span className="flex flex-col gap-1 mt-1">
                        {period.warnings.map((w) => (
                          <span key={w}>• {w}</span>
                        ))}
                      </span>
                    </div>
                  ) : (
                    <div className="px-3 py-2 border-b border-[#E5E7EB] text-[#6B7280]">Предупреждений по датам записи нет.</div>
                  )}
                  <div className="px-3 py-2 text-[#4B5563] leading-relaxed">
                    <b className="text-[#121316]">Что сделать.</b>{' '}
                    {status.kind === 'no-departure'
                      ? 'Если машина уже выехала — нажмите «Машина выехала» в карточке или внесите фактический выезд вручную'
                      : status.kind === 'conflict'
                        ? 'Сверьте даты рейса и простоя: рейс правится в «Плане дохода», простой — в «Учёте выезда»'
                        : status.kind === 'active'
                          ? 'Действий не требуется: когда машина выедет, нажмите «Машина выехала» — период закроется'
                          : 'Действий не требуется: период закрыт фактическим выездом'}
                    {period.departureDay == null && period.plannedReadyDay != null && dev.kind !== 'overdue'
                      ? ` (срок готовности — ${fmtDM(period.plannedReadyDay)})`
                      : ''}
                    .{' '}
                    {canEdit ? (
                      editMode === 'module' ? (
                        <button
                          type="button"
                          data-ui="vyezd-edit-inline"
                          onClick={() => onOpenFull(period.id)}
                          className="underline text-[var(--accent-ink)] font-medium cursor-pointer"
                        >
                          Открыть модуль «Учёт выезда» для правки записи
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-ui="vyezd-edit-inline"
                          onClick={() => onEditRecord(period.id)}
                          className="underline text-[var(--accent-ink)] font-medium cursor-pointer"
                        >
                          Открыть карточку записи
                        </button>
                      )
                    ) : (
                      <span className="text-[#6B7280]">Изменение записи недоступно: нет права правки учёта выезда.</span>
                    )}
                  </div>
                </div>
                {jumpTrip ? (
                  <div className={UI.hint}>
                    Связанный рейс для перехода: {jumpTripText}
                    {!canSeeTrips ? ' (переход скрыт: нет доступа к «Таймлайну рейсов»)' : ''}
                  </div>
                ) : (
                  <div className={UI.hint}>Рейсов по машине не найдено — переход к рейсу недоступен.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}
