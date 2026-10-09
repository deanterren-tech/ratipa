/**
 * Календарный таймлайн по машинам — главный экран модуля.
 *
 * Одна машина = одна группа строк: верхняя подстрока «План», нижняя «Факт»,
 * одна шкала и масштаб. План строится из «Плана дохода» (старт/возвращение) и
 * ручных рейсов модуля; факт — только из реально заполненных фактических дат и
 * событий (ничего не выдумывается), периоды «на базе» и ремонт — из «Учёта
 * выезда». Соседние рейсы не сливаются: у каждого свои границы и клик.
 *
 * Производительность: строки-группы — memo-компоненты, модель строк собирается
 * одним useMemo по видимому окну + запас по краям, фоновые дорожки выходных и
 * подсветка столбца «сегодня» считаются один раз на окно, связь «план↔факт» при
 * наведении — локальное состояние внутри строки машины. Позиция прокрутки
 * сохраняется между возвратами (sessionStorage + вкладки не размонтируются).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimelineStageType, TimelineVehicleEvent } from '../../../types';
import { formatPlate } from '../../../utils/salaryAutofill';
import {
  TIMELINE_COL_W,
  ZOOM_LEVELS,
  addMonthsIso,
  barRectInWindow,
  dayAtContentX,
  dayNum,
  dayStr,
  dayToX,
  fmtDM,
  getDeadlineStatus,
  isWeekendDay,
  layoutLaneTracks,
  stageDeviation,
  tripFactEnd,
  tripSpan,
  visibleRangeText,
  zoomColW,
  zoomLabel,
  type LaneTrackItem,
} from './lib/timeline';
import { eventTypeOf, stageFullName } from './lib/catalog';
import { PlanBarLabel, planBarLabelParts, type PlanBarParts } from './PlanBarLabel';
import { eventMarkOf, groupEventMarks, type EventMark } from './lib/eventMarks';
import {
  layoutStageFills,
  stageColorOf,
  stageFillTitle,
  stageShortName,
  type StageFillInput,
  type StageFillSection,
} from './lib/stageFills';
import {
  baseBarRange,
  baseDeviation,
  plateKeyOf,
  readyBarRange,
  repairBarRange,
  type BasePeriod,
  type CarRef,
  type WholeTrip,
} from './lib/sources';
import DateInput from './DateInput';
import CalendarHeader from './CalendarHeader';
import { AlertTriangle, ArrowRightLeft, Maximize2, Minimize2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Палитра полос (визуальная логика прототипа, палитра — под светлый холст)
// ---------------------------------------------------------------------------

const CLR = {
  planBg: '#DBEAFE',
  planBorder: '#60A5FA',
  planText: '#1E3A8A',
  planArchBg: '#E5E7EB',
  planArchBorder: '#9CA3AF',
  planArchText: '#6B7280',
  planNoneBg: '#F9FAFB',
  planNoneBorder: '#9CA3AF',
  bufferA: '#FDE68A',
  fact: '#10B981',
  factOpenA: '#A7F3D0',
  gapLine: '#E5E7EB',
  gapBorder: '#D1D5DB',
  baseBorder: '#9CA3AF',
  baseText: '#4B5563',
  repair: '#D97706',
  markPlan: '#2563EB',
  markCritical: '#DC2626',
  markFact: '#10B981',
  markLate: '#E11D48',
  weekend: '#F1F2F4',
  today: '#F43F5E',
  warn: '#B45309',
};

const hatch45 = `repeating-linear-gradient(45deg, ${CLR.bufferA}, ${CLR.bufferA} 4px, transparent 4px, transparent 8px)`;
const hatchReady = `repeating-linear-gradient(45deg, #FDE68A, #FDE68A 3px, transparent 3px, transparent 6px)`;
const hatch135 = `repeating-linear-gradient(135deg, transparent, transparent 5px, ${CLR.gapLine} 5px, ${CLR.gapLine} 6px)`;
const hatchBase = `repeating-linear-gradient(135deg, transparent, transparent 4px, #CFD4DC 4px, #CFD4DC 5px)`;
const hatchOpen = `repeating-linear-gradient(45deg, ${CLR.factOpenA}, ${CLR.factOpenA} 5px, transparent 5px, transparent 10px)`;

// ---------------------------------------------------------------------------
// Модель строки машины
// ---------------------------------------------------------------------------

type PlanItem =
  | { kind: 'plan'; a: number; b: number; tripKey: string; parts: PlanBarParts; archived: boolean; statusKind: DeadlineStatusKind; open: boolean; title: string }
  | { kind: 'buffer'; a: number; b: number; days: number }
  | { kind: 'markReturn'; day: number; title: string; tripKey: string }
  | { kind: 'ready'; a: number; b: number; periodKey: string; title: string; deviation: string; archived: boolean }
  | { kind: 'handover'; point: number; from: string; to: string; note: string; title: string; chip: boolean };

type DeadlineStatusKind = 'none' | 'ok' | 'risk' | 'violated' | 'missed';

type FactItem =
  | { kind: 'fact'; a: number; b: number; open: boolean; tripKey: string; title: string }
  | { kind: 'factNone'; a: number; b: number; tripKey: string; title: string }
  | { kind: 'base'; a: number; b: number; open: boolean; label: string; periodKey: string; title: string; archived: boolean }
  | { kind: 'repair'; a: number; b: number; open: boolean; capped: boolean; periodKey: string; title: string; archived: boolean }
  | { kind: 'event'; day: number; lastDay: number; count: number; color: string; title: string; tripKey?: string; eventId?: string }
  | { kind: 'gap'; a: number; b: number; days: number }
  | { kind: 'markReady'; day: number; title: string; periodKey: string; archived: boolean }
  | { kind: 'handover'; point: number; from: string; to: string; note: string; title: string; chip: boolean };

interface CarRowModel {
  carKey: string;
  carNumber: string;
  carId: string;
  dispatcherId: string;
  dispatcherName: string;
  /** ТЕКУЩЕЕ назначение машины (справочник сцепок): по нему группируется «Все». */
  groupDispatcherId: string;
  groupDispatcherName: string;
  tripsCount: number;
  basesCount: number;
  repairsCount: number;
  warnings: string[];
  empty: boolean;
  planItems: PlanItem[];
  factItems: FactItem[];
  /** Этапы всех рейсов машины в окне — источник заливок «План»/«Факт». */
  stageInputs: StageFillInput[];
}

/** Маркер стыка смены диспетчера: точка между двумя рейсами разных диспетчеров. */
interface HandoverMark {
  /** Координата в днях (дробная: стык между днями не выдаётся за дату передачи). */
  point: number;
  /** Предыдущий и новый диспетчеры (по стабильным id исходных записей). */
  from: string;
  to: string;
  /** Подпись про дату передачи (в источниках не хранится — не выдумывается). */
  note: string;
  title: string;
}

interface BgSeg {
  left: number;
  width: number;
  kind: 'weekend' | 'today';
}

