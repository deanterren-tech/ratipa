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
import { buildLegendItems } from './lib/legend';
import { planBarLabelParts, planBarLabelText, type PlanBarParts } from './PlanBarLabel';
import {
  barLabelSegments,
  estimateLabelWidth,
  labelTextFor,
  labelVariantFor,
  obstaclesFromFills,
  pickActiveSegment,
  type BarObstacle,
  type BarLabelSegment,
} from './lib/barLabels';
import { eventMarkOf, groupEventMarks, type EventMark } from './lib/eventMarks';
import {
  layoutStageFills,
  stageColorOf,
  stageFillTitle,
  stageNeighborLabel,
  stageShortName,
  type StageFillInput,
  type StageFillSection,
} from './lib/stageFills';
import {
  bzKindColor,
  bzStripeColor,
  layoutBzFills,
  type BzFillGap,
  type BzFillInput,
  type BzMark,
  type BzStripe,
} from './lib/bzFills';
import { tripRangeOf, VYEZD_STATUS, vyezdStatusIcon } from './lib/vyezd';
import { resolveRowOverlaps, type RowOverlapResolution, type RowTripAdjust, type RowTripInterval } from './lib/overlapRow';
import type { ResolvedMarker, ResolvedWarning, WaitGap } from './lib/overlap';
import {
  circleTitleOf,
  circlesOf,
  directionChipColors,
  directionOfTrip,
  mixHex,
  type DirectionDef,
  type TripCircle,
} from './lib/directions';
import {
  FACT_SEGMENT_COLORS,
  factSegmentsOfTrip,
  type FactSegment,
  type FactSegColor,
} from './lib/factSegments';
import {
  baseBarRange,
  baseDeviation,
  plateKeyOf,
  repairBarRange,
  type BasePeriod,
  type CarRef,
  type WholeTrip,
} from './lib/sources';
import DateInput from './DateInput';
import CalendarHeader from './CalendarHeader';
import { plural } from '../../../ui/kit';
import { AlertTriangle, ArrowRightLeft, CalendarClock, CarFront, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, LogIn, LogOut, Maximize2, Minimize2, Palette, TriangleAlert, Wrench } from 'lucide-react';

// ---------------------------------------------------------------------------
// Палитра полос / штриховок / маркеров / статусных значков — в lib/visuals:
// единый источник для полотна таймлайна, мини-таймлайна карточки рейса,
// попапа «Обозначения» и интерактивного гайда (guide/).
// ---------------------------------------------------------------------------
import {
  buildRowDaySections,
  periodMergeKey,
  stageMergeKeyOf,
  tripSidesOf,
  visibleStripeBounds,
  type RowDaySections,
  type RowStripeInput,
} from './lib/dayCellSections';
import {
  BAR_ICON_CLS,
  CLR,
  MARKER_TONE,
  PLAN_ACCENT,
  PLAN_ACCENT_ARCH,
  TL_Z,
  circleBadgeStyle,
  conflictHatch,
  hatch45,
  stageIconOf,
  waitHatch,
} from './lib/visuals';

/** Промежутки «Ожидание выезда»: совпадает ли полоса base-gap с зоной ожидания. */
const waitCovers = (gaps: Array<{ a: number; b: number }>, s: { a: number; b: number }): boolean =>
  gaps.some((g) => s.a <= g.b && s.b >= g.a);

// ---------------------------------------------------------------------------
// Модель строки машины
// ---------------------------------------------------------------------------

type PlanItem =
  | {
      kind: 'plan';
      a: number;
      b: number;
      tripKey: string;
      parts: PlanBarParts;
      archived: boolean;
      statusKind: DeadlineStatusKind;
      open: boolean;
      title: string;
      warn: boolean;
      dir?: DirectionDef | null;
      /** Круг рейса (правило directions.circlesOf): номер на полосе. */
      circle?: { n: number; total: number; ongoing: boolean; title: string } | null;
    }
  | { kind: 'buffer'; a: number; b: number; days: number }
  | { kind: 'markReturn'; day: number; title: string; tripKey: string }
  | { kind: 'handover'; point: number; from: string; to: string; note: string; title: string; chip: boolean };

type DeadlineStatusKind = 'none' | 'ok' | 'risk' | 'violated' | 'missed';

type FactItem =
  | { kind: 'fact'; a: number; b: number; open: boolean; tripKey: string; title: string; segments: FactSegment[]; noPlan: boolean; missedCount: number; parts: PlanBarParts }
  | { kind: 'factNone'; a: number; b: number; tripKey: string; title: string }
  | { kind: 'event'; day: number; lastDay: number; count: number; color: string; title: string; tripKey?: string; eventId?: string }
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
  /** Записи «Учёта выезда» машины в окне — источник заливок базы/ремонта. */
  bzInputs: BzFillInput[];
  /** Промежутки «на базе» между рейсами без записи учёта выезда (заливка «Факт»). */
  bzGaps: BzFillGap[];
  /** Разрешение наложений полос «План» (срезы дня смены, укорочение простоя, маркеры). */
  planOv: RowOverlapResolution;
  /** Разрешение наложений полос «Факт». */
  factOv: RowOverlapResolution;
  /** Направления рейсов машины в окне (для мини-чипа в левой колонке). */
  directions: DirectionDef[];
  /** Круги машины (правило directions.circlesOf) — бейдж в колонке и на полосе. */
  circles: TripCircle[];
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
  /** Справочник направлений (метки-чипы, фильтр и режим раскраски). */
  directions: DirectionDef[];
  /** Полноэкранный режим: рабочая область раскрыта, полотно тянется по высоте. */
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Запас по краям окна: полосы, пересекающиеся с [vs−margin, ve+margin],
 *  участвуют в цепочке, но за пределами окна обрезаются. */
const WINDOW_MARGIN = 60;

/** Минимальные высоты подстрок «План»/«Факт» — ОДИНАКОВЫЕ (единый ритм). */
const PLAN_H = 22;
const FACT_H = 22;
/** Отступы и зазор дорожек внутри подстроки; высота растёт с числом дорожек. */
const PLAN_PAD = 3;   // 3 + 16 + 3 = 22 — высота подстроки при одной дорожке
const FACT_PAD = 4;   // 4 + 14 + 4 = 22 — с «фактом не указан»; факт центрируется в дорожке
const TRACK_GAP = 2;
/** Высоты полос по видам (те же, что были при одной общей дорожке). */
const PLAN_BAR_H = 16;
const FACT_BAR_H = 8;
const FACT_NONE_H = 14;

const navBtn =
  'inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-[11px] font-medium bg-white border border-[var(--tl-hairline)] text-[var(--tl-text)] hover:text-[var(--tl-text-strong)] hover:bg-[#F3F4F6] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';
const navBtnIcon = `${navBtn} w-7 px-0`;
/** Спокойная вторичная «сегментная» оболочка панели управления. */
const barSegment = 'inline-flex items-center gap-1.5 rounded-xl border border-[var(--tl-hairline)] bg-white px-2 py-1';

const intersects = (a: number | null, b: number | null, from: number, to: number): boolean =>
  a != null && b != null && b >= from && a <= to;

/** Сводка цветов сегментов факта для подсказки полосы: «в срок — 3 дн; опоздание 1–2 дня — 2 дн». */
const factSegSummaryOf = (segs: FactSegment[]): string => {
  const byColor = new Map<FactSegColor, number>();
  segs.forEach((s) => byColor.set(s.color, (byColor.get(s.color) || 0) + (s.b - s.a + 1)));
  return Array.from(byColor.entries())
    .map(([c, days]) => `${FACT_SEGMENT_COLORS[c].label} — ${days} дн`)
    .join('; ');
};

/** Единый стиль бейджа круга — в lib/visuals (circleBadgeStyle): один источник
 *  с гайдом и справочником. */

/**
 * Дорожки полос по интервалам (жадная раскладка, как у полос базы): при
 * пересечении полосы одной подстроки делят высоту — обе видны и кликабельны.
 */
const barLanesOf = (itv: Array<{ a: number; b: number }>): Array<{ lane: number; lanes: number }> => {
  const order = itv.map((_, i) => i).sort((x, y) => itv[x].a - itv[y].a || itv[x].b - itv[y].b || x - y);
  const laneOf: number[] = new Array(itv.length).fill(0);
  const laneEnds: number[] = [];
  order.forEach((i) => {
    let li = laneEnds.findIndex((end) => end < itv[i].a);
    if (li === -1) {
      li = laneEnds.length;
      laneEnds.push(itv[i].b);
    } else {
      laneEnds[li] = itv[i].b;
    }
    laneOf[i] = li;
  });
  const lanes = Math.max(1, laneEnds.length);
  return itv.map((_, i) => ({ lane: laneOf[i], lanes }));
};

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
  /** Справочник направлений (метки и фильтр; данные рейсов не меняются). */
  directions: DirectionDef[],
  /** Активные чипы фильтра направлений (null — все рейсы). */
  dirFilter: string[] | null,
): CarRowModel[] => {
  const from = vs - WINDOW_MARGIN;
  const to = ve + WINDOW_MARGIN;
  const visibleTrips = trips.filter((t) => showArchived || !t.archived);
  /** Круги машин — правило владельца (lib/directions, circlesOf): один рейс на
   *  внешнем направлении = один круг; считаются по всем рейсам вкладки (включая
   *  архивные — номер не зависит от галочки «архивные данные»). */
  const circlesByCar = circlesOf(trips, directions, bases);
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
    // Фильтр направлений — только видимость: выбранные направления показываются,
    // остальные скрываются; рейсы без направления при активном фильтре скрыты.
    if (dirFilter && dirFilter.length) {
      const d = directionOfTrip(t, directions);
      if (!d || !dirFilter.includes(d.name)) return false;
    }
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
    const carCircles = circlesByCar.get(car.carKey) || [];
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
    /** Интервалы, ОТОБРАЖАЕМЫЕ в подстроках, — вход разрешения наложений (lib/overlap). */
    const planInts: RowTripInterval[] = [];
    const factInts: RowTripInterval[] = [];

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
      const tripLabel = `Рейс «${t.route || 'без маршрута'}»`;
      const deadline = getDeadlineStatus(t, today, (s) => stageFullName(stageTypes, s));
      const dir = directionOfTrip(t, directions);
      const parts = planBarLabelParts(t);
      if (visible(pMin, planEnd)) {
        const shown: PlanBarParts = openPlan ? { ...parts, main: 'неполный план', meta: '' } : parts;
        const circ = carCircles.find((c) => c.tripKey === t.key) || null;
        planItems.push({
          kind: 'plan',
          a: pMin,
          b: planEnd,
          tripKey: t.key,
          parts: shown,
          archived: !!t.archived,
          statusKind: deadline.kind,
          open: openPlan,
          warn: false,
          dir,
          circle: circ ? { n: circ.n, total: carCircles.length, ongoing: circ.ongoing, title: circleTitleOf(circ, carCircles.length) } : null,
          title: `${formatPlate(car.carNumber)} · ${parts.titleText} · ${t.dispatcherName || 'без диспетчера'}${dir ? ` · направление: ${dir.name}` : ''}${circ ? ` · круг ${circ.n} из ${carCircles.length}${circ.ongoing ? ' (идёт)' : ''}` : ''}${t.kind === 'plan' ? ' · из плана дохода' : ''}${t.archived ? ' · архив' : ''}${openPlan ? ' · неполный план (нет даты возвращения)' : ''} · ${deadline.label}`,
        });
      }
      planInts.push({ key: t.key, a: pMin, b: planEnd, open: openPlan, label: tripLabel });
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
        factInts.push({ key: t.key, a: span.fMin, b: fEnd, open: ongoing, label: tripLabel });
        if (visible(span.fMin, fEnd)) {
          // Сегменты цвета факта — ОДИН расчёт на рейс (чистая функция
          // lib/factSegments: правила отставания/критического срока в одном месте).
          const segRes = factSegmentsOfTrip(t, span.fMin, fEnd, today);
          factItems.push({
            kind: 'fact',
            a: span.fMin,
            b: fEnd,
            open: ongoing,
            tripKey: t.key,
            segments: segRes.segments,
            noPlan: segRes.noPlan,
            missedCount: segRes.missed.length,
            parts,
            title: `${formatPlate(car.carNumber)} · факт: ${fmtDM(span.fMin)} – ${ongoing ? 'продолжается (окончание не указано)' : fmtDM(fEnd)} · ${factSegSummaryOf(segRes.segments)}${
              segRes.noPlan ? ' · план не указан' : ''
            }${segRes.missed.length ? ` · пропущено этапов: ${segRes.missed.length} (${segRes.missed.map((m) => m.label).join(', ')})` : ''}`,
          });
        }
      } else {
        factInts.push({ key: t.key, a: pMin, b: planEnd, open: openPlan, label: tripLabel });
        if (visible(pMin, planEnd)) {
          factItems.push({
            kind: 'factNone',
            a: pMin,
            b: planEnd,
            tripKey: t.key,
            title: 'Фактические данные не указаны',
          });
        }
      }

      // Этапы на этой подстроке больше НЕ тонкие маркеры: они рисуются
      // заливкой ячейки дня (StageFillInput собирается ниже), поэтому здесь
      // для stages ничего не добавляется. Состав и даты не изменяются.
    });

    // ── Периоды «Учёта выезда» ──
    // Отметки базы/ремонта больше НЕ тонкие полосы: layoutBzFills ниже раскладывает
    // их заливкой ячейки дня (план базы и готовность — в «План», факт базы, ремонт,
    // окончание ремонта — в «Факт»). Здесь собираются только видимые интервалы
    // (чтобы вычесть их из промежутков «на базе») — даты и границы не меняются.
    const baseRanges: Array<{ a: number; b: number }> = [];
    myBases.forEach((p) => {
      p.warnings.forEach((w) => warnings.add(w));
      const rb = baseBarRange(p, today);
      if (rb && visible(rb.a, rb.b)) {
        baseRanges.push({ a: rb.a, b: rb.b });
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
    const bzGaps: BzFillGap[] = [];
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
          bzGaps.push({ a: seg.a, b: seg.b, days: seg.b - seg.a + 1 });
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

    // ── Разрешение наложений (lib/overlap → lib/overlapRow): считается ОДИН РАЗ
    // на машину и подстроку, ПЛАН и ФАКТ отдельно (правила не смешиваются);
    // рендер использует только результат этой функции. ──
    const planOv = resolveRowOverlaps(myBases, planInts, 'plan', today, fmtDM, formatPlate(car.carNumber));
    const factOv = resolveRowOverlaps(myBases, factInts, 'fact', today, fmtDM, formatPlate(car.carNumber));

    // Пересечения рейс↔база (точные зоны — из разрешения наложений) и этапы вне
    // границ (не исправляем — предупреждаем). Дополнительно отмечаем «свои» рейсы:
    // на их полосе показывается компактный значок (полный текст — в подсказке).
    const tripWarnKeys = new Set<string>();
    [...planOv.warnings, ...factOv.warnings].forEach((w) => {
      warnings.add(w.title);
      w.refs.forEach((k) => {
        if (!k.startsWith('bz:')) tripWarnKeys.add(k);
      });
    });
    myTrips.forEach((t) => {
      if (t.warnings.length) tripWarnKeys.add(t.key);
      const ov = t.spanOverride || {};
      const s = ov.pMin ?? null;
      const e = ov.pMax ?? null;
      if (s == null || e == null) return;
      t.stages.forEach((st) => {
        const pd = dayNum(st.plannedDate);
        const ad = dayNum(st.actualDate);
        if ((pd != null && (pd < s || pd > e)) || (ad != null && (ad < s || ad > e))) {
          warnings.add('Этап оказался за границами рейса — проверьте план или событие');
          tripWarnKeys.add(t.key);
        }
      });
    });
    planItems.forEach((it) => {
      if (it.kind === 'plan' && tripWarnKeys.has(it.tripKey)) it.warn = true;
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
    // Направления рейсов машины в окне (уникальные, в порядке появления) — для
    // мини-чипа в левой колонке; данные рейсов не меняются.
    const rowDirs: DirectionDef[] = [];
    myTrips.forEach((t) => {
      const d = directionOfTrip(t, directions);
      if (d && !rowDirs.some((x) => x.name === d.name)) rowDirs.push(d);
    });
    // Рейсы машины для статуса и подсказки полосы «Учёт выезда» — по модульным
    // вкладкам, но без фильтра архивной галочки и без клипа видимой области:
    // статус не должен меняться от прокрутки и переключателя архива.
    const seenRangeKeys = new Set<string>();
    const carTripRanges = trips
      .filter((t) => {
        if (t.carKey !== car.carKey || seenRangeKeys.has(t.key)) return false;
        seenRangeKeys.add(t.key);
        return true;
      })
      .map((t) => tripRangeOf(t))
      .filter((r): r is NonNullable<typeof r> => !!r);
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
      bzInputs: myBases.map((p) => ({ period: p, tripRanges: carTripRanges })),
      bzGaps,
      planOv,
      factOv,
      directions: rowDirs,
      circles: carCircles,
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

/** Бейдж статуса машины «на сегодня» (только отображение, данные не меняются). */
interface TodayBadge {
  label: string;
  bg: string;
  fg: string;
  dot: string;
  title: string;
}

/**
 * Статус машины для компактного бейджа в левой колонке: просроченная
 * готовность → ремонт → в рейсе → на базе. Считается по тем же данным и
 * функциям источников, что и полосы (ничего не выдумывается и не пишется).
 */
const todayBadgeOf = (row: CarRowModel, today: number): TodayBadge | null => {
  const live = row.bzInputs.map((b) => b.period).filter((p) => !p.archived);
  for (const p of live) {
    if (baseDeviation(p, today).kind === 'overdue') {
      return {
        label: 'срок просрочен',
        bg: '#FDEBEE',
        fg: '#9F1239',
        dot: '#E11D48',
        title: 'Срок готовности просрочен: плановая дата прошла, фактический выезд не указан',
      };
    }
  }
  for (const p of live) {
    const rr = repairBarRange(p, today);
    if (rr && today >= rr.a && today <= rr.b) {
      return {
        label: 'ремонт',
        bg: '#FCEEDC',
        fg: '#8A4A0E',
        dot: '#EA580C',
        title: `Ремонт: ${fmtDM(rr.a)} – ${rr.open ? 'продолжается (окончание не указано)' : fmtDM(rr.b)}`,
      };
    }
  }
  const inTrip =
    row.planItems.some((it) => it.kind === 'plan' && ((it.a <= today && today <= it.b) || (it.open && it.a <= today))) ||
    row.factItems.some((it) => it.kind === 'fact' && it.a <= today && today <= it.b);
  if (inTrip) {
    return { label: 'в рейсе', bg: '#DFF3EA', fg: '#0F6247', dot: '#12B76A', title: 'Сегодня машина в рейсе (полоса покрывает текущую дату)' };
  }
  for (const p of live) {
    const rb = baseBarRange(p, today);
    if (rb && today >= rb.a && today <= rb.b) {
      return {
        label: 'на базе',
        bg: '#FBF2D3',
        fg: '#7A5806',
        dot: '#D97706',
        title: `На базе: ${fmtDM(rb.a)} – ${rb.open ? 'выезд не указан (период продолжается)' : fmtDM(rb.b)}`,
      };
    }
  }
  return null;
};

const TimelineCarRow = React.memo(function TimelineCarRow({
  row,
  colW,
  carColW,
  vs,
  vn,
  bg,
  today,
  zebra,
  stageTypes,
  selectedTripKey,
  paintByDirection,
  onOpenTrip,
  onOpenTripEvent,
  onOpenTripStage,
  onOpenBase,
  onOpenCar,
}: {
  row: CarRowModel;
  colW: number;
  /** Ширина закреплённой колонки «Автомобили» (регулируемая). */
  carColW: number;
  vs: number;
  vn: number;
  bg: BgSeg[];
  today: number;
  /** Чётная машина — лёгкая зебра фона строк. */
  zebra: boolean;
  stageTypes: TimelineStageType[];
  selectedTripKey?: string | null;
  /** Режим «Раскрасить по направлению»: подсветка полос рейсов, данные не меняются. */
  paintByDirection: boolean;
  onOpenTrip: (key: string) => void;
  onOpenTripEvent: (tripKey: string, eventId: string) => void;
  /** Клик по заливке этапа: открыть рейс и выделить этап в карточке. */
  onOpenTripStage: (tripKey: string, stageId: string) => void;
  onOpenBase: (key: string) => void;
  onOpenCar: (key: string) => void;
}) {
  const [hoverTrip, setHoverTrip] = useState<string | null>(null);
  const [rowHover, setRowHover] = useState(false);
  const rowSel = `[data-tl-car="${row.carKey}"]`;
  const onRowEnter = useCallback(() => setRowHover(true), []);
  const onRowLeave = useCallback(
    (e: React.MouseEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (to && typeof to.closest === 'function' && to.closest(rowSel)) return;
      setRowHover(false);
    },
    [rowSel],
  );
  const cellBg = rowHover ? 'var(--tl-hover)' : zebra ? 'var(--tl-zebra)' : 'var(--tl-col-bg)';
  const laneRowBg = rowHover ? 'var(--tl-hover)' : zebra ? 'var(--tl-zebra)' : 'transparent';
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

  /** Правка полосы рейса из разрешения наложений (доли дня смены у краёв). */
  const adjRect = (
    p: { left: number; width: number } | null,
    adj: RowTripAdjust | null,
  ): { left: number; width: number } | null => {
    if (!p || !adj) return p;
    const l = p.left + Math.round(adj.fracA * colW);
    const r = p.left + p.width - Math.round((1 - adj.fracB) * colW);
    return { left: l, width: Math.max(1, r - l) };
  };
  /** Маркер стыка (выезд / прибытие / выехала раньше): SVG-иконка на срезе дня.
   *  Клик — окно «Учёта выезда» через единый хелпер (onOpenBase → openVyezdPeriod). */
  const renderOvMarker = (m: ResolvedMarker, keyPrefix: string, rowH: number): React.ReactNode => {
    const x = dayToX(m.day, vs, colW) + Math.round(colW * m.frac);
    if (x < -12 || x > W + 12) return null;
    const tone =
      m.kind === 'early-departure'
        ? MARKER_TONE['early-departure']
        : m.kind === 'departure'
          ? MARKER_TONE.departure
          : MARKER_TONE.arrival;
    const Icon = m.kind === 'arrival' ? LogIn : LogOut;
    const open = m.periodKey
      ? () => onOpenBase(m.periodKey as string)
      : m.tripKey
        ? () => onOpenTrip(m.tripKey as string)
        : undefined;
    const top = Math.max(1, Math.round((rowH - 14) / 2));
    return (
      <div
        key={`${keyPrefix}-${m.kind}-${m.day}-${m.tripKey || ''}`}
        role={open ? 'button' : undefined}
        tabIndex={open ? 0 : undefined}
        data-tl-marker={m.kind}
        data-tl-marker-day={m.day}
        data-tl-marker-frac={m.frac}
        data-tl-marker-period={m.periodKey || undefined}
        data-tl-marker-trip={m.tripKey || undefined}
        onClick={open}
        onKeyDown={
          open
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open();
                }
              }
            : undefined
        }
        className={`absolute flex items-center justify-center rounded-full select-none ${open ? 'cursor-pointer' : ''}`}
        style={{
          zIndex: TL_Z.mark,
          left: x - 7,
          top,
          width: 14,
          height: 14,
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          boxShadow: '0 1px 2px rgba(18,19,22,0.18)',
        }}
        title={m.title}
      >
        <Icon className="w-2.5 h-2.5" style={{ color: tone.fg }} aria-hidden="true" />
      </div>
    );
  };
  /** Промежуток «Ожидание выезда»: нейтральная штриховка с подписью (учёт не закрыт). */
  const renderWaitGap = (g: WaitGap & { periodKey: string }, keyPrefix: string): React.ReactNode => {
    const clipA = Math.max(g.a, vs);
    const clipB = Math.min(g.b, ve);
    if (clipB < clipA) return null;
    const left = dayToX(clipA, vs, colW);
    const width = Math.max(1, dayToX(clipB, vs, colW) + colW - left);
    return (
      <div
        key={`${keyPrefix}-${g.periodKey}-${g.a}-${g.b}`}
        data-tl-wait="1"
        data-tl-wait-a={g.a}
        data-tl-wait-b={g.b}
        data-tl-wait-days={g.days}
        title={g.title}
        className="absolute top-0 bottom-0 flex items-center overflow-hidden cursor-default"
        style={{
          zIndex: TL_Z.bz,
          left,
          width,
          background: waitHatch,
          borderLeft: '1px dashed #94A3B8',
          borderRight: '1px dashed #94A3B8',
        }}
      >
        {width >= 86 ? (
          <span className="text-[8px] leading-[10px] font-semibold text-[#475569] bg-white/90 border border-[#CBD5E1] rounded px-1 whitespace-nowrap ml-0.5">
            Ожидание выезда · {g.days} дн
          </span>
        ) : null}
      </div>
    );
  };
  /** Конфликт данных: тонкая штриховка зоны + значок со ссылкой на источник. */
  const renderConflict = (w: ResolvedWarning, keyPrefix: string, rowH: number, keyIdx = 0): React.ReactNode => {
    const clipA = Math.max(w.a, vs);
    const clipB = Math.min(w.b, ve);
    if (clipB < clipA) return null;
    const left = dayToX(clipA, vs, colW);
    const width = Math.max(1, dayToX(clipB, vs, colW) + colW - left);
    const open = () => {
      const k = w.refs[0] || '';
      if (k.startsWith('bz:')) onOpenBase(k);
      else onOpenTrip(k);
    };
    return (
      <div
        key={`${keyPrefix}-${keyIdx}-${w.a}-${w.b}`}
        data-tl-conflict="1"
        data-tl-conflict-a={w.a}
        data-tl-conflict-b={w.b}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{ zIndex: TL_Z.mark, left, width }}
      >
        <div aria-hidden="true" className="absolute inset-0" style={{ background: conflictHatch, borderRadius: 'var(--tl-bar-r)' }} />
        <div
          role="button"
          tabIndex={0}
          data-tl-conflict-icon="1"
          data-refs={w.refs.join(',')}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }}
          className="absolute pointer-events-auto flex items-center justify-center rounded-full cursor-pointer"
          style={{
            left: Math.max(0, Math.round(width / 2) - 6),
            top: Math.max(0, Math.round((rowH - 12) / 2)),
            width: 12,
            height: 12,
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #EFA3B1',
          }}
          title={w.title}
        >
          <TriangleAlert className="w-2.5 h-2.5" style={{ color: '#BE123C' }} aria-hidden="true" />
        </div>
      </div>
    );
  };

  const warnTitle = row.warnings.join('\n');
  /**
   * Дорожки подстроки «План»: группа 0 — рейсы (план и запас на риски).
   * Пересекающиеся полосы одной группы уходят на под-дорожки: обе видны и
   * кликабельны. Тонкие маркеры (возвращение) — наложения на всю высоту.
   * План базы и срок готовности — заливки ячейки дня (layoutBzFills), не полосы.
   */
  const planTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const slot: Array<number | null> = row.planItems.map((it) => {
      if (it.kind === 'plan' || it.kind === 'buffer') {
        items.push({ group: 0, a: it.a, b: it.b, h: PLAN_BAR_H });
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
   * Дорожки подстроки «Факт»: группа 0 — факт рейса («Факт не указан»).
   * База, ремонт и промежутки «на базе» — заливки ячейки дня (layoutBzFills);
   * вертикальных дорожек под них больше не требуется.
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
      return null;
    });
    return { slot, layout: layoutLaneTracks(items, { padTop: FACT_PAD, padBottom: FACT_PAD, gap: TRACK_GAP }) };
  }, [row.factItems]);
  const factH = Math.max(FACT_H, factTrack.layout.laneH);
  /** Дорожка «факта рейса» (группа 0) — над ней стоят маркеры событий. */
  const factZone0 = factTrack.layout.zones.find((z) => z.key === 0) ?? null;
  /**
   * Дорожки полос рейса (lane/lanes) — та же модель раскладки, что у полос
   * базы/ремонта: при пересечении полосы делят высоту подстроки, обе видны.
   */
  const planBarLanes = useMemo(() => {
    const idxs: number[] = [];
    const itv: Array<{ a: number; b: number }> = [];
    row.planItems.forEach((it, i) => {
      if (it.kind === 'plan' || it.kind === 'buffer') {
        idxs.push(i);
        itv.push({ a: it.a, b: it.b });
      }
    });
    const info = barLanesOf(itv);
    const m = new Map<number, { lane: number; lanes: number }>();
    idxs.forEach((ii, k) => m.set(ii, info[k]));
    return m;
  }, [row.planItems]);
  const factBarLanes = useMemo(() => {
    const idxs: number[] = [];
    const itv: Array<{ a: number; b: number }> = [];
    row.factItems.forEach((it, i) => {
      if (it.kind === 'fact' || it.kind === 'factNone') {
        idxs.push(i);
        itv.push({ a: it.a, b: it.b });
      }
    });
    const info = barLanesOf(itv);
    const m = new Map<number, { lane: number; lanes: number }>();
    idxs.forEach((ii, k) => m.set(ii, info[k]));
    return m;
  }, [row.factItems]);
  /** Тонкая штриховка проблемных сегментов (оранжевый/красный) — вторичный
   *  признак для дальтоников (вместе со значком в начале сегмента). */
  const segHatch = (color: FactSegColor): string =>
    color === 'red'
      ? 'repeating-linear-gradient(45deg, rgba(159,18,57,0.16), rgba(159,18,57,0.16) 2px, transparent 2px, transparent 7px)'
      : 'repeating-linear-gradient(45deg, rgba(138,58,10,0.16), rgba(138,58,10,0.16) 2px, transparent 2px, transparent 7px)';
  /** Подсказка сегмента: этап, план, факт, отставание в днях, причина цвета. */
  const segTitleOf = (s: FactSegment): string => {
    const st = FACT_SEGMENT_COLORS[s.color];
    const parts: string[] = [s.stageLabel ? `Этап «${s.stageLabel}»` : 'Участок факта'];
    parts.push(s.planDay != null ? `план ${fmtDM(s.planDay)}` : 'план не указан');
    parts.push(s.factDay != null ? `факт ${fmtDM(s.factDay)}` : 'факт ещё не внесён');
    if (s.lagDays != null) parts.push(s.lagDays > 0 ? `отставание: +${s.lagDays} дн` : 'отставание: нет');
    parts.push(`цвет: ${st.label}`);
    return `${parts.join(' · ')}\n${s.reason}`;
  };
  /** Сегменты факта — ОДИН элемент на сегмент, стыкуются без зазоров и
   *  разделителей (граница сегментов — день завершения этапа). */
  const factSegEls = (segs: FactSegment[], barLeft: number, barWidth: number): React.ReactNode[] =>
    segs.map((s, i) => {
      const st = FACT_SEGMENT_COLORS[s.color];
      const left = Math.max(0, Math.round(dayToX(s.a, vs, colW) - barLeft));
      const right = Math.min(barWidth, Math.round(dayToX(s.b, vs, colW) + colW - barLeft));
      const width = Math.max(1, right - left);
      const first = i === 0;
      const last = i === segs.length - 1;
      const problem = s.color === 'orange' || s.color === 'red';
      return (
        <span
          key={`seg-${s.a}-${s.b}-${s.color}-${i}`}
          data-fact-seg={`${s.a}-${s.b}-${s.color}`}
          data-fact-seg-color={s.color}
          className="absolute top-0 bottom-0"
          style={{
            left,
            width,
            background: st.bg,
            ...(problem ? { backgroundImage: segHatch(s.color) } : {}),
            borderTop: `1px solid ${st.border}`,
            borderBottom: `1px solid ${st.border}`,
            ...(first ? { borderLeft: `1px solid ${st.border}` } : {}),
            ...(last ? { borderRight: `1px solid ${st.border}` } : {}),
          }}
          title={segTitleOf(s)}
        >
          {problem && width >= 18 ? (
            <TriangleAlert
              className="absolute left-0.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5"
              style={{ color: st.text }}
              aria-hidden="true"
            />
          ) : null}
        </span>
      );
    });
  /**
   * Полосы и отметки базы/ремонта: НЕПРЕРЫВНЫЕ полосы периодов (один элемент на
   * период — не по элементу на день) и однодневные отметки «срок готовности» /
   * «дата окончания ремонта» на всю ячейку. План базы и готовность — в подстроке
   * «План»; факт базы, ремонт, окончание ремонта и промежутки «на базе» — в
   * «Факт». Открытые периоды обрезаются теми же функциями источников, что и
   * раньше (границы не меняются).
   */
  const planBz = useMemo(
    () => layoutBzFills(row.bzInputs, [], 'plan', vs, ve, today),
    [row.bzInputs, vs, ve, today],
  );
  const factBz = useMemo(
    () => layoutBzFills(row.bzInputs, row.bzGaps, 'fact', vs, ve, today),
    [row.bzInputs, row.bzGaps, vs, ve, today],
  );
  /**
   * ДОЛИ ЯЧЕЙКИ ДНЯ — единое правило lib/dayCellSections: слева предыдущее
   * событие дня, справа следующее (например, выгрузка слева, начало
   * ремонта/простоя справа), с учётом якорей дня смены (срезы полос рейса из
   * lib/overlap). Полосы строки входят в раскладку со своими ВИДИМЫМИ
   * границами (укорочение простоя и срезы — как в отрисовке).
   */
  const stageLabelOf = useCallback((it: StageFillInput) => stageNeighborLabel(stageTypes, it.stage), [stageTypes]);
  const planStripeInputs = useMemo<RowStripeInput[]>(
    () =>
      planBz.stripes.map((s) => {
        const vis = visibleStripeBounds(s, row.planOv);
        return { kind: s.kind, a: vis.a, b: vis.b, fracA: vis.fracA, fracB: vis.fracB, periodKey: s.periodKey, label: s.label };
      }),
    [planBz.stripes, row.planOv],
  );
  const factStripeInputs = useMemo<RowStripeInput[]>(
    () =>
      factBz.stripes.map((s) => {
        const vis = visibleStripeBounds(s, row.factOv);
        return { kind: s.kind, a: vis.a, b: vis.b, fracA: vis.fracA, fracB: vis.fracB, periodKey: s.periodKey, label: s.label };
      }),
    [factBz.stripes, row.factOv],
  );
  const planTripSides = useMemo(
    () =>
      tripSidesOf(
        row.planItems.filter((it): it is Extract<PlanItem, { kind: 'plan' }> => it.kind === 'plan').map((it) => ({ tripKey: it.tripKey, a: it.a, b: it.b })),
        row.planOv,
      ),
    [row.planItems, row.planOv],
  );
  const factTripSides = useMemo(
    () =>
      tripSidesOf(
        row.factItems
          .filter((it): it is Extract<FactItem, { kind: 'fact' | 'factNone' }> => it.kind === 'fact' || it.kind === 'factNone')
          .map((it) => ({ tripKey: it.tripKey, a: it.a, b: it.b })),
        row.factOv,
      ),
    [row.factItems, row.factOv],
  );
  const planSec = useMemo(
    () =>
      buildRowDaySections({
        kind: 'plan',
        vs,
        ve,
        stages: row.stageInputs,
        stageLabelOf,
        stripes: planStripeInputs,
        marks: planBz.marks,
        tripSides: planTripSides,
      }),
    [vs, ve, row.stageInputs, stageLabelOf, planStripeInputs, planBz.marks, planTripSides],
  );
  const factSec = useMemo(
    () =>
      buildRowDaySections({
        kind: 'fact',
        vs,
        ve,
        stages: row.stageInputs,
        stageLabelOf,
        stripes: factStripeInputs,
        marks: factBz.marks,
        tripSides: factTripSides,
      }),
    [vs, ve, row.stageInputs, stageLabelOf, factStripeInputs, factBz.marks, factTripSides],
  );
  /** Заливки этапов: план — в подстроке «План», факт — в «Факт»; доли дня — из единой раскладки. */
  const planFills = useMemo(
    () => layoutStageFills(row.stageInputs, 'plan', vs, ve, planSec.slotForStage),
    [row.stageInputs, vs, ve, planSec],
  );
  const factFills = useMemo(
    () => layoutStageFills(row.stageInputs, 'fact', vs, ve, factSec.slotForStage),
    [row.stageInputs, vs, ve, factSec],
  );
  /** Спокойная сетка: слабые вертикальные деления дней на читаемых масштабах. */
  const laneBg = colW >= 12
    ? {
        backgroundImage: `repeating-linear-gradient(to right, #F1F2F4 0px, #F1F2F4 1px, transparent 1px, transparent ${colW}px)`,
      }
    : {};
  /** Секции заливок этапов — на всю высоту подстроки, кликабельны, в новом стиле
   *  (единое скругление, заливка, hover/focus). Этапы — ВСЕГДА поверх полос
   *  (слой TL_Z.stage); доля дня — из единого правила половин ячейки. */
  const renderStageFill = (f: StageFillSection, keyPrefix: string, sec: RowDaySections) => {
    const color = stageColorOf(f.stage.type);
    const left = dayToX(f.day, vs, colW) + Math.round((f.section * colW) / f.sections);
    const right = dayToX(f.day, vs, colW) + Math.round(((f.section + 1) * colW) / f.sections);
    const width = Math.max(1, right - left);
    const open = () => onOpenTripStage(f.tripKey, f.stage.id);
    // Скругление — как у полос: у секций дня скругляются только внешние края.
    const r = 4;
    const radius = `${f.section === 0 ? `${r}px` : '0px'} ${f.section === f.sections - 1 ? `${r}px` : '0px'} ${
      f.section === f.sections - 1 ? `${r}px` : '0px'
    } ${f.section === 0 ? `${r}px` : '0px'}`;
    // Подсказка доли: событие этапа + строка о соседнем событии этого дня.
    const neighbor = sec.neighborsOf(f.day, [stageMergeKeyOf(f.tripKey, f.stage.id)]);
    const title = neighbor ? `${stageFillTitle(stageTypes, f.stage, f.day, today)}\n${neighbor}` : stageFillTitle(stageTypes, f.stage, f.day, today);
    // Иконка типа события — в своей доле; мелкий масштаб — только иконка.
    const StageIcon = stageIconOf(f.stage.type);
    return (
      <div
        key={`${keyPrefix}-${f.tripKey}-${f.stage.id}-${f.day}`}
        role="button"
        tabIndex={0}
        data-stage-fill="1"
        data-stage={f.stage.id}
        data-trip={f.tripKey}
        data-stage-section={f.section}
        data-stage-sections={f.sections}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className="absolute top-0 bottom-0 cursor-pointer overflow-hidden whitespace-nowrap flex items-center justify-center px-0.5"
        style={{
          zIndex: TL_Z.stage,
          left,
          width,
          background: color.bg,
          borderLeft: `1px solid ${color.border}`,
          borderRight: f.section === f.sections - 1 ? `1px solid ${color.border}` : undefined,
          borderRadius: radius,
          color: color.text,
          ...(f.stage.isCritical ? { outline: '1px dashed #DC2626', outlineOffset: '-1px' } : {}),
          ...(f.archived ? { opacity: 0.72 } : {}),
        }}
        title={title}
      >
        {width >= 44 ? (
          <span className="inline-flex items-center gap-0.5 min-w-0 max-w-full">
            <StageIcon className={BAR_ICON_CLS} style={{ color: color.text }} aria-hidden="true" />
            <span className="text-[8px] leading-[10px] truncate">{stageShortName(stageTypes, f.stage)}</span>
          </span>
        ) : width >= 12 ? (
          <StageIcon className={BAR_ICON_CLS} style={{ color: color.text }} aria-hidden="true" />
        ) : null}
      </div>
    );
  };
  /**
   * ЕДИНЫЙ компонент полосы — база, ремонт, ПЛАН и ФАКТ рейса используют его
   * без отдельных стилей: одна высота (вся подстрока или своя дорожка при
   * пересечении), одинаковое скругление (только реальные края), обводка,
   * подпись 8px/600 слева по центру, общие hover/focus (index.css). Полоса
   * непрерывна по дням: один элемент на период/участок, без разделителей.
   * Параметры: цвет {bg,border,text}, подпись, иконка, оверлеи (pre/post).
   *
   * КОНТЕКСТЫ НАЛОЖЕНИЯ: полоса рендерится в обёртке БЕЗ z-index (z: auto) —
   * обёртка не создаёт stacking context, поэтому слои barCore (полоса) и
   * marksOverlay (метки поверх — круги/направления) участвуют в стеке строки
   * напрямую (шкала TL_Z, lib/visuals). Так метки остаются ПОВЕРХ клеток
   * этапов, даже когда сама полоса под ними (полоса и метки — разные слои,
   * их не запирает друг под другом ни порядок отрисовки, ни hover-фильтр).
   */
  const renderPeriodBar = (o: {
    key: string;
    attrKind: 'bz' | 'bar';
    kind: string;
    color: { bg: string; border: string; text: string };
    left: number;
    width: number;
    lane?: number;
    lanes?: number;
    radius: string;
    title: string;
    labelText?: string;
    /** Короткий вариант подписи (ступень сокращения: «Простой на базе», «Ремонт»). */
    labelShort?: string;
    labelIcon?: React.ReactNode;
    labelOnlyIcon?: boolean;
    stickyLabel?: boolean;
    /** Занятые зоны строки (клетки этапов/отметки/маркеры) в координатах строки. */
    obstacles?: BarObstacle[];
    mask?: string;
    opacity?: number;
    dashed?: 'tb' | 'all';
    /** Слой шкалы TL_Z (lib/visuals); по умолчанию — полосы базы/ремонта. */
    z?: number;
    /** Метки поверх полосы (круги, направления) — отдельным слоем TL_Z.mark. */
    marksOverlay?: React.ReactNode;
    role?: string;
    tabIndex?: number;
    cursor?: boolean;
    onClick?: () => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    style?: React.CSSProperties;
    attrs?: Record<string, string | number | undefined>;
    pre?: React.ReactNode;
    post?: React.ReactNode;
  }) => {
    const lanes = o.lanes ?? 1;
    const lane = o.lane ?? 0;
    const hasLabelIcon = !!o.labelIcon;
    // ЕДИНОЕ правило подписей: подпись обтекает этапы — свободные сегменты
    // полосы считаются от занятых зон строки (клетки этапов с долями дня,
    // отметки, маркеры, служебные зоны краёв). Подпись ставится в свободный
    // сегмент и остаётся sticky в его пределах (переезд — BarLabelsSweep).
    const labelSegs: BarLabelSegment[] =
      o.stickyLabel && o.labelText
        ? barLabelSegments(
            o.width,
            (o.obstacles || []).map((b) => ({ left: b.left - o.left, right: b.right - o.left })),
          )
        : [];
    const labelEl =
      o.labelOnlyIcon && o.labelIcon && !o.labelText ? (
        <span data-bz-label="icon" className="w-full h-full flex items-center justify-center" aria-hidden="true">
          {o.labelIcon}
        </span>
      ) : labelSegs.length ? (
        <>
          {labelSegs.map((seg) => {
            const variant = labelVariantFor(seg.width, o.labelText || '', o.labelShort || '', hasLabelIcon);
            if (variant === 'none') return null;
            const text = labelTextFor(variant, o.labelText || '', o.labelShort || '');
            return (
              <span
                key={seg.index}
                data-tl-labelseg={seg.index}
                className="absolute"
                style={{ left: seg.left, width: seg.width, top: 0, bottom: 0, display: 'none', alignItems: 'center', overflow: 'visible' }}
              >
                <span
                  data-bar-label="1"
                  className="sticky inline-flex items-center gap-0.5 min-w-0 px-1 text-[8px] leading-[10px] font-semibold truncate"
                  style={{
                    left: carColW + 8,
                    marginLeft: 6,
                    maxWidth: '100%',
                    background: o.color.bg,
                    color: o.color.text,
                    borderRadius: 4,
                  }}
                >
                  {o.labelIcon}
                  {text}
                </span>
              </span>
            );
          })}
        </>
      ) : o.labelText || o.labelIcon ? (
        <span
          data-bar-label="1"
          className="inline-flex items-center gap-0.5 min-w-0 px-1 text-[8px] leading-[10px] font-semibold truncate max-w-full"
          style={{
            background: o.color.bg,
            color: o.color.text,
            borderRadius: 4,
          }}
        >
          {o.labelIcon}
          {o.labelText}
        </span>
      ) : null;
    // Геометрия подписи для прокрутки (BarLabelsSweep): сегменты и левый край полосы.
    const labelGeoAttrs: Record<string, string> = labelSegs.length
      ? {
          'data-tl-lblsegs': labelSegs.map((sg) => `${sg.index}:${Math.round(sg.left)}:${Math.round(sg.right)}`).join(';'),
          'data-tl-lblleft': String(Math.round(o.left)),
        }
      : {};
    return (
      <div
        key={o.key}
        className="absolute"
        style={{
          left: o.left,
          width: o.width,
          top: lanes > 1 ? `calc(${(lane * 100) / lanes}% + 1px)` : 0,
          height: lanes > 1 ? `calc(${100 / lanes}% - 2px)` : undefined,
          bottom: lanes > 1 ? undefined : 0,
        }}
      >
        <div
          {...(o.attrKind === 'bz' ? { 'data-bz-stripe': o.kind } : { 'data-bar': o.kind })}
          {...(o.attrs || {})}
          {...labelGeoAttrs}
          role={o.role}
          tabIndex={o.tabIndex}
          onClick={o.onClick}
          onKeyDown={o.onKeyDown}
          onMouseEnter={o.onMouseEnter}
          onMouseLeave={o.onMouseLeave}
          className={`absolute inset-0 whitespace-nowrap flex items-center ${o.cursor ? 'cursor-pointer' : ''}`}
          style={{
            zIndex: o.z ?? TL_Z.bz,
            background: o.color.bg,
            border: `1px solid ${o.color.border}`,
            borderRadius: o.radius,
            color: o.color.text,
            ...(o.mask ? { WebkitMaskImage: o.mask, maskImage: o.mask } : {}),
            ...(o.opacity != null ? { opacity: o.opacity } : {}),
            ...(o.dashed === 'tb'
              ? { borderTopStyle: 'dashed', borderBottomStyle: 'dashed' }
              : o.dashed === 'all'
                ? { borderStyle: 'dashed' }
                : {}),
            ...(o.style || {}),
          }}
          title={o.title}
        >
          {o.pre}
          {labelEl}
          {o.post}
        </div>
        {o.marksOverlay}
      </div>
    );
  };
  /**
   * НЕПРЕРЫВНАЯ полоса периода базы/ремонта: ОДИН элемент на период через
   * общий компонент полосы (renderPeriodBar) — та же геометрия и подпись, что
   * у полос рейса. Если период продолжается за видимую область — на краю обрыв
   * без скругления с мягким градиентом. Клик и подсказка — на всей полосе.
   */
  const renderBzStripe = (s: BzStripe, keyPrefix: string, ov: RowOverlapResolution, sec: RowDaySections) => {
    const color = bzStripeColor(s);
    // Полосы простоя, укороченные/разрезанные разрешением наложений (lib/overlap):
    // база обрывается в день выезда по рейсу, день смены делится по горизонтали.
    const adj =
      (s.kind === 'base-plan' || s.kind === 'base-fact') && s.periodKey ? ov.baseAdjust.get(s.periodKey) : undefined;
    const srcA = adj ? adj.a : s.a;
    const srcB = adj ? adj.b : s.b;
    const baseFracA = adj ? adj.fracA : 0;
    const baseFracB = adj ? adj.fracB : 1;
    const clipA = Math.max(srcA, vs);
    const clipB = Math.min(srcB, ve);
    // Край полосы на границе доли дня: если в день своего начала/окончания
    // полоса делит ячейку с другим событием (выгрузка, рейс — единое правило
    // lib/dayCellSections), её край встаёт ровно на границе своей доли
    // (напр. ремонт начинается с середины дня выгрузки и идёт непрерывно).
    const mk = periodMergeKey(s.periodKey, srcA, srcB);
    const slotA = clipA === srcA ? sec.slotForPeriod(clipA, mk) : null;
    const slotB = clipB === srcB ? sec.slotForPeriod(clipB, mk) : null;
    const fracA = slotA ? Math.max(baseFracA, slotA.left) : baseFracA;
    const fracB = slotB ? Math.min(baseFracB, slotB.right) : baseFracB;
    const left = dayToX(clipA, vs, colW) + Math.round(fracA * colW);
    const right = dayToX(clipB, vs, colW) + Math.round(colW * fracB);
    const width = Math.max(1, right - left);
    const r = 'var(--tl-bar-r)';
    const roundL = s.edgeL === 'round' && fracA === 0;
    const roundR = s.edgeR === 'round' && fracB === 1;
    const radius = `${roundL ? r : '0px'} ${roundR ? r : '0px'} ${roundR ? r : '0px'} ${roundL ? r : '0px'}`;
    // Мягкий градиент на «продолжающемся» краю (обрыв за окно или открытый период).
    const fadePx = 22;
    const fadeL = s.edgeL !== 'round' && fracA === 0;
    const fadeR = s.edgeR !== 'round' && fracB === 1;
    const mask = fadeL
      ? fadeR
        ? `linear-gradient(to right, transparent 0, #000 ${fadePx}px, #000 calc(100% - ${fadePx}px), transparent 100%)`
        : `linear-gradient(to right, transparent 0, #000 ${fadePx}px)`
      : fadeR
        ? `linear-gradient(to right, #000 calc(100% - ${fadePx}px), transparent 100%)`
        : undefined;
    const open = s.periodKey ? () => onOpenBase(s.periodKey as string) : undefined;
    // «Учёт выезда»: подпись и иконка статуса (учёт ведётся / закрыт / не зафиксирован /
    // расхождение) — цвет полосы задан статусом; при узкой ширине остаётся иконка.
    const isVyezd = s.kind === 'base-fact';
    const StatusIcon = isVyezd && s.status ? vyezdStatusIcon(s.status) : null;
    const showLabel = width >= (isVyezd ? 62 : 44) && (!isVyezd || !!StatusIcon);
    // Подпись: полный текст, при датах — с датами; при нехватке места — короткая
    // форма «Простой на базе»; полный текст всегда в подсказке (title).
    const withDates = (txt: string): string => (s.dateLabel ? `${txt} · ${s.dateLabel}` : txt);
    const variants: string[] = [];
    if ((s.kind === 'repair' || isVyezd) && s.dateLabel) variants.push(withDates(s.label));
    variants.push(s.label);
    if (s.shortLabel && s.shortLabel !== s.label) variants.push(s.shortLabel);
    let labelText = '';
    for (const v of variants) {
      if (v.length * 4.7 + 14 <= width) {
        labelText = v;
        break;
      }
    }
    // Подпись полосы дополняется стыком с рейсом (укорочение/день смены) — но
    // данные учёта в подсказке не подменяются: указываем и учётный конец.
    const adjLine =
      adj == null
        ? ''
        : adj.truncatedDays > 0
          ? `Стык с рейсом: простой укорочен до ${fmtDM(adj.b)} — машина выехала на ${adj.truncatedDays} дн. раньше учётного срока (данные учёта не изменены, конец учёта: ${fmtDM(s.b)}).`
          : adj.cutA || adj.cutB
            ? s.kind === 'base-plan'
              ? 'Плановый день смены разделён с полосой рейса (рейс и база видны).'
              : 'День смены разделён с полосой рейса (штатный переход, не расхождение).'
            : '';
    // Подсказка полосы: событие периода + стык с рейсом + строка о соседнем
    // событии дня (если полоса делит ячейку с этапом/рейсом).
    const neighborDay = slotA ? clipA : slotB ? clipB : clipA;
    const neighbor = sec.neighborsOf(neighborDay, [mk]);
    const titleFull = [s.title, adjLine, neighbor].filter(Boolean).join('\n');
    return renderPeriodBar({
      key: `${keyPrefix}-${s.kind}-${s.periodKey || 'gap'}-${s.a}-${s.b}`,
      attrKind: 'bz',
      kind: s.kind,
      color,
      left,
      width,
      lane: s.lane,
      lanes: s.lanes,
      radius,
      mask,
      opacity: s.archived ? 0.72 : undefined,
      dashed: s.kind === 'base-gap' ? 'tb' : undefined,
      title: titleFull,
      role: s.periodKey ? 'button' : undefined,
      tabIndex: s.periodKey ? 0 : undefined,
      cursor: !!s.periodKey,
      onClick: open,
      onKeyDown: s.periodKey
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenBase(s.periodKey as string);
            }
          }
        : undefined,
      labelText: showLabel && labelText ? labelText : undefined,
      labelIcon: StatusIcon ? (
        <StatusIcon className="w-2.5 h-2.5 shrink-0" style={{ color: color.text }} aria-hidden="true" />
      ) : undefined,
      labelOnlyIcon: isVyezd && !!StatusIcon && width >= 16 && !(showLabel && labelText),
      stickyLabel: s.stickyLabel && showLabel && !!labelText,
      attrs: {
        'data-bz-status': s.status || undefined,
        'data-bz-a': s.a,
        'data-bz-b': s.b,
        'data-bz-edge-l': s.edgeL,
        'data-bz-edge-r': s.edgeR,
        'data-bz-frac-a': adj && fracA !== 0 ? `${fracA}` : undefined,
        'data-bz-frac-b': adj && fracB !== 1 ? `${fracB}` : undefined,
        'data-bz-trunc': adj && adj.truncatedDays > 0 ? `${adj.truncatedDays}` : undefined,
        'data-period': s.periodKey || undefined,
      },
    });
  };
  /**
   * Однодневная отметка базы/ремонта («срок готовности» / «дата окончания
   * ремонта») — заливка ВСЕЙ ячейки дня по ширине и высоте строки с аккуратной
   * SVG-иконкой по центру. Если день делится с другими событиями (этапами,
   * рейсом) — отметка занимает СВОЮ долю дня из единого правила половин
   * (lib/dayCellSections), доли не перекрываются.
   */
  const renderBzMark = (m: BzMark, keyPrefix: string, sec: RowDaySections) => {
    const color = bzKindColor(m.kind);
    const mk = periodMergeKey(m.periodKey);
    const slot = sec.slotForPeriod(m.day, mk);
    const section = slot ? slot.section : 0;
    const total = slot ? slot.sections : 1;
    const left = dayToX(m.day, vs, colW) + Math.round((section * colW) / total);
    const right = dayToX(m.day, vs, colW) + Math.round(((section + 1) * colW) / total);
    const width = Math.max(1, right - left);
    const r = 'var(--tl-bar-r)';
    const radius =
      total === 1
        ? r
        : `${section === 0 ? r : '0px'} ${section === total - 1 ? r : '0px'} ${
            section === total - 1 ? r : '0px'
          } ${section === 0 ? r : '0px'}`;
    const Icon = m.kind === 'ready' ? CarFront : Wrench;
    const neighbor = sec.neighborsOf(m.day, [mk]);
    const title = neighbor ? `${m.title}\n${neighbor}` : m.title;
    return (
      <div
        key={`${keyPrefix}-${m.kind}-${m.periodKey}-${m.day}`}
        role="button"
        tabIndex={0}
        data-bz-mark={m.kind}
        data-bz-day={m.day}
        data-bz-section={section}
        data-bz-sections={total}
        data-period={m.periodKey}
        onClick={() => onOpenBase(m.periodKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenBase(m.periodKey);
          }
        }}
        className="absolute top-0 bottom-0 overflow-hidden flex items-center justify-center cursor-pointer"
        style={{
          zIndex: TL_Z.stage,
          left,
          width,
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius,
          color: color.text,
          ...(m.archived ? { opacity: 0.72 } : {}),
        }}
        title={title}
      >
        {width >= 14 ? <Icon className="w-3 h-3 shrink-0" style={{ color: color.text }} aria-hidden="true" /> : null}
      </div>
    );
  };
  /** Стык смены диспетчера: линия через подстроку; в «Плане» — с подписью. */
  const renderHandover = (it: { point: number; from: string; to: string; note: string; title: string; chip: boolean }, keyPrefix: string) => {
    const x = Math.round((it.point - vs) * colW);
    if (x < -4 || x > W + 4) return null;
    return (
      <div key={`${keyPrefix}-${it.point}`} data-tl-handover="1" className="absolute top-0 bottom-0" style={{ zIndex: TL_Z.mark, left: x, width: 0 }}>
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
            className="absolute flex flex-col gap-0 rounded-md border border-[var(--tl-hairline)] bg-white/95 px-1 py-[1px] cursor-default"
            style={{ top: 1, left: 4, maxWidth: 240, overflow: 'hidden' }}
          >
            <span className="flex items-center gap-0.5 whitespace-nowrap text-[8px] leading-[9px] text-[var(--tl-text)]">
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
          zIndex: TL_Z.bg,
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
        className="absolute top-0 bottom-0"
        style={{
          zIndex: TL_Z.overlay,
          left: seg.left,
          width: seg.width,
          background: CLR.today,
          opacity,
          borderLeft: '1px solid var(--tl-today-line)',
          pointerEvents: 'none',
        }}
      />
    ));

  const countsText = [
    row.tripsCount ? `рейсов: ${row.tripsCount}` : '',
    row.basesCount ? `база: ${row.basesCount}` : '',
    row.repairsCount ? `ремонт: ${row.repairsCount}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const badge = todayBadgeOf(row, today);
  /** Расхождения стыков «рейс ↔ учёт выезда» (выехала раньше/позже) — малозаметный
   *  индикатор в левой колонке; полные тексты — в подсказке и на маркерах. */
  const ovAlertTitles = Array.from(
    new Set([...row.planOv.markers, ...row.factOv.markers].filter((m) => m.alert).map((m) => m.title)),
  );
  const ovNote = ovAlertTitles.length ? `Стыки с расхождением учёта (${ovAlertTitles.length}):\n${ovAlertTitles.join('\n')}` : '';
  const dirsTitle = row.directions.length ? `\nНаправления: ${row.directions.map((d) => `${d.name} (${d.code})`).join(', ')}` : '';
  const cellTitle = `${formatPlate(row.carNumber)} · ${row.dispatcherName || 'без диспетчера'}${countsText ? ` · ${countsText}` : ''}${dirsTitle}${warnTitle ? `\n${warnTitle}` : ''}${ovNote ? `\n${ovNote}` : ''}`;

  return (
    <>
      {/* Подстрока «План» — закреплена слева: номер машины (главный элемент). */}
      <div
        data-tl-row={row.carNumber}
        data-tl-car={row.carKey}
        data-tl-cell="plan"
        data-tl-colcell="1"
        onMouseEnter={onRowEnter}
        onMouseLeave={onRowLeave}
        className="sticky left-0 border-r border-b px-2 overflow-hidden"
        style={{ zIndex: TL_Z.colCell, height: planH, width: carColW, minWidth: carColW, background: cellBg, borderRightColor: 'var(--tl-col-edge)', borderBottomColor: 'var(--tl-hairline-faint)' }}
        title={cellTitle}
      >
        <div className="flex items-center justify-between gap-1.5 h-full">
          <button
            type="button"
            onClick={() => onOpenCar(row.carKey)}
            title={`${cellTitle}\n\nОбзор рейсов и периодов машины`}
            className="text-[11px] leading-[13px] font-semibold text-[var(--tl-text-strong)] truncate text-left hover:text-[var(--accent-ink)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] rounded-sm"
          >
            {formatPlate(row.carNumber)}
          </button>
          <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tl-text-dim)] shrink-0 select-none">
            план
          </span>
        </div>
      </div>
      <div
        data-lane="plan"
        data-tl-car={row.carKey}
        onMouseEnter={onRowEnter}
        onMouseLeave={onRowLeave}
        className="relative z-0 border-b border-[var(--tl-hairline-faint)]"
        style={{ width: W, height: planH, backgroundColor: laneRowBg, ...laneBg }}
      >
        {bgPlane('bg', 0.75)}
        {planBz.stripes.map((s) => renderBzStripe(s, 'pb', row.planOv, planSec))}
        {planBz.marks.map((m) => renderBzMark(m, 'pbm', planSec))}
        {planFills.map((f) => renderStageFill(f, 'pf', planSec))}
        {todayStrip('t', 0.1)}
        {row.planItems.map((it, idx) => {
          if (it.kind === 'handover') return renderHandover(it, `ph${idx}`);
          const p = pos(it.kind === 'markReturn' ? it.day : it.a, it.kind === 'markReturn' ? it.day : it.b);
          if (!p) return null;
          if (it.kind === 'markReturn') {
            // Аккуратный маркер планового возвращения: линия в конце рейса + клик.
            // Если день смены срезан (рейс → база), линия стоит на срезе, не в базе.
            const adjR = row.planOv.tripAdjust.get(it.tripKey) ?? null;
            const retX = dayToX(it.day, vs, colW) + Math.round(colW * (adjR?.fracB ?? 1)) - 3;
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
                className="absolute cursor-pointer"
                style={{ zIndex: TL_Z.mark, left: Math.max(0, retX), top: 3, height: planH - 6, width: 3, background: CLR.return, borderRadius: 2 }}
                title={it.title}
              />
            );
          }
          if (it.kind === 'plan') {
            // ПЛАН: вся полоса — ОДИН акцентный цвет приложения, БЕЗ индикации
            // сроков (никаких зелёного/жёлтого/оранжевого/красного). Статусы
            // срока остаются в подсказке полосы; данные не меняются.
            const chip = it.dir ? directionChipColors(it.dir.color) : null;
            const paint = paintByDirection && it.dir ? chip : null;
            // Срез дня смены и штриховка конфликта — из разрешения наложений.
            const adj = row.planOv.tripAdjust.get(it.tripKey) ?? null;
            const pr = adjRect(p, adj) ?? p;
            const col = paint
              ? { bg: paint.bg, border: paint.border, text: paint.text }
              : it.archived
                ? PLAN_ACCENT_ARCH
                : PLAN_ACCENT;
            const lanes = planBarLanes.get(idx) || { lane: 0, lanes: 1 };
            const labelText = it.open ? 'неполный план' : planBarLabelText(it.parts, pr.width, 8);
            const chipOn = !!chip && pr.width >= 96;
            const chipCls = 'inline-flex items-center h-[12px] px-1 rounded-[4px] text-[8px] leading-[12px] font-semibold shrink-0';
            return renderPeriodBar({
              key: `p${idx}`,
              attrKind: 'bar',
              kind: 'plan',
              color: col,
              left: pr.left,
              width: pr.width,
              lane: lanes.lane,
              lanes: lanes.lanes,
              radius: 'var(--tl-bar-r)',
              z: TL_Z.tripBar,
              title: it.title,
              role: 'button',
              tabIndex: 0,
              cursor: true,
              onClick: () => onOpenTrip(it.tripKey),
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenTrip(it.tripKey);
                }
              },
              onMouseEnter: () => setHoverTrip(it.tripKey),
              onMouseLeave: () => setHoverTrip((v) => (v === it.tripKey ? null : v)),
              style: link(it.tripKey),
              attrs: {
                'data-trip': it.tripKey,
                'data-dir': it.dir ? it.dir.name : undefined,
                'data-bar-frac-a': adj && adj.fracA !== 0 ? `${adj.fracA}` : undefined,
                'data-bar-frac-b': adj && adj.fracB !== 1 ? `${adj.fracB}` : undefined,
                'data-overlap': adj?.overlap ? '1' : undefined,
              },
              pre: (
                <>
                  {adj?.overlap ? (
                    <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                  ) : null}
                  {/* Место кружка сохраняется в потоке полосы; сам бейдж вынесен
                      в слой меток (marksOverlay) — он остаётся поверх клеток этапов. */}
                  {it.circle ? <span aria-hidden="true" className="inline-flex shrink-0 w-[14px] h-[14px] ml-0.5" /> : null}
                </>
              ),
              labelIcon: it.open ? <CircleDashed className={BAR_ICON_CLS} style={{ color: CLR.warn }} aria-hidden="true" /> : undefined,
              labelText,
              post: chipOn ? (
                // Невидимый резерв ширины чипа в потоке полосы (сам чип — в слое меток).
                <span aria-hidden="true" className={`${chipCls} ml-auto`} style={{ background: chip?.bg, border: `1px solid ${chip?.border}`, color: chip?.text, visibility: 'hidden' }}>
                  {it.dir?.code}
                </span>
              ) : undefined,
              // МЕТКИ ПОВЕРХ ПОЛОСЫ (шкала TL_Z.mark): цветной акцент направления,
              // круг рейса и код направления видимы и над клетками этапов.
              // Слой не перехватывает указатель: клик/наведение принадлежат
              // верхнему интерактивному элементу (этапу или самой полосе).
              marksOverlay: (
                <div aria-hidden="true" className="absolute inset-0 flex items-center pointer-events-none" style={{ zIndex: TL_Z.mark }}>
                  {it.dir ? (
                    <span
                      data-bar-dir-accent="1"
                      className="absolute top-0 bottom-0"
                      style={{ left: 1, width: 3, background: it.dir.color, borderTopLeftRadius: 'var(--tl-bar-r)', borderBottomLeftRadius: 'var(--tl-bar-r)' }}
                    />
                  ) : null}
                  {/* Круг рейса — номер виден на любом масштабе (бейдж не сжимается). */}
                  {it.circle ? (
                    <span
                      data-tl-circle-badge={it.circle.n}
                      data-tl-circle-total={it.circle.total}
                      data-tl-circle-ongoing={it.circle.ongoing ? '1' : undefined}
                      className="inline-flex items-center justify-center shrink-0 w-[14px] h-[14px] rounded-full text-[8px] leading-none font-bold tabular-nums select-none ml-[3px]"
                      style={circleBadgeStyle(it.circle.total, it.circle.ongoing)}
                      title={it.circle.title}
                    >
                      {it.circle.n}
                    </span>
                  ) : null}
                  {/* Код направления — только когда есть место; при мелком масштабе
                      остаются цветной акцент и текст (без перегрузки). */}
                  {chipOn ? (
                    <span
                      data-bar-dir-chip="1"
                      className={`${chipCls} ml-auto mr-px`}
                      style={{ background: chip?.bg, border: `1px solid ${chip?.border}`, color: chip?.text }}
                      title={`Направление: ${it.dir?.name}`}
                    >
                      {it.dir?.code}
                    </span>
                  ) : null}
                </div>
              ),
            });
          }
          if (it.kind === 'buffer') {
            return (
              <div
                key={`b${idx}`}
                data-bar="buffer"
                className="absolute"
                style={{ zIndex: TL_Z.tripBar, left: p.left, width: p.width, top: planTopOf(idx), height: PLAN_BAR_H, background: hatch45, border: '1px solid rgba(217, 119, 6, 0.22)', borderRadius: 'var(--tl-bar-r)' }}
                title={`запас ${it.days} дн`}
              />
            );
          }
          return null;
        })}
        {row.planOv.waitGaps.map((g) => renderWaitGap(g, 'pw'))}
        {row.planOv.warnings.map((w, wi) => renderConflict(w, 'pc', planH, wi))}
        {row.planOv.markers.map((m) => renderOvMarker(m, 'pm', planH))}
      </div>

      {/* Подстрока «Факт» — та же закреплённая колонка: одна короткая строка
          состояния (бейдж «в рейсе / на базе / ремонт / срок просрочен» или
          счётчики), тревоги — маленьким значком, полный текст — в подсказке. */}
      <div
        data-tl-car={row.carKey}
        data-tl-cell="fact"
        data-tl-colcell="1"
        onMouseEnter={onRowEnter}
        onMouseLeave={onRowLeave}
        className="sticky left-0 border-r border-b px-2 overflow-hidden"
        style={{ zIndex: TL_Z.colCell, height: factH, width: carColW, minWidth: carColW, background: cellBg, borderRightColor: 'var(--tl-col-edge)', borderBottomColor: 'var(--tl-hairline)' }}
        title={cellTitle}
      >
        <div className="flex items-center justify-between gap-1.5 h-full">
          <span className="flex items-center gap-1.5 min-w-0">
            {badge ? (
              <span
                className="inline-flex items-center gap-1 h-[14px] rounded-full px-1.5 py-0 text-[9px] leading-[14px] font-semibold whitespace-nowrap shrink-0"
                style={{ background: badge.bg, color: badge.fg }}
                title={badge.title}
              >
                <span className="w-1 h-1 rounded-full" style={{ background: badge.dot }} aria-hidden="true" />
                {badge.label}
              </span>
            ) : null}
            {/* Круги машины (правило directions.circlesOf): у одного круга бейдж
                приглушённый, у двух+ — заметный; незавершённый — «круг идёт»
                (пунктирная обводка). Полный список с датами — в подсказке. */}
            {row.circles.length ? (
              <span
                data-tl-circles={row.circles.length}
                data-tl-circles-ongoing={row.circles.some((c) => c.ongoing) ? '1' : undefined}
                className="inline-flex items-center gap-1 h-[14px] rounded-full px-1.5 text-[9px] leading-[14px] font-semibold whitespace-nowrap shrink-0 select-none"
                style={
                  row.circles.length > 1
                    ? { background: 'var(--accent-10)', border: '1px solid var(--accent-40)', color: '#8A4A12' }
                    : { background: '#F3F4F6', border: '1px solid #D7DBE1', color: '#5B6472' }
                }
                title={`Круги машины: ${row.circles.length} (круг = рейс на внешнем направлении; номер — порядок внутри периода учёта выезда)\n${row.circles
                  .map((c) => `• Круг ${c.n} — ${c.dir ? c.dir.name : 'направление не определено'}${c.ongoing ? ' — круг идёт' : ''}`)
                  .join('\n')}`}
              >
                <span
                  className="inline-flex items-center justify-center w-[10px] h-[10px] rounded-full text-[7px] font-bold"
                  style={
                    row.circles.length > 1
                      ? { border: `1px ${row.circles.some((c) => c.ongoing) ? 'dashed' : 'solid'} var(--accent-40)`, color: '#8A4A12' }
                      : { border: `1px ${row.circles.some((c) => c.ongoing) ? 'dashed' : 'solid'} #C3C8CF`, color: '#5B6472' }
                  }
                  aria-hidden="true"
                >
                  {row.circles.length}
                </span>
                {row.circles.length} {plural(row.circles.length, 'круг', 'круга', 'кругов')}
                {row.circles.some((c) => c.ongoing) ? ' · идёт' : ''}
              </span>
            ) : null}
            {/* Мини-чипы направлений машины (приглушённая палитра; полное имя — в подсказке) */}
            {row.directions.slice(0, 2).map((d) => {
              const dc = directionChipColors(d.color);
              return (
                <span
                  key={d.id}
                  data-tl-dir-chip={d.name}
                  className="inline-flex items-center gap-0.5 h-[14px] rounded-full px-1.5 text-[9px] leading-[14px] font-semibold shrink-0 select-none"
                  style={{ background: dc.bg, border: `1px solid ${dc.border}`, color: dc.text }}
                  title={`Направление: ${d.name}${d.code ? ` (${d.code})` : ''}`}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: dc.solid }} aria-hidden="true" />
                  {d.code}
                </span>
              );
            })}
            {row.directions.length > 2 ? (
              <span className="text-[9px] leading-[12px] text-[var(--tl-text-dim)] shrink-0 tabular-nums" title={row.directions.map((d) => d.name).join(', ')}>
                +{row.directions.length - 2}
              </span>
            ) : null}
            {row.empty ? (
              <span className="text-[9px] leading-[11px] text-[var(--tl-text-dim)] truncate">Нет рейсов в выбранном периоде</span>
            ) : countsText ? (
              <span className="text-[9px] leading-[11px] text-[var(--tl-text-dim)] truncate tabular-nums">{countsText}</span>
            ) : null}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {ovAlertTitles.length ? (
              <span
                data-tl-overlap-indicator="1"
                data-tl-car={row.carKey}
                className="inline-flex items-center"
                title={ovNote}
                aria-label={ovNote}
              >
                <CalendarClock className="w-3 h-3" style={{ color: '#B45309' }} aria-hidden="true" />
              </span>
            ) : null}
            {row.warnings.length ? (
              <span title={warnTitle} className="inline-flex" aria-label={warnTitle}>
                <AlertTriangle className="w-3 h-3" style={{ color: CLR.warn }} aria-hidden="true" />
              </span>
            ) : null}
            <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tl-text-dim)] select-none">факт</span>
          </span>
        </div>
      </div>
      <div
        data-lane="fact"
        data-tl-car={row.carKey}
        onMouseEnter={onRowEnter}
        onMouseLeave={onRowLeave}
        className="relative z-0 border-b border-[var(--tl-hairline)]"
        style={{ width: W, height: factH, backgroundColor: laneRowBg, ...laneBg }}
      >
        {bgPlane('fbg', 0.6)}
        {factBz.stripes.map((s) =>
          s.kind === 'base-gap' && waitCovers(row.factOv.waitGaps, s) ? null : renderBzStripe(s, 'fb', row.factOv, factSec),
        )}
        {factBz.marks.map((m) => renderBzMark(m, 'fbm', factSec))}
        {factFills.map((f) => renderStageFill(f, 'ff', factSec))}
        {todayStrip('ft', 0.1)}
        {row.factItems.map((it, idx) => {
          if (it.kind === 'handover') return renderHandover(it, `fh${idx}`);
          const p = it.kind === 'event' ? pos(it.day, it.day) : pos(it.a, it.b);
          if (!p) return null;
          switch (it.kind) {
            case 'fact': {
              // Срез дня смены и штриховка конфликта — из разрешения наложений.
              const adjF = row.factOv.tripAdjust.get(it.tripKey) ?? null;
              const prF = adjRect(p, adjF) ?? p;
              const lanes = factBarLanes.get(idx) || { lane: 0, lanes: 1 };
              // Цвет полосы-обёртки = цвет ПЕРВОГО сегмента (подпись читается на нём).
              const firstColor = FACT_SEGMENT_COLORS[it.segments[0]?.color ?? 'neutral'];
              // Продолжающийся край — без скругления, мягкий градиент-обрыв.
              const fadePx = 22;
              const mask = it.open ? `linear-gradient(to right, #000 calc(100% - ${fadePx}px), transparent 100%)` : undefined;
              return renderPeriodBar({
                key: `f${idx}`,
                attrKind: 'bar',
                kind: 'fact',
                color: { bg: firstColor.bg, border: firstColor.border, text: firstColor.text },
                left: prF.left,
                width: prF.width,
                lane: lanes.lane,
                lanes: lanes.lanes,
                // Скругление — только на краях полосы: открытый край — без скругления.
                radius: it.open ? 'var(--tl-bar-r) 0px 0px var(--tl-bar-r)' : 'var(--tl-bar-r)',
                z: TL_Z.tripBar,
                mask,
                title: it.title,
                role: 'button',
                tabIndex: 0,
                cursor: true,
                onClick: () => onOpenTrip(it.tripKey),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTrip(it.tripKey);
                  }
                },
                onMouseEnter: () => setHoverTrip(it.tripKey),
                onMouseLeave: () => setHoverTrip((v) => (v === it.tripKey ? null : v)),
                style: { ...link(it.tripKey), overflow: 'hidden' },
                attrs: {
                  'data-trip': it.tripKey,
                  'data-bar-frac-a': adjF && adjF.fracA !== 0 ? `${adjF.fracA}` : undefined,
                  'data-bar-frac-b': adjF && adjF.fracB !== 1 ? `${adjF.fracB}` : undefined,
                  'data-overlap': adjF?.overlap ? '1' : undefined,
                  'data-fact-open': it.open ? '1' : undefined,
                  'data-fact-segs': it.segments.length,
                },
                pre: (
                  <>
                    {factSegEls(it.segments, prF.left, prF.width)}
                    {adjF?.overlap ? (
                      <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                    ) : null}
                    {hoverTrip === it.tripKey && selectedTripKey !== it.tripKey ? (
                      <span
                        aria-hidden="true"
                        data-bar-hover-ring="1"
                        className="absolute inset-0 pointer-events-none"
                        style={{ boxShadow: 'inset 0 0 0 2px var(--accent)', borderRadius: 'inherit' }}
                      />
                    ) : null}
                  </>
                ),
                // Подпись — как у базы: маршрут на фоне первого сегмента; у
                // нейтральной полосы — «План не указан» (зелёного без плана нет).
                labelText: it.noPlan
                  ? 'Факт · план не указан'
                  : planBarLabelText(it.parts, prF.width, 8),
              });
            }
            case 'factNone': {
              // «Факт не указан» — та же полоса по плановым датам, тоже режется днём смены.
              const adjN = row.factOv.tripAdjust.get(it.tripKey) ?? null;
              const prN = adjRect(p, adjN) ?? p;
              const lanesN = factBarLanes.get(idx) || { lane: 0, lanes: 1 };
              return renderPeriodBar({
                key: `fn${idx}`,
                attrKind: 'bar',
                kind: 'fact-none',
                color: { bg: CLR.planNoneBg, border: CLR.planNoneBorder, text: 'var(--tl-text-dim)' },
                left: prN.left,
                width: prN.width,
                lane: lanesN.lane,
                lanes: lanesN.lanes,
                radius: 'var(--tl-bar-r)',
                z: TL_Z.tripBar,
                dashed: 'all',
                title: it.title,
                role: 'button',
                tabIndex: 0,
                cursor: true,
                onClick: () => onOpenTrip(it.tripKey),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTrip(it.tripKey);
                  }
                },
                onMouseEnter: () => setHoverTrip(it.tripKey),
                onMouseLeave: () => setHoverTrip((v) => (v === it.tripKey ? null : v)),
                style: link(it.tripKey),
                attrs: {
                  'data-trip': it.tripKey,
                  'data-bar-frac-a': adjN && adjN.fracA !== 0 ? `${adjN.fracA}` : undefined,
                  'data-bar-frac-b': adjN && adjN.fracB !== 1 ? `${adjN.fracB}` : undefined,
                  'data-overlap': adjN?.overlap ? '1' : undefined,
                },
                pre: adjN?.overlap ? (
                  <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                ) : null,
                labelText: prN.width > 90 ? 'Факт не указан' : undefined,
              });
            }
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
                  className={`absolute ${linked ? 'cursor-pointer' : ''}`}
                  style={
                    grouped
                      ? { zIndex: TL_Z.mark, left, top, height: 12, minWidth: 16, padding: '0 3px', background: '#7C3AED', borderRadius: 6, textAlign: 'center', opacity: 0.95 }
                      : { zIndex: TL_Z.mark, left, top, width: 9, height: 9, background: it.color, borderRadius: 2, transform: 'rotate(45deg)', opacity: 0.95 }
                  }
                  title={it.title}
                >
                  {grouped ? <span className="text-[8px] leading-[12px] text-white font-semibold">{it.count}</span> : null}
                </div>
              );
            }
            default:
              return null;
          }
        })}
        {row.factOv.waitGaps.map((g) => renderWaitGap(g, 'fw'))}
        {row.factOv.warnings.map((w, wi) => renderConflict(w, 'fc', factH, wi))}
        {row.factOv.markers.map((m) => renderOvMarker(m, 'fm', factH))}
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
  carColW,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  vs: number;
  vn: number;
  colW: number;
  carColW: number;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const ve = vs + vn - 1;
      const startRaw = vs + Math.floor(el.scrollLeft / colW);
      const endRaw = vs + Math.floor((el.scrollLeft + el.clientWidth - 1 - carColW) / colW);
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
  }, [scrollRef, vs, vn, colW, carColW]);
  return (
    <span className="text-[11px] text-[#4B5563] tabular-nums" data-ui="visible-range">
      {text || '—'}
    </span>
  );
}