interface Props {
  /** Целые рейсы после вкладки диспетчера (архив внутри — фильтруется переключателем). */
  trips: WholeTrip[];
  /** Периоды «Учёта выезда» после вкладки диспетчера. */
  bases: BasePeriod[];
  /** События машины после вкладки. */
  events: TimelineVehicleEvent[];
  /** Машины справочника для вкладки (включая без рейсов в окне). */
  fleetCars: CarRef[];
  stageTypes: TimelineStageType[];
  today: number;
  /** Начало базового диапазона (без расширения прокруткой). */
  vs: number;
  /** Длина базового диапазона в днях (пресет периода). */
  vn: number;
  /** Дней, догруженных слева прокруткой (для сохранения видимой области). */
  extL: number;
  /** Дней, догруженных справа прокруткой. */
  extR: number;
  /** Начало базового диапазона для кнопочной навигации (без догрузки прокруткой). */
  navVs: number;
  /** Индекс уровня масштаба (см. ZOOM_LEVELS) — единый параметр ширины дня. */
  zoom: number;
  onZoomChange: (index: number) => void;
  /** Кнопки/дата двигают базовый диапазон; прокрутка — отдельный механизм. */
  onNavigate: (n: number) => void;
  /** Пользователь доскроллил до края — расширяем диапазон (без пустоты). */
  onRangeExtend: (dir: 'left' | 'right') => void;
  showArchived: boolean;
  onShowArchivedChange: (v: boolean) => void;
  /** Ключ рейса, открытого в карточке — выделяется на полотне. */
  selectedTripKey?: string | null;
  onOpenTrip: (tripKey: string) => void;
  /** Клик по маркеру события: открыть связанный рейс и выделить запись в журнале. */
  onOpenTripEvent: (tripKey: string, eventId: string) => void;
  /** Клик по заливке этапа: открыть рейс и выделить этап в карточке. */
  onOpenTripStage: (tripKey: string, stageId: string) => void;
  onOpenBase: (periodKey: string) => void;
  onOpenCar: (carKey: string) => void;
  /** Порядок диспетчеров — как во вкладках «Плана дохода» (id, по порядку справочника). */
  dispatcherOrder: string[];
  /** Вкладка «Все»: группировать машины по ТЕКУЩЕМУ диспетчеру с заголовками блоков. */
  groupByDispatcher: boolean;
  /** Текущее назначение машин (справочник сцепок) по ключу строки. */
  carCurrentDispatcher: Map<string, { id: string; name: string }>;
  /** Полноэкранный режим: рабочая область раскрыта, полотно тянется по высоте. */
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Запас по краям окна: полосы, пересекающиеся с [vs−margin, ve+margin],
 *  участвуют в цепочке, но за пределами окна обрезаются. */
const WINDOW_MARGIN = 60;

/** Минимальные высоты подстрок «План»/«Факт» (без дорожек-наложений). */
const PLAN_H = 26;
const FACT_H = 22;
/** Отступы и зазор дорожек внутри подстроки; высота растёт с числом дорожек. */
const PLAN_PAD = 5;   // 5 + 16 + 5 = 26 — прежняя высота при одной дорожке
const FACT_PAD = 3;
const TRACK_GAP = 2;
/** Высоты полос по видам (те же, что были при одной общей дорожке). */
const PLAN_BAR_H = 16;
const FACT_BAR_H = 8;
const FACT_NONE_H = 14;
const BASE_BAR_H = 14;
const REPAIR_BAR_H = 10;

const navBtn =
  'inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white border border-[#E5E7EB] text-[#4B5563] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer';

const intersects = (a: number | null, b: number | null, from: number, to: number): boolean =>
  a != null && b != null && b >= from && a <= to;

// ---------------------------------------------------------------------------
// Сборка строк
// ---------------------------------------------------------------------------

const buildRows = (
  trips: WholeTrip[],
  bases: BasePeriod[],
  events: TimelineVehicleEvent[],
  fleetCars: CarRef[],
  stageTypes: TimelineStageType[],
  showArchived: boolean,
  vs: number,
  ve: number,
  today: number,
  /** Текущее назначение машин (справочник сцепок) по ключу строки: «Все» группируется по нему. */
  carCurrentDispatcher: Map<string, { id: string; name: string }>,
): CarRowModel[] => {
  const from = vs - WINDOW_MARGIN;
  const to = ve + WINDOW_MARGIN;
  const visibleTrips = trips.filter((t) => showArchived || !t.archived);
  // Уникальность — по СТАБИЛЬНЫМ ключам исходных записей (`pd:` / `tl:` / `bz:`):
  // повторные записи одного источника не создают вторую полосу, а смена
  // диспетчера у машины не порождает дубликатов.
  const seenTripKeys = new Set<string>();
  const tripCandidates = visibleTrips.filter((t) => {
    if (seenTripKeys.has(t.key)) return false;
    const ov = t.spanOverride || {};
    const span = tripSpan(t);
    const s = ov.pMin ?? span.pMin ?? span.fMin ?? null;
    const e = ov.pMax ?? span.pMax ?? span.fMax ?? s;
    if (!intersects(s, e, from, to)) return false;
    seenTripKeys.add(t.key);
    return true;
  });

  const seenBaseKeys = new Set<string>();
  const baseCandidates = bases.filter((p) => {
    if (!showArchived && p.archived) return false; // архивные данные скрыты полностью
    if (seenBaseKeys.has(p.key)) return false;
    const rb = baseBarRange(p, today);
    const rr = repairBarRange(p, today);
    const hit = (rb && intersects(rb.a, rb.b, from, to)) || (rr && intersects(rr.a, rr.b, from, to));
    if (!hit) return false;
    seenBaseKeys.add(p.key);
    return true;
  });

  const seenEventIds = new Set<string>();
  const eventCandidates = events.filter((e) => {
    if (seenEventIds.has(e.id)) return false;
    const a = dayNum(e.dateFrom);
    const b = dayNum(e.dateTo) ?? a;
    if (!intersects(a, b, from, to)) return false;
    seenEventIds.add(e.id);
    return true;
  });

  // Машины: с данными + справочные (список уже соответствует вкладке)
  const carMap = new Map<string, { carKey: string; carNumber: string; carId: string; dispatcherId: string; dispatcherName: string }>();
  const ensureCar = (carKey: string, carNumber: string, carId: string, dispatcherId: string, dispatcherName: string) => {
    if (!carKey) return;
    if (!carMap.has(carKey)) carMap.set(carKey, { carKey, carNumber, carId, dispatcherId, dispatcherName });
  };
  tripCandidates.forEach((t) => ensureCar(t.carKey, t.carNumber, '', t.dispatcherId, t.dispatcherName));
  baseCandidates.forEach((p) => ensureCar(p.carKey, p.carNumber, p.carId, p.dispatcherId, p.dispatcherName));
  fleetCars.forEach((c) => ensureCar(`car:${c.carId || c.carNumber}`, c.carNumber, c.carId, c.dispatcherId, c.dispatcherName));

  const visible = (a: number, b: number): boolean => b >= vs && a <= ve;

  const rows: CarRowModel[] = [];
  carMap.forEach((car) => {
    const myTrips = tripCandidates
      .filter((t) => t.carKey === car.carKey)
      .sort((a, b) => ((a.spanOverride?.pMin ?? tripSpan(a).pMin) ?? 0) - ((b.spanOverride?.pMin ?? tripSpan(b).pMin) ?? 0));
    const myBases = baseCandidates
      .filter((p) => p.carKey === car.carKey)
      .sort((a, b) => (a.arrivalDay ?? a.repairStartDay ?? 0) - (b.arrivalDay ?? b.repairStartDay ?? 0));
    const myEvents = eventCandidates.filter((e) => plateKeyOf(e.carNumber) === plateKeyOf(car.carNumber));
    const warnings = new Set<string>();

    const planItems: PlanItem[] = [];
    const factItems: FactItem[] = [];

    // ── Целые рейсы: план-полоса, запас, факт/«факт не указан», маркеры ──
    myTrips.forEach((t) => {
      const ov = t.spanOverride || {};
      const span = tripSpan(t);
      const pMin = ov.pMin ?? span.pMin ?? null;
      const pMax = ov.pMax ?? span.pMax ?? null;
      t.warnings.forEach((w) => warnings.add(w));
      if (pMin == null) return; // без старта полосу не рисуем — дату не выдумываем
      const openPlan = t.openPlan === true || pMax == null;
      const planEnd = pMax ?? pMin;
      const deadline = getDeadlineStatus(t, today, (s) => stageFullName(stageTypes, s));
      if (visible(pMin, planEnd)) {
        const parts = planBarLabelParts(t);
        const shown: PlanBarParts = openPlan ? { ...parts, main: 'неполный план', meta: '' } : parts;
        planItems.push({
          kind: 'plan',
          a: pMin,
          b: planEnd,
          tripKey: t.key,
          parts: shown,
          archived: !!t.archived,
          statusKind: deadline.kind,
          open: openPlan,
          title: `${formatPlate(car.carNumber)} · ${parts.titleText} · ${t.dispatcherName || 'без диспетчера'}${t.kind === 'plan' ? ' · из плана дохода' : ''}${t.archived ? ' · архив' : ''}${openPlan ? ' · неполный план (нет даты возвращения)' : ''} · ${deadline.label}`,
        });
      }
      // Плановое возвращение — отдельный аккуратный маркер в конце плановой полосы
      // (подробности по наведению), без постоянных подписей.
      if (pMax != null && !openPlan && pMax > pMin && visible(pMax, pMax)) {
        planItems.push({
          kind: 'markReturn',
          day: pMax,
          tripKey: t.key,
          title: `плановое возвращение: ${fmtDM(pMax)}${t.archived ? ' · архив' : ''} · клик — открыть рейс`,
        });
      }
      if (t.kind === 'manual' && pMax != null && t.bufferDays > 0 && visible(pMax + 1, pMax + t.bufferDays)) {
        planItems.push({ kind: 'buffer', a: pMax + 1, b: pMax + t.bufferDays, days: t.bufferDays });
      }
      // Факт: только реально заполненные фактические даты; ничего не копируется из плана.
      // Незавершённый рейс показываем открытым периодом до текущей даты с пометкой
      // (текущую дату в данные не записываем).
      if (span.fMin != null) {
        const factEndDay = tripFactEnd(t);
        const ongoing = factEndDay == null && !t.archived;
        const fEnd = ongoing ? Math.max(today, span.fMax ?? span.fMin) : (factEndDay ?? span.fMax ?? span.fMin);
        if (visible(span.fMin, fEnd)) {
          factItems.push({
            kind: 'fact',
            a: span.fMin,
            b: fEnd,
            open: ongoing,
            tripKey: t.key,
            title: `${formatPlate(car.carNumber)} · факт: ${fmtDM(span.fMin)} – ${ongoing ? 'продолжается (окончание не указано)' : fmtDM(fEnd)}`,
          });
        }
      } else if (visible(pMin, planEnd)) {
        factItems.push({
          kind: 'factNone',
          a: pMin,
          b: planEnd,
          tripKey: t.key,
          title: 'Фактические данные не указаны',
        });
      }

      // Этапы на этой подстроке больше НЕ тонкие маркеры: они рисуются
      // заливкой ячейки дня (StageFillInput собирается ниже), поэтому здесь
      // для stages ничего не добавляется. Состав и даты не изменяются.
    });

    // ── Периоды «Учёта выезда»: ПЛАН приезд→срок готовности, ФАКТ приезд→выезд ──
    // Архивность — из СВОЕЙ записи учёта выезда (не по датам и не по соседям);
    // архивные периоды показываются только при включённой галочке и с пометкой.
    const baseRanges: Array<{ a: number; b: number }> = [];
    myBases.forEach((p) => {
      const isArch = p.archived;
      const archMark = isArch ? ' · архив' : '';
      p.warnings.forEach((w) => warnings.add(w));
      const dev = baseDeviation(p, today);
      const readyDay = p.plannedReadyDay;
      const readyTxt = readyDay != null ? fmtDM(readyDay) : 'не указан';
      const rb = baseBarRange(p, today);
      if (rb && visible(rb.a, rb.b)) {
        baseRanges.push({ a: rb.a, b: rb.b });
        const baseLabel = rb.open ? `${p.causeLabel} · выезд не указан` : dev.short ? `${p.causeLabel} · ${dev.short}` : p.causeLabel;
        factItems.push({
          kind: 'base',
          a: rb.a,
          b: rb.b,
          open: rb.open,
          label: `${baseLabel}${isArch ? ' · архив' : ''}`,
          periodKey: p.key,
          archived: isArch,
          title: `База (факт)${archMark}: приезд ${fmtDM(rb.a)} – ${rb.open ? 'выезд не указан (период продолжается)' : fmtDM(rb.b)} · срок готовности ${readyTxt} · ${dev.label}${p.comment ? ` · ${p.comment}` : ''}`,
        });
      }
      // Плановая полоса базы: приезд → срок готовности (это НЕ окончание ремонта)
      const rdy = readyBarRange(p);
      if (rdy && visible(rdy.a, rdy.b)) {
        planItems.push({
          kind: 'ready',
          a: rdy.a,
          b: rdy.b,
          periodKey: p.key,
          deviation: dev.short,
          archived: isArch,
          title: `План базы${archMark}: приезд ${fmtDM(rdy.a)} → срок готовности ${fmtDM(rdy.b)}${dev.short ? ` · ${dev.label}` : ''}`,
        });
      }
      // Отметка срока готовности на подстроке «Факт» — для сравнения с выездом
      if (readyDay != null && visible(readyDay, readyDay)) {
        factItems.push({
          kind: 'markReady',
          day: readyDay,
          periodKey: p.key,
          archived: isArch,
          title: `Срок готовности${archMark}: ${fmtDM(readyDay)} — ${dev.label}`,
        });
      }
      const rr = repairBarRange(p, today);
      if (rr && visible(rr.a, rr.b)) {
        factItems.push({
          kind: 'repair',
          a: rr.a,
          b: rr.b,
          open: rr.open,
          capped: rr.capped,
          periodKey: p.key,
          archived: isArch,
          title: `Ремонт${archMark}: ${fmtDM(rr.a)} – ${rr.open ? 'продолжается (окончание не указано)' : fmtDM(rr.b)}${rr.capped ? ' · показан до фактического выезда (ремонт не закрыт)' : ''}`,
        });
      }
    });

    // ── Промежутки «на базе»: только там, где нет записи учёта выезда ──
    const tripsSorted = [...myTrips].sort(
      (a, b) => ((a.spanOverride?.pMin ?? tripSpan(a).pMin) ?? 0) - ((b.spanOverride?.pMin ?? tripSpan(b).pMin) ?? 0),
    );
    /** Вычитаем из промежутка реальные периоды базы — остаются только «дырки» без записи. */
    const gapSegments = (start: number, end: number): Array<{ a: number; b: number }> => {
      const segs: Array<{ a: number; b: number }> = [];
      let cur = start;
      [...baseRanges].sort((x, y) => x.a - y.a).forEach((c) => {
        if (c.b < cur || c.a > end) return;
        if (c.a > cur) segs.push({ a: cur, b: Math.min(end, c.a - 1) });
        cur = Math.max(cur, c.b + 1);
      });
      if (cur <= end) segs.push({ a: cur, b: end });
      return segs;
    };
    for (let i = 0; i < tripsSorted.length - 1; i += 1) {
      const prev = tripsSorted[i];
      const next = tripsSorted[i + 1];
      const prevSpan = tripSpan(prev);
      const nextSpan = tripSpan(next);
      const prevEnd = prev.spanOverride?.pMax ?? prevSpan.pMax ?? prevSpan.fMax ?? null;
      const nextStart = next.spanOverride?.pMin ?? nextSpan.pMin ?? null;
      if (prevEnd == null || nextStart == null) continue;
      const gapStart = prevEnd + 1;
      const gapEnd = nextStart - 1;
      if (gapEnd < gapStart) continue;
      gapSegments(gapStart, gapEnd).forEach((seg) => {
        if (visible(seg.a, seg.b)) {
          factItems.push({ kind: 'gap', a: seg.a, b: seg.b, days: seg.b - seg.a + 1 });
        }
      });
    }

    // ── События (журнал рейса и старые события машины) — КОМПАКТНЫЕ маркеры ──
    // Не полосы: маркер стоит на РЕАЛЬНОЙ дате события; близкие события
    // группируются в один маркер со счётчиком, каждая запись доступна в
    // подсказке и в журнале рейса (клик — открыть рейс и показать запись).
    const evMarks: EventMark[] = [];
    myEvents.forEach((e) => {
      // Событие архивного рейса подчиняется общей галочке «Показывать архивные данные».
      const linkedTrip = e.tripKey ? trips.find((t) => t.key === e.tripKey) : undefined;
      if (e.tripKey && !showArchived && linkedTrip?.archived) return;
      const meta = eventTypeOf(e.kind);
      const mark = eventMarkOf(e, meta.name, meta.color, e.tripKey ? 'клик — открыть рейс и показать запись' : undefined);
      if (mark && visible(mark.day, mark.day)) evMarks.push(mark);
    });
    groupEventMarks(evMarks).forEach((g) => {
      factItems.push({
        kind: 'event',
        day: g.day,
        lastDay: g.lastDay,
        count: g.count,
        color: g.items[0].color,
        title: g.title,
        tripKey: g.tripKey,
        eventId: g.eventId,
      });
    });

    // ── Стыки смены диспетчера: между соседними рейсами с РАЗНЫМИ
    // диспетчерами (по стабильным id исходных записей). Это НЕ новый рейс и
    // НЕ полоса: рейсы не разрываются и не копируются, старые записи не
    // переписываются. Даты передачи в источниках нет — разделитель ставится
    // между рейсами и подписан честно («дата передачи не указана»); начало
    // следующего рейса за дату передачи не выдаётся.
    const handovers: HandoverMark[] = [];
    for (let i = 0; i < tripsSorted.length - 1; i += 1) {
      const prev = tripsSorted[i];
      const next = tripsSorted[i + 1];
      const prevDisp = prev.dispatcherId || '';
      const nextDisp = next.dispatcherId || '';
      if (!prevDisp || !nextDisp || prevDisp === nextDisp) continue;
      const prevSpan = tripSpan(prev);
      const nextSpan = tripSpan(next);
      const prevEnd = prev.spanOverride?.pMax ?? prevSpan.pMax ?? prevSpan.fMax ?? null;
      const nextStart = next.spanOverride?.pMin ?? nextSpan.pMin ?? null;
      if (prevEnd == null || nextStart == null || nextStart <= prevEnd) continue;
      // Стык: соприкасающиеся периоды — на шве; между периодами — посередине
      // промежутка (конкретный день передачи не выдумываем).
      const point = nextStart > prevEnd + 1 ? (prevEnd + nextStart) / 2 : prevEnd + 0.5;
      const prevName = prev.dispatcherName || 'без диспетчера';
      const nextName = next.dispatcherName || 'без диспетчера';
      handovers.push({
        point,
        from: prevName,
        to: nextName,
        // Дата передачи в источниках НЕ хранится: подпись честно сообщает об этом.
        note: 'дата передачи не указана',
        title: `Смена диспетчера на машине: ${prevName} → ${nextName}. Дата и время передачи не сохранены (достоверных данных нет) — начало следующего рейса датой передачи не считается.`,
      });
    }

    // Пересечения рейс↔база и этапы вне границ (не исправляем — предупреждаем)
    myTrips.forEach((t) => {
      const ov = t.spanOverride || {};
      const s = ov.pMin ?? null;
      const e = ov.pMax ?? null;
      if (s == null || e == null) return;
      baseRanges.forEach((r) => {
        if (s <= r.b && e >= r.a) warnings.add('Рейс и период на базе пересекаются — проверьте даты');
      });
      t.stages.forEach((st) => {
        const pd = dayNum(st.plannedDate);
        const ad = dayNum(st.actualDate);
        if ((pd != null && (pd < s || pd > e)) || (ad != null && (ad < s || ad > e))) {
          warnings.add('Этап оказался за границами рейса — проверьте план или событие');
        }
      });
    });

    // Заливки этапов машины — из ВСЕХ её рейсов окна (план/факт разделяются в
    // раскладке). Дата в данные не пишется: только отображение.
    const stageInputs: StageFillInput[] = [];
    myTrips.forEach((t) => {
      t.stages.forEach((s) => stageInputs.push({ tripKey: t.key, stage: s, archived: !!t.archived }));
    });

    // Стык смены диспетчера — в обе подстроки: «План» с подписью, «Факт» линией.
    handovers.forEach((h) => {
      planItems.push({ kind: 'handover', point: h.point, from: h.from, to: h.to, note: h.note, title: h.title, chip: true });
      factItems.push({ kind: 'handover', point: h.point, from: h.from, to: h.to, note: h.note, title: h.title, chip: false });
    });

    const empty = myTrips.length === 0 && myBases.length === 0;
    // Текущее назначение (справочник сцепок) — основа группировки во «Все».
    const current = carCurrentDispatcher.get(car.carKey) || null;
    rows.push({
      carKey: car.carKey,
      carNumber: car.carNumber,
      carId: car.carId,
      dispatcherId: current ? current.id : car.dispatcherId,
      dispatcherName: current ? current.name || car.dispatcherName : car.dispatcherName,
      groupDispatcherId: current ? current.id : car.dispatcherId,
      groupDispatcherName: current ? current.name || car.dispatcherName : car.dispatcherName,
      tripsCount: myTrips.length,
      basesCount: myBases.filter((p) => p.arrivalDay != null).length,
      repairsCount: myBases.filter((p) => p.repairStartDay != null).length,
      warnings: Array.from(warnings),
      empty,
      planItems,
      factItems,
      stageInputs,
    });
  });

  // Машины с данными — вперёд, затем по номеру
  return rows.sort((a, b) => {
    const ae = a.empty ? 1 : 0;
    const be = b.empty ? 1 : 0;
    if (ae !== be) return ae - be;
    return a.carNumber.localeCompare(b.carNumber, 'ru');
  });
};

// ---------------------------------------------------------------------------
// Отрисовка группы строк машины
// ---------------------------------------------------------------------------

const TimelineCarRow = React.memo(function TimelineCarRow({
  row,
  colW,
  vs,
  vn,
  bg,
  today,
  stageTypes,
  selectedTripKey,
  onOpenTrip,
  onOpenTripEvent,
  onOpenTripStage,
  onOpenBase,
  onOpenCar,
}: {
  row: CarRowModel;
  colW: number;
  vs: number;
  vn: number;
  bg: BgSeg[];
  today: number;
  stageTypes: TimelineStageType[];
  selectedTripKey?: string | null;
  onOpenTrip: (key: string) => void;
  onOpenTripEvent: (tripKey: string, eventId: string) => void;
  /** Клик по заливке этапа: открыть рейс и выделить этап в карточке. */
  onOpenTripStage: (tripKey: string, stageId: string) => void;
  onOpenBase: (key: string) => void;
  onOpenCar: (key: string) => void;
}) {
  const [hoverTrip, setHoverTrip] = useState<string | null>(null);
  const W = vn * colW;
  const ve = vs + vn - 1;
  /** Та же единая функция «дата → координата», что у шапки и сетки. */
  const pos = (a: number, b: number): { left: number; width: number } | null => barRectInWindow(a, b, vs, ve, colW);
  /** Единая визуальная система: выбранный (открытый) рейс — тёмное кольцо,
   *  наведённый — акцентное, соседние при наведении — контур (не только цветом). */
  const link = (tripKey: string): React.CSSProperties => {
    if (selectedTripKey && selectedTripKey === tripKey) {
      return { boxShadow: hoverTrip === tripKey ? 'inset 0 0 0 2px var(--accent), 0 0 0 2px rgba(18,19,22,0.55)' : '0 0 0 2px rgba(18,19,22,0.55)' };
    }
    if (!hoverTrip) return {};
    if (hoverTrip === tripKey) return { boxShadow: 'inset 0 0 0 2px var(--accent)' };
    return { boxShadow: 'inset 0 0 0 1px rgba(18,19,22,0.25)' };
  };
  const hoverProps = (tripKey: string) => ({
    onMouseEnter: () => setHoverTrip(tripKey),
    onMouseLeave: () => setHoverTrip((v) => (v === tripKey ? null : v)),
  });

  const warnTitle = row.warnings.join('\n');
  /**
   * Дорожки подстроки «План»: группа 0 — рейсы (план и запас на риски),
   * группа 1 — план базы (приезд → срок готовности). Пересекающиеся полосы
   * одной группы уходят на под-дорожки: обе видны и кликабельны. Тонкие
   * маркеры (этапы, возвращение) — наложения на всю высоту, не полосы.
   */
  const planTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const slot: Array<number | null> = row.planItems.map((it) => {
      if (it.kind === 'plan' || it.kind === 'buffer') {
        items.push({ group: 0, a: it.a, b: it.b, h: PLAN_BAR_H });
        return items.length - 1;
      }
      if (it.kind === 'ready') {
        items.push({ group: 1, a: it.a, b: it.b, h: PLAN_BAR_H });
        return items.length - 1;
      }
      return null;
    });
    return { slot, layout: layoutLaneTracks(items, { padTop: PLAN_PAD, padBottom: PLAN_PAD, gap: TRACK_GAP }) };
  }, [row.planItems]);
  const planH = Math.max(PLAN_H, planTrack.layout.laneH);
  const planTopOf = (idx: number): number => {
    const s = planTrack.slot[idx];
    return s == null ? PLAN_PAD : planTrack.layout.tops[s];
  };
  /**
   * Дорожки подстроки «Факт»: группа 0 — факт рейса («Факт не указан»),
   * группа 1 — база (приезд → выезд) и промежутки «на базе», группа 2 — ремонт.
   * Ремонт больше не лежит поверх базы: у каждой группы своя дорожка.
   */
  const factTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const slot: Array<number | null> = row.factItems.map((it) => {
      if (it.kind === 'fact') {
        items.push({ group: 0, a: it.a, b: it.b, h: FACT_BAR_H });
        return items.length - 1;
      }
      if (it.kind === 'factNone') {
        items.push({ group: 0, a: it.a, b: it.b, h: FACT_NONE_H });
        return items.length - 1;
      }
      if (it.kind === 'base' || it.kind === 'gap') {
        items.push({ group: 1, a: it.a, b: it.b, h: BASE_BAR_H });
        return items.length - 1;
      }
      if (it.kind === 'repair') {
        items.push({ group: 2, a: it.a, b: it.b, h: REPAIR_BAR_H });
        return items.length - 1;
      }
      return null;
    });
    return { slot, layout: layoutLaneTracks(items, { padTop: FACT_PAD, padBottom: FACT_PAD, gap: TRACK_GAP }) };
  }, [row.factItems]);
  const factH = Math.max(FACT_H, factTrack.layout.laneH);
  const factTopOf = (idx: number): number => {
    const s = factTrack.slot[idx];
    return s == null ? FACT_PAD : factTrack.layout.tops[s];
  };
  /** Дорожка «факта рейса» (группа 0) — над ней стоят маркеры событий. */
  const factZone0 = factTrack.layout.zones.find((z) => z.key === 0) ?? null;
  /**
   * Заливки этапов: план — в подстроке «План», факт — в «Факт». Этап с одной
   * датой закрашивает всю ячейку своего дня; несколько этапов в одном дне
   * делят ячейку на цветные секции (клик — открыть рейс и выделить этап).
   */
  const planFills = useMemo(() => layoutStageFills(row.stageInputs, 'plan', vs, ve), [row.stageInputs, vs, ve]);
  const factFills = useMemo(() => layoutStageFills(row.stageInputs, 'fact', vs, ve), [row.stageInputs, vs, ve]);
  /** Спокойная сетка: слабые вертикальные деления дней на читаемых масштабах. */
  const laneBg = colW >= 12
    ? {
        backgroundImage: `repeating-linear-gradient(to right, #F1F2F4 0px, #F1F2F4 1px, transparent 1px, transparent ${colW}px)`,
      }
    : {};
  /** Секции заливок этапов — на всю высоту подстроки, кликабельны. */
  const renderStageFill = (f: StageFillSection, keyPrefix: string) => {
    const color = stageColorOf(f.stage.type);
    const left = dayToX(f.day, vs, colW) + Math.round((f.section * colW) / f.sections);
    const right = dayToX(f.day, vs, colW) + Math.round(((f.section + 1) * colW) / f.sections);
    const width = Math.max(1, right - left);
    const open = () => onOpenTripStage(f.tripKey, f.stage.id);
    return (
      <div
        key={`${keyPrefix}-${f.tripKey}-${f.stage.id}-${f.day}`}
        role="button"
        tabIndex={0}
        data-stage-fill="1"
        data-stage={f.stage.id}
        data-trip={f.tripKey}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className="absolute top-0 bottom-0 z-[4] cursor-pointer overflow-hidden whitespace-nowrap flex items-center justify-center px-0.5"
        style={{
          left,
          width,
          background: color.bg,
          borderLeft: `1px solid ${color.border}`,
          borderRight: f.section === f.sections - 1 ? `1px solid ${color.border}` : undefined,
          color: color.text,
          ...(f.stage.isCritical ? { outline: '1px dashed #DC2626', outlineOffset: '-1px' } : {}),
          ...(f.archived ? { opacity: 0.72 } : {}),
        }}
        title={stageFillTitle(stageTypes, f.stage, f.day, today)}
      >
        {width >= 44 ? (
          <span className="text-[8px] leading-[10px] truncate max-w-full">{stageShortName(stageTypes, f.stage)}</span>
        ) : null}
      </div>
    );
  };
  /** Стык смены диспетчера: линия через подстроку; в «Плане» — с подписью. */
  const renderHandover = (it: { point: number; from: string; to: string; note: string; title: string; chip: boolean }, keyPrefix: string) => {
    const x = Math.round((it.point - vs) * colW);
    if (x < -4 || x > W + 4) return null;
    return (
      <div key={`${keyPrefix}-${it.point}`} data-tl-handover="1" className="absolute top-0 bottom-0 z-[6]" style={{ left: x, width: 0 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -1,
            top: 0,
            bottom: 0,
            borderLeft: '2px dashed #6B7280',
            opacity: 0.75,
          }}
        />
        {it.chip ? (
          <div
            title={it.title}
            data-tl-handover-chip="1"
            className="absolute flex flex-col gap-0 rounded-md border border-[#D1D5DB] bg-white/95 px-1 py-[1px] shadow-sm cursor-default"
            style={{ top: 1, left: 4, maxWidth: 240, overflow: 'hidden' }}
          >
            <span className="flex items-center gap-0.5 whitespace-nowrap text-[8px] leading-[9px] text-[#4B5563]">
              <ArrowRightLeft className="w-2.5 h-2.5 shrink-0 text-[#6B7280]" aria-hidden="true" />
              <span className="truncate" data-tl-handover-label="1">
                Передача: {it.from} → {it.to}
              </span>
            </span>
            <span className="whitespace-nowrap text-[7px] leading-[8px] text-[#9CA3AF] truncate" data-tl-handover-note="1">
              {it.note}
            </span>
          </div>
        ) : (
          <span title={it.title} className="absolute" style={{ top: 1, left: 4, width: 8, height: 8 }} aria-hidden="true" />
        )}
      </div>
    );
  };
  /** Выходные — под полосами; «сегодня» — отдельным слоем ПОВЕРХ заливок этапов
   *  (подсветка столбца остаётся различимой под цветными секциями). */
  const bgPlane = (keyPrefix: string, opacity: number) =>
    bg.filter((seg) => seg.kind === 'weekend').map((seg, i) => (
      <div
        key={`${keyPrefix}${i}`}
        className="absolute top-0 bottom-0"
        style={{
          left: seg.left,
          width: seg.width,
          background: CLR.weekend,
          opacity,
          pointerEvents: 'none',
        }}
      />
    ));
  const todayStrip = (keyPrefix: string, opacity: number) =>
    bg.filter((seg) => seg.kind === 'today').map((seg, i) => (
      <div
        key={`${keyPrefix}t${i}`}
        data-tl-today="1"
        className="absolute top-0 bottom-0 z-[5]"
        style={{
          left: seg.left,
          width: seg.width,
          background: CLR.today,
          opacity,
          pointerEvents: 'none',
        }}
      />
    ));

  return (
    <>
      {/* Подстрока «План» — закреплена слева, непрозрачный фон, ровно PLAN_H */}
      <div
        data-tl-row={row.carNumber}
        data-tl-car={row.carKey}
        className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2.5 w-[170px] min-w-[170px] overflow-hidden"
        style={{ height: planH, borderRightColor: '#D1D5DB' }}
      >
        <div className="flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenCar(row.carKey)}
            title="Обзор рейсов и периодов машины"
            className="text-[11px] leading-[13px] font-semibold text-[#121316] truncate text-left hover:text-[var(--accent-ink)] cursor-pointer"
          >
            {formatPlate(row.carNumber)}
          </button>
          <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] shrink-0 pt-0.5">План</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] leading-[12px] text-[#6B7280] truncate">
            {row.dispatcherName || 'без диспетчера'} · рейсов: {row.tripsCount}
          </span>
          {row.warnings.length ? (
            <span title={warnTitle} className="shrink-0" aria-label={warnTitle}>
              <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
            </span>
          ) : null}
        </div>
      </div>
      <div data-lane="plan" className="relative z-0 border-b border-[#EEF0F3]" style={{ width: W, height: planH, ...laneBg }}>
        {bgPlane('bg', 0.75)}
        {planFills.map((f) => renderStageFill(f, 'pf'))}
        {todayStrip('t', 0.14)}
        {row.planItems.map((it, idx) => {
          if (it.kind === 'handover') return renderHandover(it, `ph${idx}`);
          const p = pos(it.kind === 'markReturn' ? it.day : it.a, it.kind === 'markReturn' ? it.day : it.b);
          if (!p) return null;
          if (it.kind === 'ready') {
            return (
              <div
                key={`rd${idx}`}
                role="button"
                tabIndex={0}
                data-bar="ready"
                data-period={it.periodKey}
                onClick={() => onOpenBase(it.periodKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenBase(it.periodKey);
                  }
                }}
                className="absolute overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[16px] z-[2] cursor-pointer px-1 text-[#92400E]"
                style={{ left: p.left, width: p.width, top: planTopOf(idx), height: PLAN_BAR_H, background: hatchReady, border: `1px solid #F59E0B`, borderRadius: 3, ...(it.archived ? { filter: 'saturate(0.45)' } : {}) }}
                title={it.title}
              >
                {p.width > 80 ? `готовность${it.deviation ? ` · ${it.deviation}` : ''}${it.archived ? ' · архив' : ''}` : ''}
              </div>
            );
          }
          if (it.kind === 'markReturn') {
            // Аккуратный маркер планового возвращения: линия в конце рейса + клик
            return (
              <div
                key={`mr${idx}`}
                role="button"
                tabIndex={0}
                data-bar="mark-return"
                data-trip={it.tripKey}
                onClick={() => onOpenTrip(it.tripKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTrip(it.tripKey);
                  }
                }}
                className="absolute z-[2] cursor-pointer"
                style={{ left: Math.max(0, dayToX(it.day, vs, colW) + colW - 2), top: 3, height: planH - 6, width: 2, background: '#1D4ED8', borderRadius: 1 }}
                title={it.title}
              />
            );
          }
          if (it.kind === 'plan') {
            const prefix = it.statusKind === 'violated' ? '⛔ ' : it.statusKind === 'missed' ? '⌛ ' : it.statusKind === 'risk' ? '⚠ ' : '';
            return (
              <div
                key={`p${idx}`}
                role="button"
                tabIndex={0}
                data-bar="plan"
                data-trip={it.tripKey}
                {...hoverProps(it.tripKey)}
                onClick={() => onOpenTrip(it.tripKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTrip(it.tripKey);
                  }
                }}
                className="absolute overflow-hidden whitespace-nowrap text-[10px] leading-[16px] z-[3] cursor-pointer"
                style={{
                  left: p.left,
                  width: p.width,
                  top: planTopOf(idx),
                  height: PLAN_BAR_H,
                  background: it.archived ? CLR.planArchBg : CLR.planBg,
                  border: `1px solid ${it.archived ? CLR.planArchBorder : CLR.planBorder}`,
                  color: it.archived ? CLR.planArchText : CLR.planText,
                  borderRadius: 3,
                  padding: '0 4px',
                  ...link(it.tripKey),
                }}
                title={it.title}
              >
                {it.open ? (
                  <>
                    {prefix}
                    неполный план
                  </>
                ) : (
                  <PlanBarLabel parts={it.parts} prefix={prefix} width={p.width} />
                )}
              </div>
            );
          }
          if (it.kind === 'buffer') {
            return (
              <div
                key={`b${idx}`}
                data-bar="buffer"
                className="absolute z-[2]"
                style={{ left: p.left, width: p.width, top: planTopOf(idx), height: PLAN_BAR_H, background: hatch45, borderRadius: 3 }}
                title={`запас ${it.days} дн`}
              />
            );
          }
          return null;
        })}
      </div>

      {/* Подстрока «Факт» — та же закреплённая колонка, ровно FACT_H */}
      <div
        className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2.5 w-[170px] min-w-[170px] overflow-hidden"
        style={{ height: factH, borderRightColor: '#D1D5DB' }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] pt-0.5">Факт</span>
          <span className="text-[9px] leading-[11px] text-[#9CA3AF] tabular-nums">
            {row.basesCount ? `база: ${row.basesCount}` : ''}
            {row.basesCount && row.repairsCount ? ' · ' : ''}
            {row.repairsCount ? `ремонт: ${row.repairsCount}` : ''}
          </span>
        </div>
        {row.empty ? <div className="text-[9px] leading-[10px] text-[#9CA3AF]">Нет рейсов в выбранном периоде</div> : null}
      </div>
      <div data-lane="fact" className="relative z-0 border-b border-[#E5E7EB]" style={{ width: W, height: factH, ...laneBg }}>
        {bgPlane('fbg', 0.6)}
        {factFills.map((f) => renderStageFill(f, 'ff'))}
        {todayStrip('ft', 0.14)}
        {row.factItems.map((it, idx) => {
          if (it.kind === 'handover') return renderHandover(it, `fh${idx}`);
          const p =
            it.kind === 'event' || it.kind === 'markReady'
              ? pos(it.day, it.day)
              : pos(it.a, it.b);
          if (!p) return null;
          switch (it.kind) {
            case 'fact':
              return (
                <div
                  key={`f${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar="fact"
                  data-trip={it.tripKey}
                  {...hoverProps(it.tripKey)}
                  onClick={() => onOpenTrip(it.tripKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenTrip(it.tripKey);
                    }
                  }}
                  className="absolute z-[3] cursor-pointer"
                  style={{
                    left: p.left,
                    width: p.width,
                    top: factTopOf(idx),
                    height: FACT_BAR_H,
                    background: it.open ? hatchOpen : CLR.fact,
                    opacity: it.open ? 1 : 0.65,
                    border: it.open ? `1px dashed ${CLR.fact}` : undefined,
                    borderRadius: 2,
                    ...link(it.tripKey),
                  }}
                  title={it.title}
                />
              );
            case 'factNone':
              return (
                <div
                  key={`fn${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar="fact-none"
                  data-trip={it.tripKey}
                  {...hoverProps(it.tripKey)}
                  onClick={() => onOpenTrip(it.tripKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenTrip(it.tripKey);
                    }
                  }}
                  className="absolute z-[2] cursor-pointer text-[9px] leading-[14px] text-[#9CA3AF] overflow-hidden whitespace-nowrap text-ellipsis px-1"
                  style={{
                    left: p.left,
                    width: p.width,
                    top: factTopOf(idx),
                    height: FACT_NONE_H,
                    border: `1px dashed ${CLR.planNoneBorder}`,
                    borderRadius: 2,
                    background: CLR.planNoneBg,
                    ...link(it.tripKey),
                  }}
                  title={it.title}
                >
                  {p.width > 90 ? 'Факт не указан' : ''}
                </div>
              );
            case 'base':
              return (
                <div
                  key={`bs${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar="base"
                  data-period={it.periodKey}
                  onClick={() => onOpenBase(it.periodKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenBase(it.periodKey);
                    }
                  }}
                  className="absolute overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[14px] z-[2] cursor-pointer px-1"
                  style={{ left: p.left, width: p.width, top: factTopOf(idx), height: BASE_BAR_H, background: hatchBase, border: `1px ${it.archived ? 'dashed' : 'solid'} ${CLR.baseBorder}`, borderRadius: 3, color: CLR.baseText, ...(it.archived ? { filter: 'saturate(0.45)' } : {}) }}
                  title={it.title}
                >
                  {p.width > 70 ? it.label : ''}
                </div>
              );
            case 'repair':
              return (
                <div
                  key={`rp${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar="repair"
                  data-period={it.periodKey}
                  onClick={() => onOpenBase(it.periodKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenBase(it.periodKey);
                    }
                  }}
                  className="absolute overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[10px] text-white z-[3] cursor-pointer px-1 text-center"
                  style={{ left: p.left, width: p.width, top: factTopOf(idx), height: REPAIR_BAR_H, background: CLR.repair, opacity: 0.92, borderRadius: 2, ...(it.archived ? { filter: 'saturate(0.45)' } : {}) }}
                  title={it.title}
                >
                  {p.width > 60 ? `ремонт${it.archived ? ' · архив' : ''}` : ''}
                </div>
              );
            case 'event': {
              // Компактный маркер события на РЕАЛЬНОЙ дате (не полоса): ромб —
              // одиночное событие, плашка со счётчиком — группа близких событий.
              // Стоит над дорожкой «факта рейса» — полосы не перекрывает текстом.
              const evTripKey = it.tripKey;
              const evId = it.eventId;
              const linked = !!(evTripKey && evId);
              const grouped = it.count > 1;
              const left = grouped
                ? dayToX(it.day, vs, colW) + Math.round(colW * 0.45)
                : dayToX(it.day, vs, colW) + Math.round(colW * 0.62);
              const zoneTop = factZone0 ? factZone0.top : FACT_PAD;
              const zoneH = factZone0 ? factZone0.h : FACT_NONE_H;
              const markerH = grouped ? 12 : 9;
              const top = Math.max(1, zoneTop + Math.max(0, Math.round((zoneH - markerH) / 2)));
              return (
                <div
                  key={`e${idx}`}
                  role={linked ? 'button' : undefined}
                  tabIndex={linked ? 0 : undefined}
                  data-bar="event"
                  data-event={evId}
                  data-trip={evTripKey}
                  onClick={evTripKey && evId ? () => onOpenTripEvent(evTripKey, evId) : undefined}
                  onKeyDown={
                    evTripKey && evId
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenTripEvent(evTripKey, evId);
                          }
                        }
                      : undefined
                  }
                  className={`absolute z-[6] ${linked ? 'cursor-pointer' : ''}`}
                  style={
                    grouped
                      ? { left, top, height: 12, minWidth: 16, padding: '0 3px', background: '#7C3AED', borderRadius: 6, textAlign: 'center', opacity: 0.95 }
                      : { left, top, width: 9, height: 9, background: it.color, borderRadius: 2, transform: 'rotate(45deg)', opacity: 0.95 }
                  }
                  title={it.title}
                >
                  {grouped ? <span className="text-[8px] leading-[12px] text-white font-semibold">{it.count}</span> : null}
                </div>
              );
            }
            case 'gap':
              return (
                <div
                  key={`g${idx}`}
                  data-bar="gap"
                  className="absolute overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[14px] text-center z-[1]"
                  style={{ left: p.left, width: p.width, top: factTopOf(idx), height: BASE_BAR_H, background: hatch135, border: `1px dashed ${CLR.gapBorder}`, borderRadius: 3, color: CLR.baseText }}
                  title={`Между рейсами: ${it.days} дн (записи учёта выезда нет)`}
                >
                  {p.width > 70 ? `на базе · ${it.days} дн` : ''}
                </div>
              );
            case 'markReady':
              return (
                <div
                  key={`mr${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar="mark-ready"
                  data-period={it.periodKey}
                  onClick={() => onOpenBase(it.periodKey)}
                  className="absolute z-[6] cursor-pointer"
                  style={{
                    left: dayToX(it.day, vs, colW) + Math.round(colW * 0.45),
                    top: 2,
                    height: factH - 4,
                    width: 3,
                    background: CLR.warn,
                    opacity: 0.85,
                  }}
                  title={it.title}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </>
  );
});

// ---------------------------------------------------------------------------
// Таймлайн
// ---------------------------------------------------------------------------

/**
 * Фактический видимый диапазон календаря («9 октября — 24 ноября 2026»):
 * считается по датам, видимым правее закреплённой колонки, и обновляется
 * при прокрутке, масштабировании и изменении ширины окна. Живёт отдельным
 * компонентом — прокрутка не перерисовывает строки машин.
 */
function VisibleRangeLabel({
  scrollRef,
  vs,
  vn,
  colW,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  vs: number;
  vn: number;
  colW: number;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const ve = vs + vn - 1;
      const startRaw = vs + Math.floor(el.scrollLeft / colW);
      const endRaw = vs + Math.floor((el.scrollLeft + el.clientWidth - 1 - TIMELINE_COL_W) / colW);
      const startD = Math.max(vs, Math.min(startRaw, ve));
      const endD = Math.max(startD, Math.min(ve, endRaw));
      setText(visibleRangeText(startD, endD));
    };
    compute();
    const rafId = window.requestAnimationFrame(compute);
    el.addEventListener('scroll', compute);
    window.addEventListener('resize', compute);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    if (ro) ro.observe(el);
    return () => {
      window.cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
      if (ro) ro.disconnect();
    };
  }, [scrollRef, vs, vn, colW]);
  return (
    <span className="text-[11px] text-[#4B5563] tabular-nums" data-ui="visible-range">
      {text || '—'}
    </span>
  );
}

export default function TimelineGrid({
  trips,
  bases,
  events,
  fleetCars,
  stageTypes,
  today,
  vs,
  vn,
  extL,
  extR,
  navVs,
  zoom,
  onZoomChange,
  onNavigate,
  onRangeExtend,
  showArchived,
  onShowArchivedChange,
  selectedTripKey,
  onOpenTrip,
  onOpenTripEvent,
  onOpenTripStage,
  onOpenBase,
  onOpenCar,
  dispatcherOrder,
  groupByDispatcher,
  carCurrentDispatcher,
  fullscreen,
  onToggleFullscreen,
}: Props) {
  const ve = vs + vn - 1;
  const colW = zoomColW(zoom);
  const W = vn * colW;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Первичная установка позиции прокрутки выполнена. */
  const didInitScroll = useRef(false);
  /** Кнопка «Сегодня» попросила прокрутку к today при следующей навигации. */
  const wantTodayScroll = useRef(false);
  /** Предыдущее значение navVs — навигация отличается от повторного запуска эффекта. */
  const prevNavVs = useRef(navVs);
  const prevExtL = useRef(extL);
  const prevColW = useRef(colW);
  /** До этого времени программные изменения scrollLeft не считаются «скроллом к краю». */
  const lastExtend = useRef(0);
  const lastPersistDay = useRef<number | null>(null);
  /** Дата-якорь для пересчёта прокрутки при смене масштаба (центр или указатель). */
  const pendingAnchor = useRef<{ day: number; frac: number } | null>(null);

  const rows = useMemo(
    () => buildRows(trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today, carCurrentDispatcher),
    [trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today, carCurrentDispatcher],
  );

  /**
   * Блоки вкладки «Все»: машины одного диспетчера — рядом, единым блоком.
   * Порядок диспетчеров — как во вкладках «Плана дохода»; внутри блока — по
   * госномеру (сортировка стабильная: те же ключи при обновлении данных, tie —
   * по стабильному carKey). Без диспетчера — в конце, группой.
   */
  const blocks = useMemo(() => {
    if (!groupByDispatcher) return [{ key: '', name: '', rows }];
    const orderIdx = new Map<string, number>();
    dispatcherOrder.forEach((id, i) => orderIdx.set(id, i));
    const idxOf = (row: CarRowModel): number => {
      if (!row.groupDispatcherId) return Number.MAX_SAFE_INTEGER;
      const i = orderIdx.get(row.groupDispatcherId);
      return i == null ? Number.MAX_SAFE_INTEGER - 1 : i;
    };
    const sorted = [...rows].sort((a, b) => {
      const ai = idxOf(a);
      const bi = idxOf(b);
      if (ai !== bi) return ai - bi;
      const an = (a.groupDispatcherName || '').toLocaleLowerCase('ru');
      const bn = (b.groupDispatcherName || '').toLocaleLowerCase('ru');
      if (an !== bn) return an.localeCompare(bn, 'ru');
      return a.carNumber.localeCompare(b.carNumber, 'ru') || a.carKey.localeCompare(b.carKey);
    });
    const out: Array<{ key: string; name: string; rows: CarRowModel[] }> = [];
    sorted.forEach((row) => {
      const key = row.groupDispatcherId || '';
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, name: row.groupDispatcherName || '', rows: [row] });
    });
    return out;
  }, [rows, groupByDispatcher, dispatcherOrder]);

  // Фоновая дорожка одна на всё окно: выходные и подсветка всего столбца «сегодня».
  // Подсветка — ровно календарная ячейка текущего дня (та же формула левой границы
  // и ширины, что у дней сетки/шапки), если сегодня вне окна — сегмент не создаётся:
  // чужую дату не подсвечиваем и календарь автоматически не прокручиваем.
  const bg = useMemo(() => {
    const segs: BgSeg[] = [];
    for (let d = vs; d <= ve; d += 1) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) segs.push({ left: Math.round((d - vs) * colW), width: colW, kind: 'weekend' });
      if (d === today) segs.push({ left: Math.round((d - vs) * colW), width: Math.round(colW), kind: 'today' });
    }
    return segs;
  }, [vs, ve, colW, today]);

  /**
   * ЕДИНАЯ формула позиции: горизонтальная прокрутка считается из календарной
   * даты-якоря (не из пикселей), поэтому смена масштаба не сбрасывает точку
   * просмотра. frac — доля видимой календарной области (правее закреплённой
   * колонки), на которой стоит day: 0 — у колонки, 0.5 — середина, 1 — правый край.
   */
  const applyAnchor = useCallback(
    (day: number, frac: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const calW = Math.max(1, el.clientWidth - TIMELINE_COL_W);
      const target = (day - vs) * colW - frac * calW;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      if (target > max + 1) {
        // Загруженного диапазона не хватает — тянемся к краю (догрузка добавит
        // даты) и запоминаем якорь, чтобы довести его после расширения.
        pendingAnchor.current = { day, frac };
        lastExtend.current = 0;
        el.scrollLeft = max;
        return;
      }
      pendingAnchor.current = null;
      el.scrollLeft = Math.max(0, target);
    },
    [vs, colW],
  );

  const dayAtViewportX = useCallback(
    (x: number): number => {
      const el = scrollRef.current;
      if (!el) return today;
      return dayAtContentX(el.scrollLeft + x, vs, colW);
    },
    [vs, colW, today],
  );

  const persistScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const calW = Math.max(1, el.clientWidth - TIMELINE_COL_W);
      const center = dayAtContentX(el.scrollLeft + TIMELINE_COL_W + calW / 2, vs, colW);
      if (lastPersistDay.current === center) return;
      lastPersistDay.current = center;
      // Храним календарную дату-якорь, а не только пиксели: при смене масштаба
      // старый scrollLeft не применяется — позиция пересчитывается по дате.
      sessionStorage.setItem('ratipa_timeline_scroll', JSON.stringify({ day: center, frac: 0.5 }));
    } catch {
      /* не критично */
    }
  }, [vs, colW]);

  // Вход и кнопочная навигация: позиция задаётся по календарной дате.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!didInitScroll.current) {
      didInitScroll.current = true;
      try {
        const saved = JSON.parse(sessionStorage.getItem('ratipa_timeline_scroll') || 'null') as
          | { day?: number; frac?: number }
          | null;
        if (saved && typeof saved.day === 'number' && Number.isFinite(saved.day)) {
          applyAnchor(saved.day, typeof saved.frac === 'number' ? saved.frac : 0.5);
          lastExtend.current = Date.now() + 600;
          return;
        }
      } catch {
        /* не критично */
      }
      applyAnchor(today, 0.35);
      prevNavVs.current = navVs;
      lastExtend.current = Date.now() + 600;
      return;
    }
    // Повторный запуск эффекта без навигации (StrictMode/ре-рендер) позицию не трогает.
    if (prevNavVs.current === navVs) return;
    prevNavVs.current = navVs;
    if (wantTodayScroll.current) {
      wantTodayScroll.current = false;
      applyAnchor(today, 0.35);
    } else {
      applyAnchor(navVs, 0);
    }
    lastExtend.current = Date.now() + 600;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navVs]);

  // Смена масштаба: держим дату-якорь на месте (центр области или точка под
  // указателем для жеста/колеса). Старый scrollLeft без пересчёта не применяется.
  useLayoutEffect(() => {
    if (prevColW.current === colW) return;
    prevColW.current = colW;
    const el = scrollRef.current;
    const calW = el ? Math.max(1, el.clientWidth - TIMELINE_COL_W) : 1;
    const anchor = pendingAnchor.current ?? {
      day: el ? dayAtContentX(el.scrollLeft + TIMELINE_COL_W + calW / 2, vs, colW) : today,
      frac: 0.5,
    };
    pendingAnchor.current = null;
    lastExtend.current = 0; // возможная догрузка диапазона — не скачок, якорь вернём
    applyAnchor(anchor.day, anchor.frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colW]);

  // Диапазон догрузился — если якорь ждал места, доводим его точно.
  useLayoutEffect(() => {
    if (!pendingAnchor.current) return;
    applyAnchor(pendingAnchor.current.day, pendingAnchor.current.frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extL, extR, vn]);

  // Догрузка дней по краям прокрутки: без пустоты и без скачка видимой области.
  const handleScroll = useCallback(() => {
    persistScroll();
    const el = scrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (now < lastExtend.current) return; // программная прокрутка — не расширяем
    if (el.scrollLeft < colW * 2 && extL < 400) {
      lastExtend.current = now + 250;
      onRangeExtend('left');
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - colW * 2 && extR < 400) {
      lastExtend.current = now + 250;
      onRangeExtend('right');
    }
  }, [persistScroll, colW, extL, extR, onRangeExtend]);

  // Расширение влево сдвигает контент — компенсируем прокрутку ДО отрисовки
  // кадра, чтобы видимая дата (календарный якорь) не сместилась ни на пиксель.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = extL - prevExtL.current;
    prevExtL.current = extL;
    if (d > 0) el.scrollLeft = el.scrollLeft + d * colW;
  }, [extL, colW]);

  // Масштаб: кнопки/ползунок ставят якорь по центру видимой календарной области.
  const anchorFromCenter = useCallback((): { day: number; frac: number } => {
    const el = scrollRef.current;
    const calW = el ? Math.max(1, el.clientWidth - TIMELINE_COL_W) : 1;
    return { day: el ? dayAtContentX(el.scrollLeft + TIMELINE_COL_W + calW / 2, vs, colW) : today, frac: 0.5 };
  }, [vs, colW, today]);

  const setZoom = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next));
      if (clamped === zoom) return;
      pendingAnchor.current = anchorFromCenter();
      onZoomChange(clamped);
    },
    [zoom, onZoomChange, anchorFromCenter],
  );

  // Модифицированное колесо / пинч тачпада (Ctrl+wheel): масштаб под указателем.
  // Обычная вертикальная прокрутка не перехватывается; у границ масштаба жест
  // не блокируется (стандартное масштабирование браузера не ломаем).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.metaKey) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoom + dir));
      if (next === zoom) return; // на пределе — отдаём жест браузеру
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const calW = Math.max(1, rect.width - TIMELINE_COL_W);
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - TIMELINE_COL_W) / calW));
      const day = dayAtContentX(el.scrollLeft + (e.clientX - rect.left), vs, colW);
      pendingAnchor.current = { day, frac };
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom, zoom, vs, colW]);

  const goToday = useCallback(() => {
    if (navVs === today - 10) {
      // Диапазон уже сегодняшний — просто возвращаем прокрутку к today.
      applyAnchor(today, 0.35);
      lastExtend.current = Date.now() + 600;
      return;
    }
    wantTodayScroll.current = true;
    onNavigate(today - 10);
  }, [onNavigate, today, navVs, applyAnchor]);

  const shiftMonth = useCallback(
    (dir: 1 | -1) => {
      const next = dayNum(addMonthsIso(dayStr(navVs), dir));
      if (next != null) onNavigate(next);
    },
    [onNavigate, navVs],
  );

  return (
    <div className={`flex flex-col ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
      {/* Панель управления окном */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <button type="button" data-nav="month-prev" className={navBtn} onClick={() => shiftMonth(-1)}>« месяц</button>
        <button type="button" data-nav="week-prev" className={navBtn} onClick={() => onNavigate(navVs - 7)}>‹ неделя</button>
        <button
          type="button"
          data-nav="today"
          className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer"
          onClick={goToday}
        >
          Сегодня
        </button>
        <button type="button" data-nav="week-next" className={navBtn} onClick={() => onNavigate(navVs + 7)}>неделя ›</button>
        <button type="button" data-nav="month-next" className={navBtn} onClick={() => shiftMonth(1)}>месяц »</button>
        <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          Перейти к
          <DateInput
            className="w-[120px]"
            value={dayStr(navVs)}
            ariaLabel="Перейти к дате"
            onChange={(v) => {
              const n = dayNum(v);
              if (n != null) onNavigate(n);
            }}
          />
        </label>
        {/* Масштаб календаря: «−» / ползунок / «+». Ширина дня — единый параметр
            для сетки, полос и шапки; интерфейс вне календаря не масштабируется. */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Масштаб календаря" data-ui="zoom-control">
          <button
            type="button"
            data-zoom="out"
            className={`${navBtn} ${zoom <= 0 ? 'opacity-40 cursor-default' : ''}`}
            title="Уменьшить масштаб: ширина дня меньше, дат на экране больше"
            aria-label="Уменьшить масштаб"
            disabled={zoom <= 0}
            onClick={() => setZoom(zoom - 1)}
          >
            −
          </button>
          <input
            type="range"
            min={0}
            max={ZOOM_LEVELS.length - 1}
            step={1}
            value={zoom}
            data-ui="zoom-slider"
            aria-label="Масштаб календаря"
            title={`Масштаб: ${zoomLabel(zoom)} (${colW}px на день) — или Ctrl+колесо над календарём`}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 md:w-32 accent-[var(--accent)] cursor-pointer"
          />
          <button
            type="button"
            data-zoom="in"
            className={`${navBtn} ${zoom >= ZOOM_LEVELS.length - 1 ? 'opacity-40 cursor-default' : ''}`}
            title="Увеличить масштаб: деталей больше — до отдельных дней и событий"
            aria-label="Увеличить масштаб"
            disabled={zoom >= ZOOM_LEVELS.length - 1}
            onClick={() => setZoom(zoom + 1)}
          >
            +
          </button>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          Видимый диапазон:
          <VisibleRangeLabel scrollRef={scrollRef} vs={vs} vn={vn} colW={colW} />
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280] cursor-pointer select-none py-1" title="Единый переключатель: архивные рейсы плана дохода и архивные записи учёта выезда (база, ремонт)">
          <input
            type="checkbox"
            data-ui="show-archived"
            checked={showArchived}
            onChange={(e) => onShowArchivedChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
          />
          Показывать архивные данные
        </label>
        {/* Полный экран: рабочая область раскрывается на всё окно (тот же таймлайн,
            без копии). Выход — эта же кнопка или Escape. */}
        {fullscreen ? (
          <button
            type="button"
            data-ui="fullscreen-exit"
            onClick={onToggleFullscreen}
            title="Выйти из полноэкранного режима (Escape)"
            aria-label="Выйти из полноэкранного режима"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer"
          >
            <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
            Выйти из полноэкранного режима
          </button>
        ) : (
          <button
            type="button"
            data-ui="fullscreen-enter"
            onClick={onToggleFullscreen}
            title="На весь экран"
            aria-label="На весь экран"
            className={navBtn}
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="ml-1.5 hidden sm:inline">На весь экран</span>
          </button>
        )}
      </div>

      {/* Сетка — ОДИН контейнер прокрутки для шапки, сетки и полос.
          Монтируется всегда (даже без машин), чтобы позиция прокрутки не терялась
          при загрузке данных и смене вкладки диспетчера. В полноэкранном режиме
          тянется по высоте окна (max-h снимается, flex-1). */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-ui="timeline-scroll"
        className={`tl-scroll overflow-auto overscroll-x-contain border border-[#E5E7EB] rounded-xl bg-[#F9FAFB] ${
          fullscreen ? 'flex-1 min-h-0' : 'max-h-[68vh] min-h-[280px]'
        }`}
      >
        <style>{`.tl-scroll{scrollbar-width:thin;scrollbar-color:#B6BBC2 #F3F4F6;}
.tl-scroll::-webkit-scrollbar{height:12px;width:12px;}
.tl-scroll::-webkit-scrollbar-track{background:#F3F4F6;border-radius:8px;}
.tl-scroll::-webkit-scrollbar-thumb{background:#C3C8CF;border-radius:8px;border:2px solid #F3F4F6;}
.tl-scroll::-webkit-scrollbar-thumb:hover{background:#9CA3AF;}`}</style>
        <div className="grid min-w-max" style={{ gridTemplateColumns: `170px ${W}px` }}>
          {/* Шапка — закреплена сверху; левая ячейка — закреплена слева.
              Полоса месяцев и дни — в той же ленте, движутся синхронно с полосами. */}
          <div
            className="sticky left-0 top-0 z-[6] bg-[#F9FAFB] border-b border-r border-[#E5E7EB] px-2.5 py-1.5 w-[170px] min-w-[170px]"
            style={{ borderRightColor: '#D1D5DB' }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Автомобили</span>
          </div>
          <div className="sticky top-0 z-[5] bg-[#F9FAFB] border-b border-[#E5E7EB]" style={{ width: W }}>
            <CalendarHeader vs={vs} vn={vn} colW={colW} today={today} pinLeft={178} />
          </div>

          {/* Группы машин: «План» сверху, «Факт» снизу. Во вкладке «Все» — блоками
              по ТЕКУЩЕМУ диспетчеру (порядок — как во вкладках «Плана дохода»),
              внутри блока — по госномеру; без диспетчера — в конце группой. */}
          {blocks.map((block) => (
            <React.Fragment key={`blk-${block.key || 'none'}`}>
              {groupByDispatcher ? (
                <div
                  data-ui="dispatcher-group"
                  data-dgroup={block.key || 'none'}
                  className="flex items-stretch"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <div
                    className="sticky left-0 z-[3] bg-[#EEF1F5] border-r border-b border-[#E5E7EB] px-2.5 w-[170px] min-w-[170px] flex items-center gap-1.5"
                    style={{ borderRightColor: '#D1D5DB' }}
                  >
                    <span className="text-[10px] leading-[12px] font-semibold text-[#374151] truncate" title={block.name || 'Без диспетчера'}>
                      {block.name || 'Без диспетчера'}
                    </span>
                    <span className="text-[9px] leading-[11px] text-[#6B7280] shrink-0 tabular-nums">машин: {block.rows.length}</span>
                  </div>
                  <div className="bg-[#EEF1F5] border-b border-[#E5E7EB] h-[22px] min-w-0 flex-1" />
                </div>
              ) : null}
              {block.rows.map((row) => (
                <TimelineCarRow
                  key={row.carKey}
                  row={row}
                  colW={colW}
                  vs={vs}
                  vn={vn}
                  bg={bg}
                  today={today}
                  stageTypes={stageTypes}
                  selectedTripKey={selectedTripKey}
                  onOpenTrip={onOpenTrip}
                  onOpenTripEvent={onOpenTripEvent}
                  onOpenTripStage={onOpenTripStage}
                  onOpenBase={onOpenBase}
                  onOpenCar={onOpenCar}
                />
              ))}
            </React.Fragment>
          ))}
          {rows.length === 0 ? (
            <div className="col-span-2 py-10 text-center text-xs text-[#6B7280]">
              В выбранной вкладке нет машин. Проверьте вкладку диспетчера или добавьте рейс кнопкой «Новый рейс».
            </div>
          ) : null}
        </div>
      </div>

      {/* Легенда — компактная единая визуальная система (цвет + форма + штриховка) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#6B7280] mt-3">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: CLR.planBg, border: `1px solid ${CLR.planBorder}` }} />
          рейс (план — из «Плана дохода»)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[2px] h-[12px]" style={{ background: '#1D4ED8' }} />
          плановое возвращение
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatch45 }} />
          запас на риски
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[6px] rounded-[2px]" style={{ background: CLR.fact, opacity: 0.65 }} />
          факт (только заполненные даты)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchOpen, border: `1px dashed ${CLR.fact}` }} />
          факт продолжается
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: CLR.planNoneBg, border: `1px dashed ${CLR.planNoneBorder}` }} />
          «Факт не указан» (не выполнен)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchBase, border: `1px solid ${CLR.baseBorder}` }} />
          база: факт (приезд → выезд)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchReady, border: '1px solid #F59E0B' }} />
          база: план (приезд → готовность)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[8px] rounded-[2px]" style={{ background: CLR.repair }} />
          ремонт (внутри базы)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[9px] h-[9px] rotate-45 rounded-[2px]" style={{ background: '#7C3AED', opacity: 0.95 }} />
          событие машины / журнала рейса (клик — к записи)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[14px] h-[10px] rounded-[2px]" style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }} />
          этап: заливка дня — цвет по типу (клик — этап в карточке)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[2px] h-[12px]" style={{ background: 'repeating-linear-gradient(to bottom, #6B7280 0 3px, transparent 3px 6px)' }} />
          передача диспетчера (дата не указана — стык между рейсами)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[12px] h-[10px] rounded-[2px]" style={{ background: '#F9FAFB', border: '1px dashed #DC2626' }} />
          критический срок этапа
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[3px] h-[12px]" style={{ background: CLR.warn, opacity: 0.7 }} />
          плановая готовность
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: CLR.planArchBg, border: `1px solid ${CLR.planArchBorder}` }} />
          архивные данные (приглушённые)
        </span>
      </div>
      <p className="text-[10px] text-[#9CA3AF] mt-2">
        Клик по плановой или фактической полосе открывает модальное окно всего рейса; клик по названию машины — обзор её рейсов и периодов.
        Периоды базы и ремонта открываются кликом по полосе. Заливка дня — этап: клик открывает рейс и выделяет этап в карточке; несколько этапов в дне делят ячейку на цветные секции.
        Прокрутка — тачпад, Shift+колесо, полоса; масштаб — «−/+/ползунок» или Ctrl+колесо над календарём (дата под курсором остаётся на месте).
        Прокрутка догружает даты влево и вправо; выходные подсвечены фоном; «⌛» — плановая дата прошла, факт не указан, «⛔» — опоздание подтверждено фактом.
      </p>
    </div>
  );
}