/** Ширина колонки «Автомобили»: дефолт и лимиты (регулируемая граница). */
const CARCOL_STORAGE_KEY = 'ratipa_tl_carcolw';
const CARCOL_DEFAULT = 288;
const CARCOL_MIN = 200;
const CARCOL_MAX = 520;
/** Узкие экраны: колонка автосужается до минимума (номер + иконка статуса). */
const CARCOL_NARROW = 176;

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
  directions,
  fullscreen,
  onToggleFullscreen,
}: Props) {
  const ve = vs + vn - 1;
  const colW = zoomColW(zoom);
  const W = vn * colW;
  /** Фильтр направлений: активные чипы (null — показаны все). Только видимость. */
  const [dirFilter, setDirFilter] = useState<string[] | null>(null);
  /** Режим «Раскрасить по направлению»: цвет полосы рейса — приглушённый цвет направления. */
  const [paintByDirection, setPaintByDirection] = useState(false);
  /**
   * Ширина закреплённой колонки «Автомобили»: регулируется перетаскиванием
   * границы (resize-handle), значение — в localStorage; двойной клик по границе
   * возвращает дефолт. На узких экранах колонка автосужается до минимума.
   */
  const [carColPref, setCarColPref] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(CARCOL_STORAGE_KEY));
      return Number.isFinite(v) && v >= CARCOL_MIN && v <= CARCOL_MAX ? v : CARCOL_DEFAULT;
    } catch {
      return CARCOL_DEFAULT;
    }
  });
  const [viewportW, setViewportW] = useState<number>(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const carColW = viewportW < 700 ? CARCOL_NARROW : viewportW < 1100 ? Math.min(carColPref, 240) : carColPref;
  /** Перетаскивание границы колонки: 200–520 (ресайз), запись — по отпусканию. */
  const onColHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = carColW;
      const move = (ev: PointerEvent) => {
        setCarColPref(Math.max(CARCOL_MIN, Math.min(CARCOL_MAX, Math.round(startW + (ev.clientX - startX)))));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.removeProperty('cursor');
        setCarColPref((w) => {
          try {
            localStorage.setItem(CARCOL_STORAGE_KEY, String(w));
          } catch {
            /* не критично */
          }
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [carColW],
  );
  const onColHandleReset = useCallback(() => {
    setCarColPref(CARCOL_DEFAULT);
    try {
      localStorage.setItem(CARCOL_STORAGE_KEY, String(CARCOL_DEFAULT));
    } catch {
      /* не критично */
    }
  }, []);
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
    () =>
      buildRows(trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today, carCurrentDispatcher, directions, dirFilter),
    [trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today, carCurrentDispatcher, directions, dirFilter],
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

  /**
   * Свёрнутые группы диспетчеров — только состояние отображения (список строк
   * скрывается локально; данные, фильтры и прокрутка не меняются).
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Инициалы диспетчера для аватара шапки группы («Матвей Солодкий» → «МС»). */
  const initialsOf = (name: string): string =>
    (name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');

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
      const calW = Math.max(1, el.clientWidth - carColW);
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
    [vs, colW, carColW],
  );

  const dayAtViewportX = useCallback(
    (x: number): number => {
      const el = scrollRef.current;
      if (!el) return today;
      return dayAtContentX(el.scrollLeft + x, vs, colW, carColW);
    },
    [vs, colW, today, carColW],
  );

  const persistScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const calW = Math.max(1, el.clientWidth - carColW);
      const center = dayAtContentX(el.scrollLeft + carColW + calW / 2, vs, colW, carColW);
      if (lastPersistDay.current === center) return;
      lastPersistDay.current = center;
      // Храним календарную дату-якорь, а не только пиксели: при смене масштаба
      // старый scrollLeft не применяется — позиция пересчитывается по дате.
      sessionStorage.setItem('ratipa_timeline_scroll', JSON.stringify({ day: center, frac: 0.5 }));
    } catch {
      /* не критично */
    }
  }, [vs, colW, carColW]);

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
    const calW = el ? Math.max(1, el.clientWidth - carColW) : 1;
    const anchor = pendingAnchor.current ?? {
      day: el ? dayAtContentX(el.scrollLeft + carColW + calW / 2, vs, colW, carColW) : today,
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
    // Тень у границы колонки — только когда лента сдвинута по горизонтали
    // (атрибут на контейнере, без ре-рендера строк).
    el.toggleAttribute('data-hscroll', el.scrollLeft > 2);
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
    const calW = el ? Math.max(1, el.clientWidth - carColW) : 1;
    return { day: el ? dayAtContentX(el.scrollLeft + carColW + calW / 2, vs, colW, carColW) : today, frac: 0.5 };
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
      const calW = Math.max(1, rect.width - carColW);
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - carColW) / calW));
      const day = dayAtContentX(el.scrollLeft + (e.clientX - rect.left), vs, colW, carColW);
      pendingAnchor.current = { day, frac };
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom, zoom, vs, colW, carColW]);

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

  /** Попап «Обозначения» (компактная легенда): только состояние отображения. */
  const [legendOpen, setLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!legendOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (legendRef.current?.contains(t)) return;
      setLegendOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setLegendOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [legendOpen]);

  /** Точная высота липкой шапки (месяцы + дни) — столько же держат шапки групп. */
  const headH = colW >= 12 ? 48 : 42;

  /** Все обозначения — из ЕДИНОГО источника lib/legend: тот же список
   *  показывает вкладка «Справочник» интерактивного гайда, поэтому
   *  названия, цвета и значки не расходятся с дизайном полос. */
  const legendItems = buildLegendItems(directions);

  const legendSwatchCls = 'inline-flex items-center justify-center w-[26px] shrink-0';
  const legendRowCls = 'flex items-center gap-2 min-w-0';

  return (
    <div className={`tl-scope flex flex-col flex-1 min-h-0`}>
      {/* Панель управления: спокойные сегменты — навигация, масштаб, вид и легенда */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className={barSegment}>
          <button type="button" data-nav="month-prev" className={navBtnIcon} title="Предыдущий месяц" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button type="button" data-nav="week-prev" className={navBtn} onClick={() => onNavigate(navVs - 7)}>‹ неделя</button>
          <button
            type="button"
            data-nav="today"
            className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer"
            onClick={goToday}
          >
            Сегодня
          </button>
          <button type="button" data-nav="week-next" className={navBtn} onClick={() => onNavigate(navVs + 7)}>неделя ›</button>
          <button type="button" data-nav="month-next" className={navBtnIcon} title="Следующий месяц" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="w-px h-4 bg-[var(--tl-hairline)] mx-0.5" aria-hidden="true" />
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--tl-text)] pl-0.5 pr-0.5">
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
        </div>

        {/* Масштаб календаря: «−» / ползунок / «+». Ширина дня — единый параметр
            для сетки, полос и шапки; интерфейс вне календаря не масштабируется. */}
        <div className={barSegment} role="group" aria-label="Масштаб календаря" data-ui="zoom-control">
          <button
            type="button"
            data-zoom="out"
            className={`${navBtnIcon} ${zoom <= 0 ? 'opacity-40 cursor-default' : ''}`}
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
            className={`${navBtnIcon} ${zoom >= ZOOM_LEVELS.length - 1 ? 'opacity-40 cursor-default' : ''}`}
            title="Увеличить масштаб: деталей больше — до отдельных дней и событий"
            aria-label="Увеличить масштаб"
            disabled={zoom >= ZOOM_LEVELS.length - 1}
            onClick={() => setZoom(zoom + 1)}
          >
            +
          </button>
        </div>

        <span className="flex items-center gap-1.5 text-[11px] text-[var(--tl-text-dim)] px-1" data-ui="visible-range-wrap">
          Видимый диапазон:
          <VisibleRangeLabel scrollRef={scrollRef} vs={vs} vn={vn} colW={colW} carColW={carColW} />
        </span>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="relative" ref={legendRef}>
            <button
              type="button"
              data-ui="legend-toggle"
              aria-expanded={legendOpen}
              aria-haspopup="dialog"
              onClick={() => setLegendOpen((v) => !v)}
              title="Обозначения полос, заливок и значков"
              className={navBtn}
            >
              <Palette className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="ml-1.5">Обозначения</span>
            </button>
            {legendOpen ? (
              <div
                data-ui="legend-popup"
                role="dialog"
                aria-label="Обозначения"
                className="absolute right-0 top-full mt-2 w-[min(620px,92vw)] max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--tl-hairline)] bg-white shadow-[0_16px_40px_rgba(18,19,22,0.14)] p-4"
                style={{ zIndex: TL_Z.popup }}
              >
                <div className="text-[11px] font-semibold text-[var(--tl-text-strong)] mb-2.5">Обозначения таймлайна</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {legendItems.map((it, i) => (
                    <div key={i} className={legendRowCls}>
                      <span className={legendSwatchCls}>{it.swatch}</span>
                      <span className="text-[10px] leading-[13px] text-[var(--tl-text)] min-w-0">{it.label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 pt-2.5 border-t border-[var(--tl-hairline)] text-[10px] leading-[14px] text-[var(--tl-text-dim)]">
                  Клик по плановой или фактической полосе открывает модальное окно всего рейса; клик по названию машины — обзор её рейсов
                  и периодов. План рейса — один акцентный цвет; факт рейса — сегменты по отставанию (зелёный — в срок, жёлтый — 1–2 дня,
                  оранжевый — больше 2 дней, красный — критический срок нарушен или этап просрочен; штриховка и значок — вторичный признак).
                  База и ремонт — непрерывные полосы от первого до последнего дня периода (без делений на дни): плановый простой на базе и
                  плановое окончание базы (срок готовности) — в строке «План», фактический простой на базе (открытый — «Готовится к выезду»),
                  ремонт и окончание ремонта — в «Факт»; окончание базы и дата ремонта заливают всю ячейку дня, при пересечении с этапами день
                  делится на кликабельные секции — всё видно и открывается. Круги машины: номер на полосе и счётчик в колонке (2+ — заметный,
                  1 — приглушённый; пунктир — «круг идёт»).
                  Прокрутка — тачпад, Shift+колесо, полоса; масштаб — «−/+/ползунок» или Ctrl+колесо над календарём (дата под курсором
                  остаётся на месте). Прокрутка догружает даты влево и вправо; выходные подсвечены фоном. Границу колонки «Автомобили»
                  можно перетаскивать (двойной клик — вернуть ширину по умолчанию).
                </p>
              </div>
            ) : null}
          </div>

          {/* Направления: мультивыбор чипами (только скрывает/подсвечивает —
              данные рейсов не меняются) + режим «Раскрасить по направлению». */}
          <div className={barSegment} data-ui="dir-filter">
            <span className="text-[10px] text-[var(--tl-text-dim)]">Направления:</span>
            {directions.map((d) => {
              const on = !dirFilter || dirFilter.includes(d.name);
              const pressed = !!dirFilter && dirFilter.includes(d.name);
              const dc = directionChipColors(d.color);
              return (
                <button
                  key={d.id}
                  type="button"
                  data-dir-chip={d.name}
                  aria-pressed={pressed}
                  title={`Показать только рейсы направления «${d.name}» (повторный клик — снять)`}
                  onClick={() =>
                    setDirFilter((prev) => {
                      const cur = prev || [];
                      const has = cur.includes(d.name);
                      const next = has ? cur.filter((x) => x !== d.name) : [...cur, d.name];
                      // Пусто или всё выбранное = без фильтра (та же видимость)
                      return next.length === 0 || next.length === directions.length ? null : next;
                    })
                  }
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-colors cursor-pointer"
                  style={{
                    background: on ? dc.bg : 'transparent',
                    borderColor: on ? dc.border : 'var(--tl-hairline)',
                    color: on ? dc.text : 'var(--tl-text-dim)',
                    opacity: on ? 1 : 0.75,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: dc.solid, opacity: on ? 1 : 0.5 }} aria-hidden="true" />
                  {d.name}
                </button>
              );
            })}
            <span className="w-px h-4 bg-[var(--tl-hairline)] mx-0.5" aria-hidden="true" />
            <label
              className="flex items-center gap-1.5 text-[11px] text-[var(--tl-text)] cursor-pointer select-none"
              title="Подсветка: полосы рейсов окрашиваются в приглушённый цвет направления (данные не меняются)"
            >
              <input
                type="checkbox"
                data-ui="paint-by-direction"
                checked={paintByDirection}
                onChange={(e) => setPaintByDirection(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
              />
              Раскрасить по направлению
            </label>
          </div>

          <div className={barSegment}>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--tl-text)] cursor-pointer select-none" title="Единый переключатель: архивные рейсы плана дохода и архивные записи учёта выезда (база, ремонт)">
              <input
                type="checkbox"
                data-ui="show-archived"
                checked={showArchived}
                onChange={(e) => onShowArchivedChange(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
              />
              Показывать архивные данные
            </label>
            <span className="w-px h-4 bg-[var(--tl-hairline)] mx-0.5" aria-hidden="true" />
            {/* Полный экран: рабочая область раскрывается на всё окно (тот же таймлайн,
                без копии). Выход — эта же кнопка или Escape. */}
            {fullscreen ? (
              <button
                type="button"
                data-ui="fullscreen-exit"
                onClick={onToggleFullscreen}
                title="Выйти из полноэкранного режима (Escape)"
                aria-label="Выйти из полноэкранного режима"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer"
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
        </div>
      </div>

      {/* Обёртка области календаря: сетка — ОДИН контейнер прокрутки, поверх —
          регулируемая граница колонки «Автомобили» (resize-handle). Сетка
          тянется по высоте (flex-1): внешней прокрутки страницы нет. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-ui="timeline-scroll"
        className="tl-scroll overflow-auto overscroll-x-contain flex-1 min-h-0"
        style={{ background: 'var(--tl-canvas)', '--tl-head-h': `${headH}px` } as React.CSSProperties}
      >
        <style>{`.tl-scroll{scrollbar-width:thin;scrollbar-color:#B6BBC2 #F3F4F6;}
.tl-scroll::-webkit-scrollbar{height:12px;width:12px;}
.tl-scroll::-webkit-scrollbar-track{background:#F3F4F6;border-radius:8px;}
.tl-scroll::-webkit-scrollbar-thumb{background:#C3C8CF;border-radius:8px;border:2px solid #F3F4F6;}
.tl-scroll::-webkit-scrollbar-thumb:hover{background:#9CA3AF;}`}</style>
        <div className="grid min-w-max" style={{ gridTemplateColumns: `${carColW}px ${W}px` }}>
          {/* Шапка — закреплена сверху; левая ячейка — закреплена слева.
              Полоса месяцев и дни — в той же ленте, движутся синхронно с полосами. */}
          <div
            data-tl-colcell="1"
            className="sticky left-0 top-0 border-b border-r border-[var(--tl-hairline)] px-2 h-[var(--tl-head-h)] flex items-center"
            style={{ zIndex: TL_Z.headCorner, background: 'var(--tl-head-bg)', borderRightColor: 'var(--tl-col-edge)', width: carColW, minWidth: carColW }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--tl-text-dim)]">Автомобили</span>
          </div>
          <div className="sticky top-0 border-b border-[var(--tl-hairline)]" style={{ zIndex: TL_Z.head, width: W, background: 'var(--tl-head-bg)' }}>
            <CalendarHeader vs={vs} vn={vn} colW={colW} today={today} pinLeft={carColW + 8} />
          </div>

          {/* Группы машин: «План» сверху, «Факт» снизу. Во вкладке «Все» — блоками
              по ТЕКУЩЕМУ диспетчеру; шапка блока липкая (прилипает под шапкой
              календаря) и сворачивается кликом. Состав и порядок строк — как
              раньше: без диспетчера — в конце группой. */}
          {blocks.map((block) => {
            const blockKey = block.key || 'none';
            const collapsed = groupByDispatcher && collapsedGroups.has(blockKey);
            return (
              <div
                key={`blk-${blockKey}`}
                data-ui={groupByDispatcher ? 'dispatcher-group-block' : undefined}
                className="grid"
                style={{ gridColumn: '1 / -1', gridTemplateColumns: `${carColW}px ${W}px` }}
              >
                {groupByDispatcher ? (
                  <>
                    <div
                      data-ui="dispatcher-group"
                      data-dgroup={blockKey}
                      data-collapsed={collapsed ? '1' : undefined}
                      data-tl-colcell="1"
                      className="sticky left-0 border-r border-b border-[var(--tl-hairline)] px-2 h-[26px] min-w-0 flex items-center gap-1.5"
                      style={{ zIndex: TL_Z.colSubHead, top: 'var(--tl-head-h)', background: 'var(--tl-group-bg)', borderRightColor: 'var(--tl-col-edge)', width: carColW, minWidth: carColW }}
                    >
                      <button
                        type="button"
                        data-ui="group-toggle"
                        aria-expanded={!collapsed}
                        aria-label={`${block.name || 'Без диспетчера'} — ${block.rows.length} машин, ${collapsed ? 'развернуть' : 'свернуть'} группу`}
                        onClick={() => toggleGroup(blockKey)}
                        title={collapsed ? 'Развернуть группу диспетчера' : 'Свернуть группу диспетчера'}
                        className="inline-flex items-center gap-1 min-w-0 max-w-full cursor-pointer rounded-md px-0.5 py-0.5 hover:bg-white/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                      >
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[7px] font-bold text-[#4B5563] shrink-0 select-none"
                          style={{ background: '#FFFFFF', border: '1px solid var(--tl-col-edge)' }}
                          aria-hidden="true"
                        >
                          {initialsOf(block.name) || '—'}
                        </span>
                        <span className="text-[10px] leading-[12px] font-semibold text-[var(--tl-text-strong)] truncate min-w-0" title={block.name || 'Без диспетчера'}>
                          {block.name || 'Без диспетчера'}
                        </span>
                        <span
                          className="text-[9px] leading-[11px] text-[var(--tl-text)] shrink-0 tabular-nums rounded px-1"
                          style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid var(--tl-col-edge)' }}
                          title={`Машин в группе: ${block.rows.length}`}
                        >
                          {block.rows.length}
                        </span>
                        <ChevronDown className={`w-3 h-3 shrink-0 text-[var(--tl-text-dim)] transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                      </button>
                    </div>
                    <div
                      onClick={() => toggleGroup(blockKey)}
                      title={collapsed ? 'Развернуть группу диспетчера' : 'Свернуть группу диспетчера'}
                      className="sticky border-b border-[var(--tl-hairline)] h-[26px] min-w-0 cursor-pointer"
                      style={{ zIndex: TL_Z.colFill, top: 'var(--tl-head-h)', background: 'var(--tl-group-bg)' }}
                    />
                  </>
                ) : null}
                {!collapsed
                  ? block.rows.map((row, idx) => (
                      <TimelineCarRow
                        key={row.carKey}
                        row={row}
                        colW={colW}
                        carColW={carColW}
                        vs={vs}
                        vn={vn}
                        bg={bg}
                        today={today}
                        zebra={idx % 2 === 1}
                        stageTypes={stageTypes}
                        selectedTripKey={selectedTripKey}
                        paintByDirection={paintByDirection}
                        onOpenTrip={onOpenTrip}
                        onOpenTripEvent={onOpenTripEvent}
                        onOpenTripStage={onOpenTripStage}
                        onOpenBase={onOpenBase}
                        onOpenCar={onOpenCar}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {rows.length === 0 ? (
            <div className="col-span-2 py-10 text-center text-xs text-[var(--tl-text)]">
              В выбранной вкладке нет машин. Проверьте вкладку диспетчера или добавьте рейс кнопкой «Новый рейс».
            </div>
          ) : null}
        </div>
      </div>
      {/* Регулируемая граница колонки «Автомобили»: тянется мышью, двойной
          клик возвращает ширину по умолчанию (значение — в localStorage). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину колонки «Автомобили» (двойной клик — по умолчанию)"
        data-ui="carcol-resize"
        title="Потяните, чтобы изменить ширину колонки; двойной клик — вернуть по умолчанию"
        onPointerDown={onColHandleDown}
        onDoubleClick={onColHandleReset}
        className="absolute top-0 bottom-0 w-[7px] cursor-col-resize group"
        style={{ zIndex: TL_Z.resizer, left: Math.max(0, carColW - 3) }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-[3px] w-px bg-transparent group-hover:bg-[var(--accent-40)]"
        />
      </div>
      </div>
    </div>
  );
}
