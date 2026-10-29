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
import type { TimelineStage, TimelineStageType, TimelineVehicleEvent } from '../../../types';
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
  tripPlanBounds,
  tripSpan,
  visibleRangeText,
  zoomColW,
  zoomLabel,
  type LaneTrackItem,
} from './lib/timeline';
import { eventTypeOf, stageFullName } from './lib/catalog';
import { buildLegendItems } from './lib/legend';
import { planBarLabelParts, type PlanBarParts } from './PlanBarLabel';
import {
  LABEL_MIN_SEG,
  MIN_LABEL_BOX,
  barLabelSegments,
  labelTextFor,
  labelVariantFor,
  obstaclesFromFills,
  sweepBarLabels,
  type BarObstacle,
  type BarLabelSegment,
} from './lib/barLabels';
import { eventMarkOf, groupEventMarks, type EventMark } from './lib/eventMarks';
import EventCard, { type EventCardAnchor } from './EventCard';
import {
  layoutStageFills,
  stageFillTitle,
  stageNeighborLabel,
  stageRiskTitle,
  stageShortName,
  tripRiskTitle,
  type StageBufferInfo,
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
import { EVENT_CHIP_ROW_STEP, EVENT_CHIP_TOP, layoutEventDots, type RepairEvent } from './lib/repairEvents';
import BaseEventMark from './BaseEventMark';
import { buildStageSchedule, stageBufferOf, stageBufferStateOf, stageRouteCmp, stageSeqOf, type StageBufferStateInfo, type StageSchedule } from './lib/stageSchedule';
import { layoutRiskSegments, riskSegmentTextOf, riskTextBudgetWithChip, type RiskSegment, type RiskSegmentInput } from './lib/riskSegments';
import { resolveRowOverlaps, type RowOverlapResolution, type RowTripAdjust, type RowTripInterval } from './lib/overlapRow';
import type { ResolvedMarker, ResolvedWarning, WaitGap } from './lib/overlap';
import {
  directionChipColors,
  directionOfTrip,
  mixHex,
  type DirectionDef,
} from './lib/directions';
import {
  tripCircleMarksOf,
  visibleCircleTicks,
  type TripCircleMarks,
} from './lib/circles';
import {
  FACT_SEGMENT_COLORS,
  factSegmentsOfTrip,
  type FactSegment,
  type FactSegColor,
} from './lib/factSegments';
import { STATUS_LINE_COLORS, statusLineOfTrip, type StatusLineSegment } from './lib/statusLine';
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
import { AlertTriangle, ArrowRightLeft, CalendarClock, CarFront, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, LogIn, LogOut, Maximize2, Minimize2, Palette, Plus, SlidersHorizontal, TriangleAlert, Wrench } from 'lucide-react';

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
  RISK_COLORS,
  TL_Z,
  TRIP_CIRCLE_BADGE_CLS,
  TRIP_CIRCLE_TICK_CLS,
  TRIP_CIRCLE_TICK_LINE,
  TRIP_CIRCLE_TICK_TEXT,
  conflictHatch,
  riskHatch,
  stageIconOf,
  tripCircleBadgeStyle,
  waitHatch,
} from './lib/visuals';
import { useCrosshair } from './lib/useCrosshair';
import { useColumnHighlight, usePaintByDirection } from './lib/timelinePrefs';

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
      /** Круги рейса (поле «Круги» записи): бейдж ×N и засечки на полосе. */
      circleMarks?: TripCircleMarks | null;
    }
  | { kind: 'handover'; point: number; from: string; to: string; note: string; title: string; chip: boolean };

type DeadlineStatusKind = 'none' | 'ok' | 'risk' | 'violated' | 'missed';

type FactItem =
  | { kind: 'fact'; a: number; b: number; open: boolean; tripKey: string; title: string; segments: FactSegment[]; status: StatusLineSegment[]; noPlan: boolean; missedCount: number; parts: PlanBarParts; circleMarks?: TripCircleMarks | null }
  | { kind: 'factNone'; a: number; b: number; tripKey: string; title: string }
  | { kind: 'event'; day: number; lastDay: number; count: number; color: string; title: string; items: EventMark[]; tripKey?: string; eventId?: string }
  | { kind: 'handover'; point: number; from: string; to: string; note: string; title: string; chip: boolean };

interface CarRowModel {
  carKey: string;
  carNumber: string;
  carId: string;
  dispatcherId: string;
  dispatcherName: string;
  /** ТЕКУЩЕЕ назначение машины (справочник сцепок): по нему группируется «Все». */
  groupDispatcherId: string;
  /**
   * Ключ ГРУППЫ по ЧЕЛОВЕКУ, а не по идентификатору: у одного диспетчера в
   * базе бывает два разных id (личная учётная запись и запись справочника), и
   * из-за этого машина попадала в отдельный блок с тем же заголовком. Группа
   * сводится по нормализованному имени, а если имени нет — по id.
   */
  groupPersonKey: string;
  groupDispatcherName: string;
  tripsCount: number;
  basesCount: number;
  repairsCount: number;
  warnings: string[];
  empty: boolean;
  planItems: PlanItem[];
  factItems: FactItem[];
  /** Запасы ЗАПИСИ ручных рейсов (trip.bufferDays) — сегменты «Риски» после полосы. */
  tripBuffers: Array<{ tripKey: string; days: number; anchorDay: number }>;
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
  /** Клик по метке события на базе: открыть окно периода этой машины и
   *  подсветить именно это событие (не задан — клик открывает только окно). */
  onOpenBaseEvent?: (periodKey: string, eventId: string) => void;
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
  /** Переключатель «Подсветка столбца» — сохраняется в настройках пользователя. */
  onColumnHighlightChange: (v: boolean) => void;
  /** «Раскрасить по направлению»: запись выбора в профиль (значение — в общем store). */
  onPaintByDirectionChange: (v: boolean) => void;
  /**
   * Кнопка «+ Направление» в панели фильтров: открывает окно аддитивного
   * добавления записи справочника (нет обработчика — кнопки нет; режим чтения).
   */
  onAddDirection?: () => void;
  /**
   * Перетаскивание/растягивание ПЛАНОВОЙ полосы рейса: новые границы уходят в
   * запись-ИСТОЧНИК через dbService.saveTimelinePlanBounds (единая проверка
   * периодов — см. TripTimelineModule; конфликт → полоса возвращается на
   * место и человек видит причину). Обработчика нет — полосы не перетаскиваются.
   */
  onPlanBoundsDrag?: (tripKey: string, startIso: string, endIso: string) => void;
  /** Право править плановые даты связанного рейса («План дохода», write). */
  canDragPlan?: boolean;
  /** Право править даты ручного рейса (tripTimeline, write). */
  canDragManual?: boolean;
}

/** Запас по краям окна: полосы, пересекающиеся с [vs−margin, ve+margin],
 *  участвуют в цепочке, но за пределами окна обрезаются. */
const WINDOW_MARGIN = 60;

/** Режим перетаскивания плановой полосы: перенос целиком или растягивание края. */
type PlanDragMode = 'move' | 'start' | 'end';

/** Минимальные высоты подстрок «План»/«Факт» — ОДИНАКОВЫЕ (единый ритм). */
const PLAN_H = 22;
const FACT_H = 22;
/** Отступы и зазор дорожек внутри подстроки; высота растёт с числом дорожек. */
const PLAN_PAD = 3;   // 3 + 16 + 3 = 22 — высота подстроки при одной дорожке
const FACT_PAD = 4;   // 4 + 14 + 4 = 22 — с «фактом не указан»; факт центрируется в дорожке
const TRACK_GAP = 2;
/**
 * ВЫСОТА СТРОК МАШИН — ОДНА настройка на все строки сразу (не по отдельности):
 * базовая высота ОДНОЙ дорожки («План» или «Факт»). Если раскладка требует
 * больше (пересекающиеся полосы разведены по под-дорожкам) — берётся высота
 * раскладки, иначе — настройка. Содержимое дорожки сохраняет СВОЮ высоту и
 * центрируется по вертикали (band/offset в TimelineCarRow): при значении по
 * умолчанию сдвиг нулевой — вид ровно прежний. Меняется двумя способами (ручка
 * под шапкой календаря и ползунок в панели), хранится в localStorage — по
 * образцу ширины колонки «Автомобили» (CARCOL_* ниже).
 */
const ROWH_STORAGE_KEY = 'ratipa_tl_rowh';
/** Режим «Подробно» (план и факт отдельно) — localStorage, как высота строк. */
const DETAILED_STORAGE_KEY = 'ratipa_tl_detailed';
/** Карточка событий при наведении (по умолчанию включена) — localStorage. */
const EVENT_HOVER_STORAGE_KEY = 'ratipa_tl_evhover';
/** По умолчанию — прежний «единый ритм» (PLAN_H = FACT_H = 22), вид не меняется. */
const ROWH_DEFAULT = 22;
/** Пределы настройки: базовая дорожка 14…44 px (строка машины — 28…88 px).
 *  Ниже естественной высоты содержимого (band) дорожка не сжимается — иначе
 *  полосы и их подписи обрезались бы: в 14…21 высота та же, что по умолчанию. */
const ROWH_MIN = 14;
const ROWH_MAX = 44;
/** Высоты полос по видам (те же, что были при одной общей дорожке). */
const PLAN_BAR_H = 16;
const FACT_BAR_H = 8;
const FACT_NONE_H = 14;
/** Компактный вид (одна строка на машину): факт — тонкая линия под планом. */
const FACT_COMPACT_BAND = 6;
/** Доля высоты дорожки под отступы: остальное занимает полоса (растёт со строкой). */
const LANE_PAD_RATIO = 0.18;
/** Размер подписей и значков на полосах — от высоты ленты содержимого. */
const laneTypeVars = (bandH: number): React.CSSProperties =>
  ({
    '--tl-fs': `${Math.max(8, Math.min(12, Math.round(bandH * 0.38)))}px`,
    '--tl-ic': `${Math.max(12, Math.min(18, Math.round(bandH * 0.55)))}px`,
  }) as React.CSSProperties;
/** Цвет значка этапа по сроку: серый — в срок, янтарный — в пределах запаса, красный — просрочка. */
const STAGE_ICON_NEUTRAL = '#4B5563';
const stageToneOf = (code: string | null | undefined): string | null =>
  code === 'within' ? '#B45309' : code === 'beyond' || code === 'planned-overdue' ? '#BE123C' : null;

const navBtn =
  'inline-flex items-center justify-center shrink-0 whitespace-nowrap h-7 px-2.5 rounded-lg text-[11px] font-medium bg-white border border-[var(--tl-hairline)] text-[var(--tl-text)] hover:text-[var(--tl-text-strong)] hover:bg-[#F3F4F6] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';
const navBtnIcon = `${navBtn} w-7 px-0`;
/** Спокойная вторичная «сегментная» оболочка панели управления. На узком
 *  экране содержимое сегмента переносится, а не вылезает за край. */
const barSegment = 'inline-flex flex-wrap max-w-full items-center gap-1.5 rounded-xl border border-[var(--tl-hairline)] bg-white px-2 py-1';

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

/**
 * Единый стиль бейджа «×N» и засечек кругов рейса — в lib/visuals
 * (tripCircleBadgeStyle / TRIP_CIRCLE_*): один источник с легендой и гайдом.
 */

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
  fleetCars.forEach((c) => ensureCar(c.carId ? `car:${c.carId}` : `plate:${plateKeyOf(c.carNumber)}`, c.carNumber, c.carId, c.dispatcherId, c.dispatcherName));

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
    /** Запасы ЗАПИСИ ручных рейсов (trip.bufferDays) — в единый слой «Риски». */
    const tripBuffers: CarRowModel['tripBuffers'] = [];
    /** Интервалы, ОТОБРАЖАЕМЫЕ в подстроках, — вход разрешения наложений (lib/overlap). */
    const planInts: RowTripInterval[] = [];
    const factInts: RowTripInterval[] = [];

    // ── Целые рейсы: план-полоса, запас, факт/«факт не указан», маркеры ──
    myTrips.forEach((t) => {
      const span = tripSpan(t);
      // Плановые границы — ЕДИНЫЙ источник (lib/timeline.tripPlanBounds):
      // план записи + оверрайд tripMeta (уже подмешан в spanOverride на слое
      // данных) + плановые даты этапов. Те же границы используют полнота
      // плана (предупреждения), подписи окна и счёты — расхождений нет.
      const bounds = tripPlanBounds(t);
      const pMin = bounds.pMin;
      const pMax = bounds.pMax;
      t.warnings.forEach((w) => warnings.add(w));
      if (pMin == null) return; // без старта полосу не рисуем — дату не выдумываем
      const openPlan = pMax == null; // «неполный план» — только когда даты возвращения нет нигде
      const planEnd = pMax ?? pMin;
      const tripLabel = `Рейс «${t.route || 'без маршрута'}»`;
      const deadline = getDeadlineStatus(t, today, (s) => stageFullName(stageTypes, s));
      // Плановый график с запасом этапов (lib/stageSchedule): «план без запаса»,
      // суммарный запас и «итого» — в подсказке полосы (данные не меняются).
      const stageSched = buildStageSchedule(t.stages || []);
      const bufferLine =
        stageSched.totalBufferDays > 0 && stageSched.effectiveEndDay != null
          ? ` · запас этапов: ${stageSched.totalBufferDays} дн · итого с запасом: ${fmtDM(stageSched.effectiveEndDay)} (плановое возвращение с запасом)`
          : '';
      const dir = directionOfTrip(t, directions);
      const parts = planBarLabelParts(t);
      // Круги рейса — поле записи («circles», lib/circles): счётчик у обоих
      // полос одинаковый; засечки ПЛАН строятся по плановым датам этапов,
      // ФАКТ — по фактическим (даты не выдумываются; этапы без привязки к
      // кругу в разметку не попадают).
      const circleMarksPlan = tripCircleMarksOf(t.circles, t.stages, 'plan');
      const circleMarksFact = tripCircleMarksOf(t.circles, t.stages, 'fact');
      if (visible(pMin, planEnd)) {
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
          warn: false,
          dir,
          circleMarks: circleMarksPlan,
          title: `${formatPlate(car.carNumber)} · ${parts.titleText} · ${t.dispatcherName || 'без диспетчера'}${dir ? ` · направление: ${dir.name}` : ''}${circleMarksPlan ? ` · ${circleMarksPlan.title}` : ''}${t.kind === 'plan' ? ' · из плана дохода' : ''}${t.archived ? ' · архив' : ''}${openPlan ? ' · неполный план (нет даты возвращения)' : ` · плановое возвращение: ${fmtDM(planEnd)}`}${bufferLine} · ${deadline.label}`,
        });
      }
      planInts.push({ key: t.key, a: pMin, b: planEnd, open: openPlan, label: tripLabel });
      // Плановое возвращение — это ПРАВЫЙ КРАЙ плановой полосы (дата возвращения
      // в подсказке полосы): отдельной синей «полоски» в конце полосы нет —
      // форма полосы остаётся цельной, начало и конец одинаковые.
      // Запас ЗАПИСИ ручного рейса (trip.bufferDays) больше НЕ отдельный
      // механизм полосы: он входит в единый слой «Риски» (lib/riskSegments) —
      // тем же сегментом, что и запасы этапов, поэтому «двух механизмов» нет.
      if (t.kind === 'manual' && pMax != null && t.bufferDays > 0) {
        tripBuffers.push({ tripKey: t.key, days: t.bufferDays, anchorDay: pMax + 1 });
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
            // Статус-линия компактного вида: по плану / срок подходит / просрочка.
            status: statusLineOfTrip(t, span.fMin, fEnd, today),
            noPlan: segRes.noPlan,
            missedCount: segRes.missed.length,
            parts,
            circleMarks: circleMarksFact,
            title: `${formatPlate(car.carNumber)} · факт: ${fmtDM(span.fMin)} – ${ongoing ? 'продолжается (окончание не указано)' : fmtDM(fEnd)} · ${factSegSummaryOf(segRes.segments)}${
              circleMarksFact ? ` · ${circleMarksFact.title}` : ''
            }${
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
      const mark = eventMarkOf(e, meta.name, meta.color, 'клик — закрепить карточку');
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
        items: g.items,
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
      // Порядок этапов для полосы: сначала дата, затем seq («раньше внесён —
      // левее»; у старых рейсов seq читается из order/позиции — миграционно).
      [...t.stages].sort(stageRouteCmp).forEach((s) => stageInputs.push({ tripKey: t.key, stage: s, archived: !!t.archived }));
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
    // Текущий диспетчер: справочник сцепок → диспетчер активного (неархивного)
    // рейса машины → значение карточки. Группировка «Все» идёт по нему, поэтому
    // одна машина не распадается на две группы из-за истории.
    const activeTripDispatcher = myTrips.find((t) => !t.archived && (t.dispatcherId || t.dispatcherName)) || null;
    const current =
      carCurrentDispatcher.get(car.carKey) ||
      (activeTripDispatcher && (activeTripDispatcher.dispatcherId || activeTripDispatcher.dispatcherName)
        ? { id: activeTripDispatcher.dispatcherId, name: activeTripDispatcher.dispatcherName }
        : null);
    rows.push({
      carKey: car.carKey,
      carNumber: car.carNumber,
      carId: car.carId,
      dispatcherId: current ? current.id : car.dispatcherId,
      dispatcherName: current ? current.name || car.dispatcherName : car.dispatcherName,
      groupDispatcherId: current ? current.id : car.dispatcherId,
      groupPersonKey: (() => {
        const name = String((current ? current.name || car.dispatcherName : car.dispatcherName) || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const id = String((current ? current.id : car.dispatcherId) || '').trim();
        return name || (id ? `id:${id}` : '');
      })(),
      groupDispatcherName: current ? current.name || car.dispatcherName : car.dispatcherName,
      tripsCount: myTrips.length,
      basesCount: myBases.filter((p) => p.arrivalDay != null).length,
      repairsCount: myBases.filter((p) => p.repairStartDay != null).length,
      warnings: Array.from(warnings),
      empty,
      planItems,
      factItems,
      tripBuffers,
      stageInputs,
      bzInputs: myBases.map((p) => ({ period: p, tripRanges: carTripRanges })),
      bzGaps,
      planOv,
      factOv,
      directions: rowDirs,
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
  /** Клик по метке события на базе: открыть окно периода и подсветить событие. */
  onOpenBaseEvent,
  onOpenCar,
  /** Перетаскивание/растягивание плановой полосы — сохранение в запись-источник. */
  onPlanBoundsDrag,
  canDragPlan,
  canDragManual,
  rowH,
  detailed,
  eventHover,
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
  /** Клик по метке события на базе: открыть окно периода и подсветить событие. */
  onOpenBaseEvent?: (key: string, eventId: string) => void;
  onOpenCar: (key: string) => void;
  /** Перетаскивание/растягивание плановой полосы: новые границы (ISO) в запись-источник. */
  onPlanBoundsDrag?: (tripKey: string, startIso: string, endIso: string) => void;
  canDragPlan: boolean;
  canDragManual: boolean;
  /** Общая высота ОДНОЙ дорожки строки (одна настройка на все машины; дефолт — PLAN_H). */
  rowH: number;
  /** «Подробно»: план и факт отдельными подстроками; иначе факт — тонкая линия под планом. */
  detailed: boolean;
  /** Карточка событий при наведении (клик по точке закрепляет её в любом случае). */
  eventHover: boolean;
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
  // ── Карточка событий: заметки диспетчеров прямо на таймлайне ───────────────
  // Наведение на точку (или на номер машины / свободное место строки) показывает
  // карточку, клик по точке закрепляет её; окно рейса — кнопкой в карточке.
  const [evCard, setEvCard] = useState<{ pinned: boolean; anchor: EventCardAnchor; events: EventMark[]; heading: string } | null>(null);
  const evShowTimer = useRef<number | null>(null);
  const evHideTimer = useRef<number | null>(null);
  const cancelEvShow = useCallback(() => {
    if (evShowTimer.current != null) window.clearTimeout(evShowTimer.current);
    evShowTimer.current = null;
  }, []);
  const cancelEvHide = useCallback(() => {
    if (evHideTimer.current != null) window.clearTimeout(evHideTimer.current);
    evHideTimer.current = null;
  }, []);
  const scheduleEvHide = useCallback(() => {
    cancelEvHide();
    evHideTimer.current = window.setTimeout(() => setEvCard((c) => (c && !c.pinned ? null : c)), 220);
  }, [cancelEvHide]);
  const closeEvCard = useCallback(() => {
    cancelEvShow();
    cancelEvHide();
    setEvCard(null);
  }, [cancelEvShow, cancelEvHide]);
  useEffect(
    () => () => {
      if (evShowTimer.current != null) window.clearTimeout(evShowTimer.current);
      if (evHideTimer.current != null) window.clearTimeout(evHideTimer.current);
    },
    [],
  );
  /** Все события строки за видимый период — по датам. */
  const rowEvents = useMemo<EventMark[]>(
    () =>
      row.factItems
        .flatMap((it) => (it.kind === 'event' ? it.items : []))
        .sort((a, b) => a.day - b.day),
    [row.factItems],
  );
  /** Показать карточку через delay мс; закреплённую не подменяет. */
  const showEvCard = (next: { anchor: EventCardAnchor; events: EventMark[]; heading: string }, delay: number) => {
    cancelEvHide();
    cancelEvShow();
    evShowTimer.current = window.setTimeout(() => setEvCard((cur) => (cur && cur.pinned ? cur : { pinned: false, ...next })), delay);
  };
  const rowEventsHeading = `${formatPlate(row.carNumber)} · события за период (${rowEvents.length})`;
  const rectAnchor = (r: DOMRect): EventCardAnchor => ({ left: r.left, top: r.top, bottom: r.bottom });
  /** Номер машины: карточка со всеми событиями строки — справа от ячейки. */
  const onCarCellEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    onRowEnter();
    if (!eventHover || !rowEvents.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    showEvCard({ anchor: { left: r.right + 4, top: r.top, bottom: r.top }, events: rowEvents, heading: rowEventsHeading }, 450);
  };
  const onCarCellLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    onRowLeave(e);
    cancelEvShow();
    scheduleEvHide();
  };
  /** Курсор остановился на свободном месте строки (не на полосе и не на метке). */
  const onLaneMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!eventHover || !rowEvents.length || evCard) return;
    const target = e.target as HTMLElement;
    // Точку события ведёт её собственный обработчик: не сбиваем его таймер.
    if (target.closest('[data-bar="event"]')) return;
    if (target.closest('[title],[role="button"],button')) {
      cancelEvShow();
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    showEvCard({ anchor: { left: x + 10, top: y, bottom: y }, events: rowEvents, heading: rowEventsHeading }, 650);
  };
  const onLaneLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    onRowLeave(e);
    cancelEvShow();
    scheduleEvHide();
  };
  const cellBg = rowHover ? 'var(--tl-hover)' : zebra ? 'var(--tl-zebra)' : 'var(--tl-col-bg)';
  const laneRowBg = rowHover ? 'var(--tl-hover)' : zebra ? 'var(--tl-zebra)' : 'transparent';
  const W = vn * colW;
  const ve = vs + vn - 1;
  /**
   * События ремонта по периодам строки — для точек НАД полосой (слой меток).
   * Источник — те же периоды строки (без копий данных и без отдельных чтений).
   */
  const bzEventsById = useMemo(() => {
    const m = new Map<string, RepairEvent[]>();
    row.bzInputs.forEach(({ period }) => {
      if (period.key && period.events.length) m.set(period.key, period.events);
    });
    return m;
  }, [row.bzInputs]);
  /**
   * Плановый график с запасом по каждому рейсу строки (lib/stageSchedule):
   * запас этапа сдвигает себя и последующие даты; из графика — штриховка
   * запаса справа от этапа, «план с запасом» в подсказке и состояния
   * «в пределах/за пределами запаса». Данные этапов не меняются.
   */
  const stageSchedules = useMemo(() => {
    const byTrip = new Map<string, TimelineStage[]>();
    row.stageInputs.forEach(({ tripKey, stage }) => {
      const arr = byTrip.get(tripKey);
      if (arr) arr.push(stage);
      else byTrip.set(tripKey, [stage]);
    });
    const m = new Map<string, StageSchedule>();
    byTrip.forEach((stages, tripKey) => m.set(tripKey, buildStageSchedule(stages)));
    return m;
  }, [row.stageInputs]);
  const scheduleOf = useCallback((tripKey: string): StageSchedule | null => stageSchedules.get(tripKey) || null, [stageSchedules]);
  const stageStateByKey = useMemo(() => {
    const m = new Map<string, StageBufferStateInfo>();
    if (!row.stageInputs.length) return m;
    const byTrip = new Map<string, TimelineStage[]>();
    row.stageInputs.forEach(({ tripKey, stage }) => {
      const arr = byTrip.get(tripKey);
      if (arr) arr.push(stage);
      else byTrip.set(tripKey, [stage]);
    });
    byTrip.forEach((stages, tripKey) => {
      const sched = stageSchedules.get(tripKey);
      if (!sched) return;
      stages.forEach((s) => m.set(`${tripKey}|${s.id}`, stageBufferStateOf(s, sched, today)));
    });
    return m;
  }, [row.stageInputs, stageSchedules, today]);
  /** Этапы строки по ключу «рейс|этап» — для подсказок и кликов сегментов «Риски». */
  const stageByKey = useMemo(() => {
    const m = new Map<string, StageFillInput>();
    row.stageInputs.forEach((it) => m.set(`${it.tripKey}|${it.stage.id}`, it));
    return m;
  }, [row.stageInputs]);
  /**
   * Сведения о запасе этапа (для подсказок доли этапа и сегмента «Риски») —
   * из ОДНОГО планового графика строки (lib/stageSchedule); null — запаса нет.
   * Тот же текст, что и раньше: запас, накопленный, дата с запасом, состояние.
   */
  const bufferInfoFor = (tripKey: string, stage: TimelineStage): StageBufferInfo | null => {
    const buf = stageBufferOf(stage);
    if (buf <= 0) return null;
    const chain = stageSchedules.get(tripKey)?.byId.get(stage.id) || null;
    const state = stageStateByKey.get(`${tripKey}|${stage.id}`) || null;
    return {
      bufferDays: buf,
      cumBufferDays: chain ? chain.cumBufferDays : buf,
      effectiveIso: chain ? chain.effectiveIso : stage.plannedDate || null,
      stateLabel: state ? state.label : null,
    };
  };
  /** Та же единая функция «дата → координата», что у шапки и сетки. */
  const pos = (a: number, b: number): { left: number; width: number } | null => barRectInWindow(a, b, vs, ve, colW);
  /** Единая визуальная система: выбранный (открытый) рейс — тёмное кольцо,
   *  соседние при наведении — мягкий контур. Наведение полосы — НЕЙТРАЛЬНОЕ
   *  лёгкое затемнение (общий CSS-токен --tl-hov-dim в index.css: одинаково
   *  у рейса, базы, ремонта и учёта выезда — значения не дублируются). */
  const link = (tripKey: string): React.CSSProperties => {
    if (selectedTripKey && selectedTripKey === tripKey) {
      return { boxShadow: hoverTrip === tripKey ? 'inset 0 0 0 2px var(--accent), var(--tl-hov-sel)' : 'var(--tl-hov-sel)' };
    }
    if (!hoverTrip) return {};
    if (hoverTrip === tripKey) return {};
    return { boxShadow: 'var(--tl-hov-ring-soft)' };
  };

  // ── Перетаскивание/растягивание ПЛАНОВОЙ полосы рейса ───────────────────
  // Здесь НИЧЕГО не записывается: по отпускании новые границы уходят в
  // запись-источник через onPlanBoundsDrag (dbService.saveTimelinePlanBounds —
  // единая проверка периодов, как у создания/правки рейса). Пока запись не
  // подтверждена, данные не меняются — полоса остаётся на прежнем месте; при
  // конфликте причина показывается человеку, а полоса «возвращается» сама
  // (данные не тронуты). Ход перетаскивания показывает только призрак
  // (dragPreview) — это указатель, а не новое значение дат.
  const [dragPreview, setDragPreview] = useState<{ tripKey: string; a: number; b: number; mode: PlanDragMode } | null>(null);
  const dragRef = useRef<{
    tripKey: string;
    a: number;
    b: number;
    a2: number;
    b2: number;
    mode: PlanDragMode;
    startX: number;
    moved: boolean;
  } | null>(null);
  /** Клик сразу после перетаскивания окно НЕ открывает (полоса не «прыгает»). */
  const suppressClickRef = useRef<{ key: string; ts: number } | null>(null);
  const planBarDragEnabled = (tripKey: string, archived: boolean): boolean =>
    !!onPlanBoundsDrag && (tripKey.startsWith('pd:') ? canDragPlan : canDragManual && !archived);
  const beginPlanDrag = (e: React.PointerEvent<HTMLDivElement>, tripKey: string, a: number, b: number, archived: boolean) => {
    if (e.button !== 0 || !planBarDragEnabled(tripKey, archived)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Края полосы (6 px) — растягивание старта/возвращения, середина — перенос.
    const mode: PlanDragMode = e.clientX - rect.left <= 6 ? 'start' : rect.right - e.clientX <= 6 ? 'end' : 'move';
    dragRef.current = { tripKey, a, b, a2: a, b2: b, mode, startX: e.clientX, moved: false };
    const move = (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const delta = Math.round((ev.clientX - st.startX) / colW);
      let a2 = st.a;
      let b2 = st.b;
      if (st.mode === 'move') {
        a2 = st.a + delta;
        b2 = st.b + delta;
      } else if (st.mode === 'start') {
        a2 = Math.min(st.a + delta, st.b);
      } else {
        b2 = Math.max(st.b + delta, st.a);
      }
      if (a2 === st.a2 && b2 === st.b2) return;
      st.a2 = a2;
      st.b2 = b2;
      if (a2 !== st.a || b2 !== st.b) st.moved = true;
      setDragPreview({ tripKey: st.tripKey, a: a2, b: b2, mode: st.mode });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      if (!st || !st.moved) return;
      suppressClickRef.current = { key: st.tripKey, ts: Date.now() };
      onPlanBoundsDrag?.(st.tripKey, dayStr(st.a2), dayStr(st.b2));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const planBarClick = (tripKey: string) => {
    const s = suppressClickRef.current;
    if (s && s.key === tripKey && Date.now() - s.ts < 400) return;
    onOpenTrip(tripKey);
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
  /**
   * Занятые зоны подписи от меток кругов рейса (координаты строки): бейдж
   * «×N» в начале полосы и засечки между кругами. Подпись обтекает их по
   * общему правилу lib/barLabels — маркеры никогда не перекрывают текст.
   * Засечки учитываются только ВИДИМЫЕ при текущем масштабе (visibleCircleTicks):
   * скрытая засечка не должна «отжимать» подпись.
   */
  const circleMarksObstacles = (cm: TripCircleMarks | null | undefined, barLeft: number): BarObstacle[] => {
    if (!cm) return [];
    const out: BarObstacle[] = [];
    if (cm.badge) out.push({ left: barLeft + 1, right: barLeft + 20 });
    visibleCircleTicks(cm, (tk) => Math.round((tk.at - vs) * colW) - barLeft).forEach(({ x }) => {
      const abs = barLeft + x;
      out.push({ left: abs - 6, right: abs + 12 });
    });
    return out;
  };
  /**
   * Метки кругов поверх полосы (слой TL_Z.mark): бейдж «×2»/«×3» в начале
   * полосы и тонкие засечки с номерами между кругами. Слой не перехватывает
   * указатель — клик и наведение остаются у самой полосы/этапов; метки НЕ
   * перекрывают подпись (та обходит их свободными сегментами). На мелком
   * масштабе засечки, сталкивающиеся с бейджем/соседкой, скрываются
   * (visibleCircleTicks) — без сдвига и без выдуманных дат.
   */
  const circleMarksLayer = (cm: TripCircleMarks | null | undefined, keyPrefix: string, barLeft: number): React.ReactNode =>
    !cm ? null : (
      <div aria-hidden="true" className="absolute inset-0 flex items-center pointer-events-none" style={{ zIndex: TL_Z.mark }}>
        {cm.badge ? (
          <span
            data-tl-trip-circles={cm.count}
            className={`${TRIP_CIRCLE_BADGE_CLS} ml-0.5`}
            style={tripCircleBadgeStyle()}
            title={cm.title}
          >
            {cm.badge}
          </span>
        ) : null}
        {visibleCircleTicks(cm, (tk) => Math.round((tk.at - vs) * colW) - barLeft - 1).map(({ tick: tk, x }) => (
          <span
            key={`${keyPrefix}-ct-${tk.n}`}
            data-tl-circle-tick={tk.n}
            className={TRIP_CIRCLE_TICK_CLS}
            style={{ left: x }}
            title={tk.title}
          >
            <i className="w-[2px] h-[9px] rounded-full" style={{ background: TRIP_CIRCLE_TICK_LINE }} />
            <b className="text-[7px] leading-none font-bold" style={{ color: TRIP_CIRCLE_TICK_TEXT }}>
              {tk.n}
            </b>
          </span>
        ))}
      </div>
    );
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
      if (it.kind === 'plan') {
        items.push({ group: 0, a: it.a, b: it.b, h: PLAN_BAR_H });
        return items.length - 1;
      }
      return null;
    });
    return { slot, layout: layoutLaneTracks(items, { padTop: PLAN_PAD, padBottom: PLAN_PAD, gap: TRACK_GAP }) };
  }, [row.planItems]);
  /**
   * Высоты дорожки «План»: planBandH — ЕСТЕСТВЕННАЯ высота содержимого (ровно
   * то, что было при настройке по умолчанию: раскладка по под-дорожкам или
   * минимум PLAN_H), planH — дорожка с ОБЩЕЙ настройкой высоты строк (rowH).
   * Ниже естественной высоты дорожка не сжимается — иначе полосы и подписи
   * обрезались бы. Содержимое рисуется в полосе planBandH, СДВИНУТОЙ вниз на
   * planOffset: увеличенная дорожка держит содержимое по центру, а не прижимает
   * его кверху; при дефолте (22 = PLAN_H) сдвиг равен нулю и вид прежний.
   */
  // Полоса растёт вместе с высотой строки: лента содержимого занимает дорожку
  // почти целиком (LANE_PAD_RATIO — на отступы), при дефолте вид прежний.
  const planBandH = Math.max(PLAN_H, planTrack.layout.laneH, rowH - Math.round(rowH * LANE_PAD_RATIO));
  const planH = Math.max(rowH, planBandH);
  const planOffset = Math.round((planH - planBandH) / 2);
  /**
   * ВЫСОТА полосы содержимого: естественная высота минус 1 px — нижняя граница
   * дорожки (border-b). Именно в такой контентной коробке полосы рисовались до
   * настройки высоты, поэтому при дефолте (offset = 0) вид ОСТАЁТСЯ прежним
   * пиксель в пиксель: полосы, их подписи и метки не «переезжают» ни на пиксель.
   */
  const planBandContentH = planBandH - 1;
  /** Позиции содержимого плановой полосы — в координатах ПОЛОСЫ (band), не дорожки. */
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
  /** То же для подстроки «Факт»: factBandH — естественная высота содержимого,
   *  factOffset — сдвиг центрирования содержимого в увеличенной дорожке,
   *  factBandContentH — высота полосы содержимого (естественная минус 1 px
   *  нижней границы; при дефолте вид прежний — см. «План»). */
  // Компактный вид: факт — тонкая линия статуса под полосой плана.
  const factBandH = detailed
    ? Math.max(FACT_H, factTrack.layout.laneH, rowH - Math.round(rowH * LANE_PAD_RATIO))
    : FACT_COMPACT_BAND;
  const factH = detailed ? Math.max(rowH, factBandH) : FACT_COMPACT_BAND + 2;
  const factOffset = Math.round((factH - factBandH) / 2);
  const factBandContentH = factBandH - 1;
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
      if (it.kind === 'plan') {
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
  /** Тонкая штриховка просрочки (красный сегмент) — вторичный признак для
   *  дальтоников; остальные сегменты различаются только цветом. */
  const RED_SEG_HATCH =
    'repeating-linear-gradient(45deg, rgba(159,18,57,0.16), rgba(159,18,57,0.16) 2px, transparent 2px, transparent 7px)';
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
      // Опоздание читается цветом сегмента; значок на каждом сегменте убран —
      // он давал рябь. Штриховка — только у просрочки. Подробности — в подсказке.
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
            ...(s.color === 'red' ? { backgroundImage: RED_SEG_HATCH } : {}),
            borderTop: `1px solid ${st.border}`,
            borderBottom: `1px solid ${st.border}`,
            ...(first ? { borderLeft: `1px solid ${st.border}` } : {}),
            ...(last ? { borderRight: `1px solid ${st.border}` } : {}),
          }}
          title={segTitleOf(s)}
        />
      );
    });
  /** Статус-линия компактного вида (lib/statusLine): сплошные участки
   *  «по плану / срок подходит / просрочка», подсказка — причина цвета. */
  const statusEls = (segs: StatusLineSegment[], barLeft: number, barWidth: number): React.ReactNode[] =>
    segs.map((s, i) => {
      const left = Math.max(0, Math.round(dayToX(s.a, vs, colW) - barLeft));
      const right = Math.min(barWidth, Math.round(dayToX(s.b, vs, colW) + colW - barLeft));
      return (
        <span
          key={`st-${s.a}-${s.b}-${s.state}-${i}`}
          data-status-seg={s.state}
          className="absolute top-0 bottom-0"
          style={{ left, width: Math.max(1, right - left), background: STATUS_LINE_COLORS[s.state].color }}
          title={s.state === 'ok' ? `По плану · ${s.reason}` : s.reason}
        />
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
   * Точки событий ремонта вешает РОВНО ОДНА полоса периода: основная — «факт
   * базы» (полоса учёта выезда); если у периода факт-полосы нет (не указан
   * приезд) — полоса ремонта. Иначе события дублировались бы на обеих.
   */
  const bzEventDotKeys = useMemo(
    () =>
      new Set(
        factBz.stripes.filter((s) => s.kind === 'base-fact' && s.periodKey).map((s) => s.periodKey as string),
      ),
    [factBz],
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
    () => layoutStageFills(row.stageInputs, 'plan', vs, ve, planSec.slotForStage, scheduleOf),
    [row.stageInputs, vs, ve, planSec],
  );
  const factFills = useMemo(
    () => layoutStageFills(row.stageInputs, 'fact', vs, ve, factSec.slotForStage),
    [row.stageInputs, vs, ve, factSec],
  );
  /**
   * СЕГМЕНТЫ «РИСКИ» (запас дней bufferDays) — ЕДИНЫЙ механизм для ВСЕХ
   * рейсов: сразу после сегмента КАЖДОГО этапа с запасом > 0 на подстроке
   * «План» (ширина = запас × ширина дня текущего масштаба), плюс у ручных
   * рейсов — запас ЗАПИСИ (trip.bufferDays) после полосы. Порядок, урезание
   * (сегменты не накладываются; при частичной видимости анкер — по последней
   * видимой доле этапа, сегмент урезается вместе с ним) и пороги текста
   * («Риски +N дн» / «+N» / без текста) — чистая функция lib/riskSegments.
   */
  const planRiskSegs = useMemo<RiskSegment[]>(() => {
    const lastFill = new Map<string, StageFillSection>();
    planFills.forEach((f) => {
      const k = `${f.tripKey}|${f.stage.id}`;
      const prev = lastFill.get(k);
      if (!prev || f.day > prev.day) lastFill.set(k, f);
    });
    const inputs: RiskSegmentInput[] = [];
    lastFill.forEach((f) => {
      const days = stageBufferOf(f.stage);
      if (days <= 0) return;
      inputs.push({
        tripKey: f.tripKey,
        stageId: f.stage.id,
        seq: stageSeqOf(f.stage, 0),
        anchor: dayToX(f.day, vs, colW) + Math.round(((f.section + 1) * colW) / f.sections),
        days,
      });
    });
    row.tripBuffers.forEach((b) => {
      inputs.push({ tripKey: b.tripKey, seq: 0, anchor: dayToX(b.anchorDay, vs, colW), days: b.days });
    });
    return layoutRiskSegments(inputs, W, colW);
  }, [planFills, row.tripBuffers, vs, colW, W]);
  /** Зоны сегментов «Риски» по рейсу — подписи (полосы и клеток этапов) их обтекают. */
  const planRiskZonesByTrip = useMemo(() => {
    const m = new Map<string, BarObstacle[]>();
    planRiskSegs.forEach((s) => {
      const zone: BarObstacle = { left: s.left, right: s.right };
      const arr = m.get(s.tripKey);
      if (arr) arr.push(zone);
      else m.set(s.tripKey, [zone]);
    });
    return m;
  }, [planRiskSegs]);
  /**
   * ЗАНЯТЫЕ ЗОНЫ ПОДПИСЕЙ подстрок — единое правило lib/barLabels: подпись
   * полосы «обтекает» клетки этапов (в день с половинами занятой считается
   * вся ячейка дня), однодневные отметки базы/ремонта и 14-пиксельные маркеры
   * стыков. У каждой полосы зоны вычитаются в её собственных координатах.
   */
  const planLabelObstacles = useMemo<BarObstacle[]>(() => {
    const daySlots = (day: number): number => planSec.byDay.get(day)?.length || 1;
    const out = obstaclesFromFills(planFills, daySlots, (d) => dayToX(d, vs, colW), colW);
    // Сегменты «Риски» — тоже занятые зоны: подпись полосы (и подписи полос
    // базы/ремонта) не заходят под штриховку запаса.
    planRiskSegs.forEach((s) => out.push({ left: s.left, right: s.right }));
    planBz.marks.forEach((m) => {
      const l = dayToX(m.day, vs, colW);
      out.push({ left: l, right: l + colW });
    });
    row.planOv.markers.forEach((m) => {
      const x = dayToX(m.day, vs, colW) + Math.round(colW * m.frac);
      out.push({ left: x - 7, right: x + 7 });
    });
    return out;
  }, [planFills, planSec, planRiskSegs, planBz.marks, row.planOv.markers, vs, colW]);
  const factLabelObstacles = useMemo<BarObstacle[]>(() => {
    const daySlots = (day: number): number => factSec.byDay.get(day)?.length || 1;
    const out = obstaclesFromFills(factFills, daySlots, (d) => dayToX(d, vs, colW), colW);
    factBz.marks.forEach((m) => {
      const l = dayToX(m.day, vs, colW);
      out.push({ left: l, right: l + colW });
    });
    row.factOv.markers.forEach((m) => {
      const x = dayToX(m.day, vs, colW) + Math.round(colW * m.frac);
      out.push({ left: x - 7, right: x + 7 });
    });
    row.factItems.forEach((it) => {
      if (it.kind !== 'event') return;
      const l = dayToX(it.day, vs, colW) + Math.round(colW * (it.count > 1 ? 0.45 : 0.62));
      out.push({ left: l - 2, right: l + (it.count > 1 ? 16 : 9) + 2 });
    });
    return out;
  }, [factFills, factSec, factBz.marks, row.factOv.markers, row.factItems, vs, colW]);
  /**
   * Занятые зоны подписей ПОЛОС БАЗЫ/РЕМОНТА (отдельно от полос рейсов):
   * к общим зонам строки добавляются полосы РЕЙСОВ этой подстроки (они лежат
   * выше, z-2 против z-1), их метки кругов (бейдж «×N», засечки) и чип
   * «Передача: …» в плане — подпись простоя не уходит ни под одну из них.
   * Полосам рейсов эти зоны НЕ передаются: собственная полоса не должна
   * отжимать свою же подпись.
   */
  const planHandoverObstacles = useMemo<BarObstacle[]>(() => {
    const out: BarObstacle[] = [];
    row.planItems.forEach((it) => {
      if (it.kind !== 'handover') return;
      const x = Math.round((it.point - vs) * colW);
      if (x > -200 && x < W + 200) out.push({ left: x + 3, right: x + 3 + 170 });
    });
    return out;
  }, [row.planItems, vs, colW, W]);
  const planBzObstacles = useMemo<BarObstacle[]>(() => {
    const out = [...planLabelObstacles, ...planHandoverObstacles];
    row.planItems.forEach((it) => {
      if (it.kind === 'handover') return;
      const p = pos(it.a, it.b);
      if (!p) return;
      const r = it.kind === 'plan' ? adjRect(p, row.planOv.tripAdjust.get(it.tripKey) ?? null) ?? p : p;
      out.push({ left: r.left, right: r.left + r.width });
      if (it.kind === 'plan') out.push(...circleMarksObstacles(it.circleMarks, r.left));
    });
    return out;
  }, [planLabelObstacles, planHandoverObstacles, row.planItems, row.planOv.tripAdjust, vs, colW]);
  const factBzObstacles = useMemo<BarObstacle[]>(() => {
    const out = [...factLabelObstacles];
    row.factItems.forEach((it) => {
      if (it.kind === 'event' || it.kind === 'handover') return;
      const p = pos(it.a, it.b);
      if (!p) return;
      const r = adjRect(p, row.factOv.tripAdjust.get(it.tripKey) ?? null) ?? p;
      out.push({ left: r.left, right: r.left + r.width });
      if (it.kind === 'fact') out.push(...circleMarksObstacles(it.circleMarks, r.left));
    });
    return out;
  }, [factLabelObstacles, row.factItems, row.factOv.tripAdjust, vs, colW, W]);
  /** Спокойная сетка: слабые вертикальные деления дней на читаемых масштабах. */
  const laneBg = colW >= 12
    ? {
        backgroundImage: `repeating-linear-gradient(to right, #F1F2F4 0px, #F1F2F4 1px, transparent 1px, transparent ${colW}px)`,
      }
    : {};
  /**
   * СЕГМЕНТ «РИСКИ» (запас дней, lib/riskSegments) — ОДИН механизм для всех
   * рейсов: заметная жёлто-оранжевая диагональная штриховка, чёткая граница
   * со стороны этапа (2px), текст «Риски +N дн» (узкий — «+N», полный текст —
   * в подсказке), слой TL_Z.risk ПОВЕРХ полосы «План» и клеток этапов (запас
   * больше не прячется под полосой), ниже меток. Геометрия — только из
   * lib/riskSegments (сегменты не накладываются, урезаются с этапом).
   * Клик: открыть карточку рейса и выделить этап (у запаса записи — карточку).
   */
  const renderRiskSegment = (r: RiskSegment) => {
    const idx = row.planItems.findIndex((it) => it.kind === 'plan' && it.tripKey === r.tripKey);
    const planItem = idx >= 0 ? row.planItems[idx] : null;
    const lanes = idx >= 0 ? planBarLanes.get(idx) : undefined;
    const twoLane = !!lanes && lanes.lanes > 1;
    const stageInput = r.stageId ? stageByKey.get(`${r.tripKey}|${r.stageId}`) || null : null;
    const buffer = stageInput ? bufferInfoFor(r.tripKey, stageInput.stage) : null;
    const title = stageInput && buffer ? stageRiskTitle(stageTypes, stageInput.stage, buffer) : tripRiskTitle(r.days);
    const open = () => {
      if (stageInput) onOpenTripStage(r.tripKey, stageInput.stage.id);
      else onOpenTrip(r.tripKey);
    };
    const archived = planItem && planItem.kind === 'plan' ? planItem.archived : false;
    // Чип направления полосы (слой меток) стоит у правого края полосы и может
    // попасть ВНУТРЬ сегмента запаса, если буфер выходит за конец рейса —
    // текст сегмента не заходит под чип: бюджет ширины → «+N» → без текста
    // (тот же принцип, что у подписей полос; правило — riskTextBudgetWithChip).
    let chipZone: { left: number; right: number } | null = null;
    if (planItem && planItem.kind === 'plan') {
      const chip = planItem.dir ? directionChipColors(planItem.dir.color) : null;
      const p = pos(planItem.a, planItem.b);
      const adj = row.planOv.tripAdjust.get(r.tripKey) ?? null;
      const pr = p ? adjRect(p, adj) ?? p : null;
      if (chip && pr && pr.width >= 96) chipZone = { left: pr.left + pr.width - 36, right: pr.left + pr.width };
    }
    const riskText = riskSegmentTextOf(r.days, riskTextBudgetWithChip(r.width, r.left, r.right, chipZone));
    return (
      <div
        key={`risk-${r.tripKey}-${r.stageId || 'trip'}`}
        role="button"
        tabIndex={0}
        data-risk-seg="1"
        data-risk-kind={r.stageId ? 'stage' : 'trip'}
        data-risk-days={r.days}
        data-risk-text={riskText || undefined}
        data-stage-buffer={r.days}
        data-stage={r.stageId || undefined}
        data-trip={r.tripKey}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        onMouseEnter={() => setHoverTrip(r.tripKey)}
        onMouseLeave={() => setHoverTrip((v) => (v === r.tripKey ? null : v))}
        className={`absolute flex items-center cursor-pointer ${twoLane ? '' : 'top-0 bottom-0'}`}
        style={{
          zIndex: TL_Z.risk,
          left: r.left,
          width: r.width,
          ...(twoLane
            ? {
                top: `calc(${(lanes!.lane * 100) / lanes!.lanes}% + 1px)`,
                height: `calc(${100 / lanes!.lanes}% - 2px)`,
              }
            : {}),
          backgroundImage: riskHatch,
          border: `1px solid ${RISK_COLORS.border}`,
          borderLeft: `2px solid ${RISK_COLORS.edge}`,
          borderRadius: '0 var(--tl-bar-r) var(--tl-bar-r) 0',
          ...(archived ? { opacity: RISK_COLORS.archivedOpacity } : {}),
          ...link(r.tripKey),
        }}
        title={title}
      >
        {riskText ? (
          <span
            data-risk-label="1"
            className="min-w-0 px-1 overflow-hidden text-ellipsis whitespace-nowrap text-[8px] leading-[10px] font-semibold"
            style={{ color: RISK_COLORS.text }}
          >
            {riskText}
          </span>
        ) : null}
      </div>
    );
  };
  /** Секции заливок этапов — на всю высоту подстроки, кликабельны, в новом стиле
   *  (единое скругление, заливка, hover/focus). Этапы — ВСЕГДА поверх полос
   *  (слой TL_Z.stage); доля дня — из единого правила половин ячейки. */
  const renderStageFill = (f: StageFillSection, keyPrefix: string, sec: RowDaySections, lane: 'plan' | 'fact' = 'fact') => {
    const left = dayToX(f.day, vs, colW) + Math.round((f.section * colW) / f.sections);
    const right = dayToX(f.day, vs, colW) + Math.round(((f.section + 1) * colW) / f.sections);
    const width = Math.max(1, right - left);
    const open = () => onOpenTripStage(f.tripKey, f.stage.id);
    // Скругление — как у полос: у секций дня скругляются только внешние края.
    const r = 4;
    const radius = `${f.section === 0 ? `${r}px` : '0px'} ${f.section === f.sections - 1 ? `${r}px` : '0px'} ${
      f.section === f.sections - 1 ? `${r}px` : '0px'
    } ${f.section === 0 ? `${r}px` : '0px'}`;
    // Запас этапа (lib/stageSchedule): в подсказке — размер и дата с запасом;
    // сам запас нарисован сегментом «Риски» СПРАВА от секции этапа
    // (renderRiskSegment, слой TL_Z.risk). Тот же буферный текст — в подсказке
    // сегмента (stageRiskTitle) — источник один: bufferInfoFor.
    const state = stageStateByKey.get(`${f.tripKey}|${f.stage.id}`) || null;
    const bufferInfo = bufferInfoFor(f.tripKey, f.stage);
    // Подсказка доли: событие этапа + строка о соседнем событии этого дня.
    const neighbor = sec.neighborsOf(f.day, [stageMergeKeyOf(f.tripKey, f.stage.id)]);
    const titleBase = stageFillTitle(stageTypes, f.stage, f.day, today, bufferInfo);
    const title = neighbor ? `${titleBase}\n${neighbor}` : titleBase;
    // Статус факта с учётом запаса — вторичный признак на самой секции ФАКТА:
    // «в пределах запаса» — жёлтая полоска снизу, «за пределами» — красная.
    const stateCode = lane === 'fact' && state ? state.code : null;
    const stateTone = stateCode === 'within' ? '#D97706' : stateCode === 'beyond' || stateCode === 'planned-overdue' ? '#E11D48' : null;
    // Значок этапа лежит прямо на полосе: без цветной клетки, серый, пока всё
    // в срок; янтарный/красный — только при опоздании (тот же статус запаса).
    const iconColor = stageToneOf(state ? state.code : null) ?? STAGE_ICON_NEUTRAL;
    const iconStyle: React.CSSProperties = { color: iconColor, width: 'var(--tl-ic, 12px)', height: 'var(--tl-ic, 12px)' };
    // Иконка типа события — в своей доле; мелкий масштаб — только иконка.
    const StageIcon = stageIconOf(f.stage.type);
    // Подпись этапа — СТРОГО в границах своей доли: не шире клетки этапа и не
    // под сегментом «Риски» (сегмент соседнего этапа может заходить на эту
    // клетку, слой TL_Z.risk выше). Text-overflow ellipsis, без переноса;
    // полный текст — в подсказке (title). Плановые и фактовые доли считаются
    // раздельно (у «Факта» сегментов «Риски» нет).
    const riskZones = lane === 'plan' ? planRiskZonesByTrip.get(f.tripKey) || [] : [];
    const labelRight = riskZones.reduce(
      (acc, z) => (z.left < right && z.right > left + 2 ? Math.min(acc, Math.max(left, z.left)) : acc),
      right,
    );
    const avail = Math.max(0, labelRight - left);
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
        data-stage-buffer-state={stateCode || undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className={`absolute top-0 bottom-0 cursor-pointer overflow-hidden whitespace-nowrap flex items-center justify-center hover:bg-white/70 transition-colors ${width >= 20 ? 'px-0.5' : ''}`}
        style={{
          zIndex: TL_Z.stage,
          left,
          width,
          borderRadius: radius,
          color: STAGE_ICON_NEUTRAL,
          ...(f.stage.isCritical ? { outline: '1px dashed #DC2626', outlineOffset: '-1px' } : {}),
          ...(f.archived ? { opacity: 0.72 } : {}),
        }}
        title={title}
      >
        {avail >= 56 ? (
          <span className="inline-flex items-center gap-1 min-w-0" style={{ maxWidth: Math.max(0, avail - 4) }}>
            <StageIcon className="shrink-0" style={iconStyle} aria-hidden="true" />
            <span className="min-w-0 text-[length:var(--tl-fs,8px)] leading-[1.25] font-medium truncate" style={{ maxWidth: Math.max(0, avail - 22) }}>
              {stageShortName(stageTypes, f.stage)}
            </span>
          </span>
        ) : width >= 12 ? (
          <StageIcon className="shrink-0" style={iconStyle} aria-hidden="true" />
        ) : null}
        {stateTone ? (
          <span
            aria-hidden="true"
            data-stage-buffer-flag="1"
            className="absolute left-0 right-0 bottom-0 pointer-events-none"
            style={{ height: 3, background: stateTone }}
          />
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
    /** Занятые зоны строки (клетки этапов/отметки/маркеры) в координатах строки. */
    obstacles?: BarObstacle[];
    /**
     * Нижний отступ полосы внутри подстроки (px). Нужен «Факту» машины с
     * перенесёнными строками меток событий: полоса не растягивается, а под ней
     * освобождается место для строки меток. По умолчанию 0 — поведение полос
     * без изменений.
     */
    bottomInset?: number;
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
    /** Перетаскивание полосы (план рейса): режим выбирается по позиции указателя. */
    onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
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
    // сегмент и остаётся sticky в его пределах; при прокрутке сама
    // «переезжает» в другой свободный сегмент (lib/barLabels.sweepBarLabels).
    // Ступени сокращения: полный текст → короткий вариант → первое слово с
    // многоточием → иконка; совсем без места — подписи нет, полный текст
    // остаётся в подсказке полосы (title) и в подсказках этапов.
    const labelSegs: BarLabelSegment[] = o.labelText
      ? barLabelSegments(
          o.width,
          (o.obstacles || []).map((b) => ({ left: b.left - o.left, right: b.right - o.left })),
        )
      : [];
    // Полоса шире минимального сегмента, но всё занято этапами — подписи нет.
    const labelNoRoom = !!o.labelText && !labelSegs.length && o.width >= LABEL_MIN_SEG;
    const labelEl =
      o.labelOnlyIcon && o.labelIcon && !o.labelText ? (
        <span data-bz-label="icon" className="w-full h-full flex items-center justify-center" aria-hidden="true">
          {o.labelIcon}
        </span>
      ) : labelSegs.length ? (
        <>
          {labelSegs.map((seg) => {
            const variant = labelVariantFor(seg.width, o.labelText || '', o.labelShort || '', hasLabelIcon);
            const text = variant === 'none' ? '' : labelTextFor(variant, o.labelText || '', o.labelShort || '');
            return (
              <span
                key={seg.index}
                data-tl-labelseg={seg.index}
                className="absolute flex items-center"
                style={{ left: seg.left, width: seg.width, top: 0, bottom: 0, overflow: 'visible' }}
              >
                {text ? (
                  <span
                    data-bar-label="1"
                    className="sticky inline-flex items-center gap-0.5 min-w-0 px-1 text-[length:var(--tl-fs,8px)] leading-[1.25] font-semibold truncate"
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
                ) : o.labelIcon ? (
                  <span data-bar-label="icon" className="w-full h-full flex items-center justify-center" aria-hidden="true">
                    {o.labelIcon}
                  </span>
                ) : null}
              </span>
            );
          })}
        </>
      ) : !labelNoRoom && o.width >= MIN_LABEL_BOX && (o.labelText || o.labelIcon) ? (
        <span
          data-bar-label="1"
          className="inline-flex items-center gap-0.5 min-w-0 px-1 text-[length:var(--tl-fs,8px)] leading-[1.25] font-semibold truncate max-w-full"
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
        {...labelGeoAttrs}
        style={{
          left: o.left,
          width: o.width,
          top: lanes > 1 ? `calc(${(lane * 100) / lanes}% + 1px)` : 0,
          height: lanes > 1 ? `calc(${100 / lanes}% - 2px)` : undefined,
          bottom: lanes > 1 ? undefined : o.bottomInset || 0,
        }}
      >
        <div
          {...(o.attrKind === 'bz' ? { 'data-bz-stripe': o.kind } : { 'data-bar': o.kind })}
          {...(o.attrs || {})}
          role={o.role}
          tabIndex={o.tabIndex}
          onClick={o.onClick}
          onKeyDown={o.onKeyDown}
          onPointerDown={o.onPointerDown}
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
          {o.post}
        </div>
        {/* Подпись — ОТДЕЛЬНЫМ слоем над полосой (тот же z, что у полосы):
            полоса с overflow-hidden/маской подпись не режет, position: sticky
            работает (нет промежуточного скролл-контейнера). Указатель слой не
            перехватывает — клик и hover принадлежат самой полосе. */}
        {labelEl ? (
          <div className="absolute inset-0 flex items-center" style={{ zIndex: o.z ?? TL_Z.bz, pointerEvents: 'none' }}>
            {labelEl}
          </div>
        ) : null}
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
  const renderBzStripe = (
    s: BzStripe,
    keyPrefix: string,
    ov: RowOverlapResolution,
    sec: RowDaySections,
    obstacles: BarObstacle[],
    /** Метки событий на базе над ЭТОЙ полосой (по одному периоду — одна полоса). */
    withEventDots = false,
    /**
     * Нижний отступ полосы в подстроке «Факт» (px): освобождает место ПОД
     * полосой для перенесённых строк меток событий. Сама полоса при этом
     * сохраняет высоту FACT_H (метки не растягивают её).
     */
    bottomInset = 0,
    /**
     * Верх первой «подполосной» строки меток (px от верхнего края полосы):
     * нижний край полосы + 1 px. Строки 1+ рисуются под полосой — не на подписи.
     * Координата — в ПОЛОСЕ содержимого (band), поэтому общая высота строк
     * (rowH) её не сдвигает: полоса и её метки центрируются в дорожке вместе.
     */
    chipBelowTop = FACT_H + 1,
  ) => {
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
    /**
     * МЕТКИ СОБЫТИЙ НА БАЗЕ — тот же приём и размеры, что у метки события
     * рейса (слой TL_Z.mark, высота 9 px как у одиночной метки события рейса):
     * компактная плашка с началом текста (у старых записей без текста — подпись
     * бывшего типа) на дне события; полный текст — в подсказке. Несколько
     * событий дня идут слева направо по seq; тем, кому не хватило места,
     * раскладка (layoutEventDots) даёт следующую строку — она рисуется ПОД
     * полосой (вторая и далее строки; подстрока «Факт» этой машины становится
     * выше на EVENT_CHIP_ROW_STEP, сама полоса не растёт). Метки — препятствия
     * для подписи полосы: подпись их обтекает и не накладывается.
     * Клик открывает окно периода этой машины и подсвечивает ИМЕННО это событие.
     */
    const evChips =
      withEventDots && s.periodKey
        ? layoutEventDots(bzEventsById.get(s.periodKey) || [], clipA, clipB, (d) => dayToX(d, vs, colW) - left, colW)
        : [];
    /** Строка раскладки → верхняя координата (px от верхнего края полосы). */
    const chipTopOf = (line: number): number =>
      line <= 0 ? EVENT_CHIP_TOP : chipBelowTop + (line - 1) * EVENT_CHIP_ROW_STEP;
    const evDotsLayer = evChips.length ? (
      <div className="absolute inset-0" style={{ zIndex: TL_Z.mark, pointerEvents: 'none' }} data-bz-events="1">
        {evChips.map((c) => (
          <BaseEventMark
            key={`bzev-${c.key}`}
            chip={c}
            periodKey={s.periodKey as string}
            archived={!!s.archived}
            top={chipTopOf(c.line)}
            onOpen={() => {
              if (!s.periodKey) return;
              const firstId = c.items[0]?.id;
              if (onOpenBaseEvent && firstId) onOpenBaseEvent(s.periodKey, firstId);
              else onOpenBase(s.periodKey);
            }}
          />
        ))}
      </div>
    ) : null;
    // «Учёт выезда»: подпись и иконка статуса (учёт ведётся / закрыт / не зафиксирован /
    // расхождение) — цвет полосы задан статусом; при узкой ширине остаётся иконка.
    const isVyezd = s.kind === 'base-fact';
    const StatusIcon = isVyezd && s.status ? vyezdStatusIcon(s.status) : null;
    // Ремонт — вторичный признак (кроме цвета): значок гаечного ключа в подписи
    // (тот же значок, что у отметки окончания ремонта). Цвет остаётся палитровым.
    const KindIcon = s.kind === 'repair' ? Wrench : null;
    const showLabel = width >= (isVyezd ? 62 : 44) && (!isVyezd || !!StatusIcon);
    // Подпись — ЕДИНОЕ правило (lib/barLabels): полный текст (ремонт и учёт
    // выезда — с датами периода), короткая ступень — короткий вариант
    // («Простой на базе», «Ремонт»); выбор ступени делает единая функция по
    // ширине СВОБОДНОГО сегмента, полный текст всегда в подсказке (title).
    const withDates = (txt: string): string => (s.dateLabel ? `${txt} · ${s.dateLabel}` : txt);
    const labelFull = (s.kind === 'repair' || isVyezd) && s.dateLabel ? withDates(s.label) : s.label;
    const labelShort = s.shortLabel && s.shortLabel !== s.label ? s.shortLabel : s.label;
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
    /**
     * Подпись полосы обтекает и метки событий: их зоны добавляются к общим
     * препятствиям полосы (координаты строки) — подпись никогда не встаёт на
     * метку события (требование «без наложения на подписи полос»).
     */
    const labelObstacles: BarObstacle[] = evChips.length
      ? [...obstacles, ...evChips.map((c) => ({ left: left + c.x, right: left + c.x + c.width }))]
      : obstacles;
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
      labelText: showLabel && labelFull ? labelFull : undefined,
      labelShort,
      labelIcon: StatusIcon ? (
        <StatusIcon className="w-2.5 h-2.5 shrink-0" style={{ color: color.text }} aria-hidden="true" />
      ) : KindIcon ? (
        <KindIcon className="w-2.5 h-2.5 shrink-0" style={{ color: color.text }} aria-hidden="true" />
      ) : undefined,
      labelOnlyIcon: isVyezd && !!StatusIcon && width >= 16 && !(showLabel && labelFull),
      obstacles: labelObstacles,
      bottomInset,
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
      // Точки событий ремонта — поверх полосы (слой TL_Z.mark), как прочие метки.
      marksOverlay: evDotsLayer,
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
  /** Статус машины и мини-чипы направлений (полное имя — в подсказке). Счётчики рейсов — только в подсказке ячейки. */
  /** Точка статуса перед номером (компактный вид): цвет статуса, подпись — в подсказке. */
  const statusDot = badge ? (
    <span
      data-tl-status-dot={badge.label}
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: badge.dot }}
      title={`${badge.label} · ${badge.title}`}
      aria-label={badge.label}
    />
  ) : (
    <span className="w-2 h-2 shrink-0" aria-hidden="true" />
  );
  const statusChips = (withBadge: boolean) => (
    <>
      {withBadge && badge ? (
        <span
          className="inline-flex items-center gap-1 h-[14px] rounded-full px-1.5 py-0 text-[9px] leading-[14px] font-semibold whitespace-nowrap shrink-0"
          style={{ background: badge.bg, color: badge.fg }}
          title={badge.title}
        >
          <span className="w-1 h-1 rounded-full" style={{ background: badge.dot }} aria-hidden="true" />
          {badge.label}
        </span>
      ) : null}
      {row.directions.slice(0, 2).map((d) => {
        const dc = directionChipColors(d.color);
        return (
          <span
            key={d.id}
            data-tl-dir-chip={d.name}
            className="inline-flex items-center h-[14px] rounded-full px-1.5 text-[9px] leading-[14px] font-semibold shrink-0 select-none"
            style={{ background: dc.bg, border: `1px solid ${dc.border}`, color: dc.text }}
            title={`Направление: ${d.name}${d.code ? ` (${d.code})` : ''}`}
          >
            {d.code}
          </span>
        );
      })}
      {row.directions.length > 2 ? (
        <span className="text-[9px] leading-[12px] text-[var(--tl-text-dim)] shrink-0 tabular-nums" title={row.directions.map((d) => d.name).join(', ')}>
          +{row.directions.length - 2}
        </span>
      ) : null}
    </>
  );
  /** Тревоги машины: расхождения учёта выезда и предупреждения данных (текст — в подсказке). */
  const alertIcons = (
    <>
      {ovAlertTitles.length ? (
        <span data-tl-overlap-indicator="1" data-tl-car={row.carKey} className="inline-flex items-center" title={ovNote} aria-label={ovNote}>
          <CalendarClock className="w-3 h-3" style={{ color: '#B45309' }} aria-hidden="true" />
        </span>
      ) : null}
      {row.warnings.length ? (
        <span title={warnTitle} className="inline-flex" aria-label={warnTitle}>
          <AlertTriangle className="w-3 h-3" style={{ color: CLR.warn }} aria-hidden="true" />
        </span>
      ) : null}
    </>
  );

  return (
    <>
      {/* Подстрока «План» — закреплена слева: номер машины (главный элемент). */}
      <div
        data-tl-row={row.carNumber}
        data-tl-car={row.carKey}
        data-tl-cell="plan"
        data-tl-colcell="1"
        onMouseEnter={onCarCellEnter}
        onMouseLeave={onCarCellLeave}
        className="sticky left-0 border-r border-b px-2 overflow-hidden"
        style={{ zIndex: TL_Z.colCell, height: planH, width: carColW, minWidth: carColW, background: cellBg, borderRightColor: 'var(--tl-col-edge)', borderBottomColor: 'var(--tl-hairline-faint)' }}
        title={rowEvents.length ? undefined : cellTitle}
      >
        <div className="flex items-center justify-between gap-1.5 h-full">
          <span className="flex items-center gap-1.5 min-w-0">
            {detailed ? null : statusDot}
            <button
              type="button"
              onClick={() => onOpenCar(row.carKey)}
              title={rowEvents.length ? 'Обзор рейсов и периодов машины' : `${cellTitle}\n\nОбзор рейсов и периодов машины`}
              className={`text-[11px] leading-[13px] font-semibold truncate text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] rounded-sm ${rowHover ? 'text-[var(--accent-ink)]' : 'text-[var(--tl-text-strong)] hover:text-[var(--accent-ink)]'}`}
            >
              {formatPlate(row.carNumber)}
            </button>
            {/* Компактный вид: точка статуса перед номером, код направления после. */}
            {detailed ? null : statusChips(false)}
          </span>
          {detailed ? (
            <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tl-text-dim)] shrink-0 select-none">
              план
            </span>
          ) : (
            <span className="flex items-center gap-1 shrink-0">{alertIcons}</span>
          )}
        </div>
      </div>
      <div
        data-lane="plan"
        data-tl-car={row.carKey}
        onMouseEnter={onRowEnter}
        onMouseMove={onLaneMove}
        onMouseLeave={onLaneLeave}
        className={`relative ${detailed ? 'border-b border-[var(--tl-hairline-faint)]' : ''}`}
        style={{ width: W, height: planH, backgroundColor: laneRowBg, ...laneBg, ...laneTypeVars(planBandH) }}
      >
        {bgPlane('bg', 0.75)}
        {/* Полоса содержимого дорожки «План»: своя (естественная) высота
            planBandH, сдвинута вниз на planOffset — при увеличенной дорожке
            содержимое остаётся ПО ЦЕНТРУ, а не прижимается кверху; при дефолте
            (22) сдвиг 0 и полоса совпадает с дорожкой. Фон выходных и «сегодня»
            (строки ниже) — на всю высоту дорожки: это фон полотна, не содержимое. */}
        <div className="absolute left-0 right-0" style={{ top: planOffset, height: planBandContentH }}>
          {planBz.stripes.map((s) => renderBzStripe(s, 'pb', row.planOv, planSec, planBzObstacles))}
          {planBz.marks.map((m) => renderBzMark(m, 'pbm', planSec))}
          {planFills.map((f) => renderStageFill(f, 'pf', planSec, 'plan'))}
          {planRiskSegs.map((r) => renderRiskSegment(r))}
          {row.planItems.map((it, idx) => {
            if (it.kind === 'handover') return renderHandover(it, `ph${idx}`);
            const p = pos(it.a, it.b);
            if (!p) return null;
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
              // Подпись — ЕДИНОЕ правило (lib/barLabels): полный текст (маршрут +
              // « / План · N дней») → короткий (маршрут) → первое слово с многоточием;
              // подпись обтекает этапы и sticky в свободном сегменте (BarLabels sweep).
              const labelText = it.open ? 'неполный план' : `${it.parts.main}${it.parts.meta}`;
              const labelShort = it.open ? '' : it.parts.main;
              const chipOn = !!chip && pr.width >= 96;
              const chipCls = 'inline-flex items-center h-[12px] px-1 rounded-[4px] text-[8px] leading-[12px] font-semibold shrink-0';
              // Занятые зоны полосы: клетки этапов и метки строки + служебные
              // зоны краёв (бейдж «×N» и засечки кругов слева/по полосе, чип
              // направления справа) — подпись никогда не встаёт под метку.
              const obstacles: BarObstacle[] = [
                ...planLabelObstacles,
                ...planHandoverObstacles,
                ...circleMarksObstacles(it.circleMarks, pr.left),
                ...(chipOn ? [{ left: pr.left + pr.width - 36, right: pr.left + pr.width }] : []),
              ];
              // Перетаскивание/растягивание полосы (по правам): новые границы
              // уходят в запись-источник ТОЛЬКО через onPlanBoundsDrag с проверкой
              // периодов — здесь данные не пишутся.
              const canDrag = planBarDragEnabled(it.tripKey, !!it.archived);
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
                title: canDrag
                  ? `${it.title} · перетаскивание полосы/краёв — плановые даты (с проверкой периодов)`
                  : it.title,
                role: 'button',
                tabIndex: 0,
                cursor: true,
                onClick: () => planBarClick(it.tripKey),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTrip(it.tripKey);
                  }
                },
                onPointerDown: canDrag ? (e) => beginPlanDrag(e, it.tripKey, it.a, it.b, !!it.archived) : undefined,
                onMouseEnter: () => setHoverTrip(it.tripKey),
                onMouseLeave: () => setHoverTrip((v) => (v === it.tripKey ? null : v)),
                style: { ...link(it.tripKey), ...(canDrag ? { cursor: 'ew-resize' } : {}) },
                attrs: {
                  'data-trip': it.tripKey,
                  'data-dir': it.dir ? it.dir.name : undefined,
                  'data-plan-drag': canDrag ? '1' : undefined,
                  'data-bar-frac-a': adj && adj.fracA !== 0 ? `${adj.fracA}` : undefined,
                  'data-bar-frac-b': adj && adj.fracB !== 1 ? `${adj.fracB}` : undefined,
                  'data-overlap': adj?.overlap ? '1' : undefined,
                },
                pre: (
                  <>
                    {adj?.overlap ? (
                      <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                    ) : null}
                    {/* Место бейджа «×N» сохраняется в потоке полосы; сам бейдж
                        вынесен в слой меток (marksOverlay) — он остаётся поверх
                        клеток этапов. */}
                    {it.circleMarks?.badge ? <span aria-hidden="true" className="inline-flex shrink-0 w-[18px] h-[13px] ml-0.5" /> : null}
                  </>
                ),
                labelIcon: it.open ? <CircleDashed className={BAR_ICON_CLS} style={{ color: CLR.warn }} aria-hidden="true" /> : undefined,
                labelText,
                labelShort,
                obstacles,
                post: chipOn ? (
                  // Невидимый резерв ширины чипа в потоке полосы (сам чип — в слое меток).
                  <span aria-hidden="true" className={`${chipCls} ml-auto`} style={{ background: chip?.bg, border: `1px solid ${chip?.border}`, color: chip?.text, visibility: 'hidden' }}>
                    {it.dir?.code}
                  </span>
                ) : undefined,
                // МЕТКИ ПОВЕРХ ПОЛОСЫ (шкала TL_Z.mark): бейдж «×N»/засечки
                // кругов рейса и код направления видны и над клетками этапов.
                // Слои не перехватывают указатель: клик/наведение принадлежат
                // верхнему интерактивному элементу (этапу или самой полосе).
                // Цветное «ребро» направления у левого края полосы УБРАНО —
                // форма полосы цельная; направление видно кодом (CN/TR),
                // подсказкой и мини-чипом в колонке.
                marksOverlay: (
                  <>
                    {circleMarksLayer(it.circleMarks, `p${idx}`, pr.left)}
                    {/* Код направления — только когда есть место; при мелком масштабе
                        направление остаётся в подсказке и мини-чипе колонки. */}
                    {chipOn ? (
                      <div aria-hidden="true" className="absolute inset-0 flex items-center pointer-events-none" style={{ zIndex: TL_Z.mark }}>
                        <span
                          data-bar-dir-chip="1"
                          className={`${chipCls} ml-auto mr-px`}
                          style={{ background: chip?.bg, border: `1px solid ${chip?.border}`, color: chip?.text }}
                          title={`Направление: ${it.dir?.name}`}
                        >
                          {it.dir?.code}
                        </span>
                      </div>
                    ) : null}
                  </>
                ),
              });
            }
            return null;
          })}
          {/* Призрак перетаскивания плановой полосы: показывает будущие границы,
              данные не меняются (запись — только по подтверждённому сохранению). */}
          {dragPreview
            ? (() => {
                const dp = pos(dragPreview.a, dragPreview.b);
                if (!dp) return null;
                return (
                  <div
                    key="plan-drag-ghost"
                    data-ui="tl-plan-drag-ghost"
                    aria-hidden="true"
                    className="absolute pointer-events-none"
                    style={{
                      zIndex: TL_Z.mark,
                      left: dp.left,
                      width: Math.max(3, dp.width),
                      top: 1,
                      bottom: 1,
                      borderRadius: 'var(--tl-bar-r)',
                      border: '2px dashed var(--accent-solid)',
                      background: 'var(--accent-20)',
                    }}
                    title={`Перетаскивание: ${fmtDM(dragPreview.a)} – ${fmtDM(dragPreview.b)}`}
                  />
                );
              })()
            : null}
          {row.planOv.waitGaps.map((g) => renderWaitGap(g, 'pw'))}
        </div>
        {todayStrip('t', 0.1)}
        {/* Маркеры стыков и значки конфликтов центрируются по ВЫСОТЕ ДОРОЖКИ
            (planH) — стоят вне полосы содержимого и совпадают с её центром. */}
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
        onMouseEnter={onCarCellEnter}
        onMouseLeave={onCarCellLeave}
        className="sticky left-0 border-r border-b px-2 overflow-hidden"
        style={{ zIndex: TL_Z.colCell, height: factH, width: carColW, minWidth: carColW, background: cellBg, borderRightColor: 'var(--tl-col-edge)', borderBottomColor: 'var(--tl-hairline)' }}
        title={rowEvents.length ? undefined : cellTitle}
      >
        {detailed ? (
          <div className="flex items-center justify-between gap-1.5 h-full">
            <span className="flex items-center gap-1.5 min-w-0">
              {statusChips(true)}
              {row.empty ? (
                <span className="text-[9px] leading-[11px] text-[var(--tl-text-dim)] truncate">Нет рейсов в выбранном периоде</span>
              ) : null}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {alertIcons}
              <span className="text-[8px] leading-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--tl-text-dim)] select-none">факт</span>
            </span>
          </div>
        ) : null}
      </div>
      <div
        data-lane="fact"
        data-tl-car={row.carKey}
        onMouseEnter={onRowEnter}
        onMouseMove={onLaneMove}
        onMouseLeave={onLaneLeave}
        className={`relative border-b border-[var(--tl-hairline)] ${detailed ? '' : 'tl-compact-fact'}`}
        style={{ width: W, height: factH, backgroundColor: laneRowBg, ...laneBg, ...laneTypeVars(factBandH) }}
      >
        {bgPlane('fbg', 0.6)}
        {/* То же для подстроки «Факт»: содержимое — в полосе factBandH,
            сдвинутой вниз на factOffset (по центру увеличенной дорожки). */}
        <div className="absolute left-0 right-0" style={{ top: factOffset, height: factBandContentH }}>
          {factBz.stripes.map((s) =>
            s.kind === 'base-gap' && waitCovers(row.factOv.waitGaps, s)
              ? null
              : renderBzStripe(
                  s,
                  'fb',
                  row.factOv,
                  factSec,
                  factBzObstacles,
                  s.kind === 'base-fact' || (s.kind === 'repair' && !!s.periodKey && !bzEventDotKeys.has(s.periodKey)),
                ),
          )}
          {factBz.marks.map((m) => renderBzMark(m, 'fbm', factSec))}
          {/* Значки этапов в факте — только в «Подробно»: в компактном виде они
              уже стоят на полосе плана и окрашены по сроку. */}
          {detailed ? factFills.map((f) => renderStageFill(f, 'ff', factSec, 'fact')) : null}
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
                  // Компактный вид: линия без обводки — цвет дают участки статуса.
                  color: detailed
                    ? { bg: firstColor.bg, border: firstColor.border, text: firstColor.text }
                    : { bg: STATUS_LINE_COLORS.none.color, border: 'transparent', text: firstColor.text },
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
                      {detailed ? factSegEls(it.segments, prF.left, prF.width) : statusEls(it.status, prF.left, prF.width)}
                      {adjF?.overlap ? (
                        <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                      ) : null}
                    </>
                  ),
                  // Подпись — как у базы: маршрут на фоне первого сегмента; у
                  // нейтральной полосы — «План не указан» (зелёного без плана нет).
                  // Единая раскладка: полный текст → маршрут → многоточие, sticky
                  // в свободном сегменте полосы (обтекает этапы и метки кругов).
                  labelText: it.noPlan
                    ? 'Факт · план не указан'
                    : `${it.parts.main}${it.parts.meta}`,
                  labelShort: it.noPlan ? '' : it.parts.main,
                  obstacles: [...factLabelObstacles, ...circleMarksObstacles(it.circleMarks, prF.left)],
                  // Круги рейса на полосе ФАКТ: бейдж «×N» и засечки (по
                  // фактическим датам распределённых этапов).
                  marksOverlay: circleMarksLayer(it.circleMarks, `f${idx}`, prF.left),
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
                  pre: (
                    <>
                      {/* Компактный вид: плановое начало прошло, а факта нет — это
                          просрочка, красная со дня после планового начала до
                          сегодня; будущая часть остаётся серым пунктиром. */}
                      {!detailed && Math.min(today, it.b) > it.a
                        ? statusEls(
                            [
                              {
                                a: it.a + 1,
                                b: Math.min(today, it.b),
                                state: 'late',
                                reason: `Просрочка ${Math.min(today, it.b) - it.a} дн. · плановое начало ${fmtDM(it.a)} прошло, фактических данных нет`,
                              },
                            ],
                            prN.left,
                            prN.width,
                          )
                        : null}
                      {adjN?.overlap ? (
                        <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatch }} />
                      ) : null}
                    </>
                  ),
                  labelText: prN.width > 90 ? 'Факт не указан' : undefined,
                  obstacles: factLabelObstacles,
                });
              }
              case 'event': {
                // Компактный маркер события на РЕАЛЬНОЙ дате (не полоса): ромб —
                // одиночное событие, плашка со счётчиком — группа близких событий.
                // Стоит над дорожкой «факта рейса» — полосы не перекрывает текстом.
                const grouped = it.count > 1;
                const left = grouped
                  ? dayToX(it.day, vs, colW) + Math.round(colW * 0.45)
                  : dayToX(it.day, vs, colW) + Math.round(colW * 0.62);
                // zoneTop и zoneH — в координатах ПОЛОСЫ содержимого (band): дорожка
                // с общей высотой строк центрирует полосу целиком, поэтому метка
                // события остаётся по центру дорожки (см. factOffset), а не у верха.
                const zoneTop = factZone0 ? factZone0.top : FACT_PAD;
                const zoneH = factZone0 ? factZone0.h : FACT_NONE_H;
                const markerH = grouped ? 12 : 9;
                const top = Math.max(1, zoneTop + Math.max(0, Math.round((zoneH - markerH) / 2)));
                const evHeading = `${formatPlate(row.carNumber)} · ${grouped ? `события (${it.count})` : 'событие'}`;
                const evOpen = evCard && evCard.events.some((m) => it.items.some((x) => x.eventId === m.eventId));
                // Карточка с текстом заметок: наведение показывает, клик закрепляет.
                // Окно рейса открывается кнопкой в карточке, а не кликом по точке.
                const pinCard = (target: HTMLElement) => {
                  cancelEvShow();
                  cancelEvHide();
                  setEvCard({ pinned: true, anchor: rectAnchor(target.getBoundingClientRect()), events: it.items, heading: evHeading });
                };
                return (
                  <div
                    key={`e${idx}`}
                    role="button"
                    tabIndex={0}
                    aria-label={it.title}
                    data-bar="event"
                    data-event={it.eventId}
                    data-trip={it.tripKey}
                    onClick={(e) => {
                      e.stopPropagation();
                      pinCard(e.currentTarget);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pinCard(e.currentTarget);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (!eventHover) return;
                      showEvCard({ anchor: rectAnchor(e.currentTarget.getBoundingClientRect()), events: it.items, heading: evHeading }, 120);
                    }}
                    onMouseLeave={() => {
                      cancelEvShow();
                      scheduleEvHide();
                    }}
                    className="absolute cursor-pointer"
                    style={
                      grouped
                        ? { zIndex: TL_Z.mark, left, top, height: 12, minWidth: 16, padding: '0 3px', background: '#7C3AED', borderRadius: 6, textAlign: 'center', opacity: 0.95, ...(evOpen ? { boxShadow: '0 0 0 3px rgba(124,58,237,0.28)' } : {}) }
                        : { zIndex: TL_Z.mark, left, top, width: 9, height: 9, background: it.color, borderRadius: 2, transform: 'rotate(45deg)', opacity: 0.95, ...(evOpen ? { boxShadow: '0 0 0 3px rgba(124,58,237,0.28)' } : {}) }
                    }
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
        </div>
        {todayStrip('ft', 0.1)}
        {/* См. «План»: маркеры и значки конфликтов — по центру дорожки (factH). */}
        {row.factOv.warnings.map((w, wi) => renderConflict(w, 'fc', factH, wi))}
        {row.factOv.markers.map((m) => renderOvMarker(m, 'fm', factH))}
      </div>
      {evCard ? (
        <EventCard
          heading={evCard.heading}
          events={evCard.events}
          anchor={evCard.anchor}
          pinned={evCard.pinned}
          onClose={closeEvCard}
          onOpenEvent={(tripKey, eventId) => {
            closeEvCard();
            onOpenTripEvent(tripKey, eventId);
          }}
          onPointerEnter={cancelEvHide}
          onPointerLeave={scheduleEvHide}
        />
      ) : null}
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
  /** Клик по метке события на базе: открыть окно периода и подсветить событие. */
  onOpenBaseEvent,
  onOpenCar,
  dispatcherOrder,
  groupByDispatcher,
  carCurrentDispatcher,
  directions,
  fullscreen,
  onToggleFullscreen,
  onColumnHighlightChange,
  onPaintByDirectionChange,
  onAddDirection,
  onPlanBoundsDrag,
  canDragPlan = false,
  canDragManual = false,
}: Props) {
  const ve = vs + vn - 1;
  const colW = zoomColW(zoom);
  const W = vn * colW;
  /** Фильтр направлений: активные чипы (null — показаны все). Только видимость. */
  const [dirFilter, setDirFilter] = useState<string[] | null>(null);
  /**
   * Режим «Раскрасить по направлению»: цвет полосы рейса — приглушённый цвет
   * направления. Дефолт ВКЛЮЧЁН; значение — общий store настроек пользователя
   * (lib/timelinePrefs), запись в профиль — через onPaintByDirectionChange.
   */
  const paintByDirection = usePaintByDirection();
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
  /**
   * Высота строк машин: ОДНА настройка на все строки сразу (дорожка «План» и
   * дорожка «Факт» каждой машины), не по отдельности. Меняется двумя способами —
   * ручкой-разделителем под шапкой календаря и ползунком в панели инструментов;
   * значение — в localStorage под ключом ratipa_tl_rowh (по образцу ширины
   * колонки «Автомобили» выше). Ниже естественной высоты содержимого дорожка не
   * сжимается — это считает TimelineCarRow (band/offset).
   */
  /** «Подробно»: план и факт отдельными подстроками. По умолчанию — компактный
   *  вид (одна строка на машину, факт — тонкая линия статуса под планом). */
  const [detailed, setDetailed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DETAILED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [eventHover, setEventHover] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EVENT_HOVER_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const changeEventHover = useCallback((v: boolean) => {
    setEventHover(v);
    try {
      localStorage.setItem(EVENT_HOVER_STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* недоступное хранилище — выбор действует до перезагрузки */
    }
  }, []);
  const changeDetailed = useCallback((v: boolean) => {
    setDetailed(v);
    try {
      localStorage.setItem(DETAILED_STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* недоступное хранилище — выбор действует до перезагрузки */
    }
  }, []);
  const [rowHPref, setRowHPref] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(ROWH_STORAGE_KEY));
      return Number.isFinite(v) && v >= ROWH_MIN && v <= ROWH_MAX ? Math.round(v) : ROWH_DEFAULT;
    } catch {
      return ROWH_DEFAULT;
    }
  });
  /**
   * Текущее значение «сразу» (ref) — рядом с состоянием: запись по отпусканию
   * берёт именно его. Иначе отложенный апдейтер отпускания мог бы перезаписать
   * в localStorage результат двойного клика (сброс), пришедшего следом.
   */
  const rowHRef = useRef(rowHPref);
  /** Применение значения (обрезка по пределам): состояние + ref, без записи. */
  const applyRowH = useCallback((v: number) => {
    const n = Math.max(ROWH_MIN, Math.min(ROWH_MAX, Math.round(v)));
    rowHRef.current = n;
    setRowHPref(n);
  }, []);
  /** Запись настройки высоты строк: и ручка, и ползунок пишут в ОДИН ключ. */
  const persistRowH = useCallback((v: number) => {
    try {
      localStorage.setItem(ROWH_STORAGE_KEY, String(v));
    } catch {
      /* не критично */
    }
  }, []);
  /** Ползунок: применяем и сохраняем сразу (значение — базовая высота дорожки). */
  const onRowHSliderChange = useCallback(
    (v: number) => {
      applyRowH(v);
      persistRowH(rowHRef.current);
    },
    [applyRowH, persistRowH],
  );
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
  /**
   * Перетаскивание ручки ВЫСОТЫ СТРОК (все машины сразу): дельта указателя
   * отсчитывается от нажатия, вниз — выше строки, вверх — ниже (пределы
   * ROWH_MIN…ROWH_MAX). Запись в localStorage — по отпусканию, как у границы
   * колонки; сама ручка закреплена у шапки и за строками не двигается, поэтому
   * обратной связи «ручка убегает от курсора» нет.
   */
  const onRowHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = rowHPref;
      const move = (ev: PointerEvent) => {
        applyRowH(startH + (ev.clientY - startY));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.removeProperty('cursor');
        persistRowH(rowHRef.current);
      };
      document.body.style.cursor = 'row-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [rowHPref, applyRowH, persistRowH],
  );
  /** Двойной клик по ручке — высота по умолчанию (22 = прежний вид). */
  const onRowHandleReset = useCallback(() => {
    applyRowH(ROWH_DEFAULT);
    persistRowH(ROWH_DEFAULT);
  }, [applyRowH, persistRowH]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * Перекрёстная подсветка клетки дня (строка × столбец, бейдж дня в шапке,
   * плавающая метка даты) — один лёгкий механизм lib/useCrosshair, включена
   * по умолчанию, переключатель — в панели управления (настройка пользователя).
   */
  const columnHighlight = useColumnHighlight();
  const crossHostRef = useRef<HTMLDivElement | null>(null);
  useCrosshair({ scrollRef, hostRef: crossHostRef, enabled: columnHighlight, vs, vn, colW, carColW });
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
   * Подписи полос: движок «переезда» по свободным сегментам (lib/barLabels) —
   * точечные изменения DOM в rAF; полный пересчёт — после отрисовки строк и на
   * прокрутку/масштаб (добавление и удаление этапов меняет rows → пересчёт).
   */
  const labelSweepRaf = useRef(0);
  const scheduleLabelSweep = useCallback(() => {
    if (labelSweepRaf.current) return;
    labelSweepRaf.current = window.requestAnimationFrame(() => {
      labelSweepRaf.current = 0;
      sweepBarLabels(scrollRef.current, { carColW });
    });
  }, [carColW]);
  useLayoutEffect(() => {
    sweepBarLabels(scrollRef.current, { carColW });
  }, [rows, colW, vs, vn, carColW, showArchived]);
  useEffect(() => {
    window.addEventListener('resize', scheduleLabelSweep);
    return () => window.removeEventListener('resize', scheduleLabelSweep);
  }, [scheduleLabelSweep]);

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
    // Позиция ЧЕЛОВЕКА в порядке вкладок: у него может быть несколько id, берём
    // минимальную позицию среди его строк — тогда его машины идут подряд и дают
    // ровно один блок (иначе строки одного диспетчера разрывались чужим блоком).
    const personIdx = new Map<string, number>();
    rows.forEach((row) => {
      const key = row.groupPersonKey || row.groupDispatcherId || '';
      const i = idxOf(row);
      const prev = personIdx.get(key);
      if (prev == null || i < prev) personIdx.set(key, i);
    });
    const posOf = (row: CarRowModel): number => personIdx.get(row.groupPersonKey || row.groupDispatcherId || '') ?? idxOf(row);
    const sorted = [...rows].sort((a, b) => {
      const ai = posOf(a);
      const bi = posOf(b);
      if (ai !== bi) return ai - bi;
      const an = (a.groupDispatcherName || '').toLocaleLowerCase('ru');
      const bn = (b.groupDispatcherName || '').toLocaleLowerCase('ru');
      if (an !== bn) return an.localeCompare(bn, 'ru');
      return a.carNumber.localeCompare(b.carNumber, 'ru') || a.carKey.localeCompare(b.carKey);
    });
    const out: Array<{ key: string; name: string; rows: CarRowModel[] }> = [];
    sorted.forEach((row) => {
      // Блок — по человеку: два разных id одного диспетчера дают один блок.
      const key = row.groupPersonKey || row.groupDispatcherId || '';
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
    scheduleLabelSweep();
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
  }, [persistScroll, scheduleLabelSweep, colW, extL, extR, onRangeExtend]);

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
  const [legendAlignLeft, setLegendAlignLeft] = useState(false);
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

  /** Меню «Вид»: редкие настройки отображения (высота строк, архив, подсветка…). */
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: MouseEvent) => {
      if (viewRef.current?.contains(e.target as Node)) return;
      setViewOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setViewOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [viewOpen]);

  /** Точная высота липкой шапки (месяцы + дни) — столько же держат шапки групп. */
  const headH = colW >= 12 ? 48 : 42;

  /** Все обозначения — из ЕДИНОГО источника lib/legend: тот же список
   *  показывает вкладка «Справочник» интерактивного гайда, поэтому
   *  названия, цвета и значки не расходятся с дизайном полос. */
  const legendItems = buildLegendItems(directions);

  const legendSwatchCls = 'inline-flex items-center gap-0.5 w-[76px] shrink-0';
  const legendRowCls = 'flex items-center gap-2 min-w-0';

  return (
    <div className={`tl-scope flex flex-col flex-1 min-h-0`}>
      {/* Панель управления: спокойные сегменты — навигация, масштаб, вид и легенда.
          Боковые отступы — как у шапки раздела; от края до края идёт только сетка. */}
      <div className="flex flex-wrap items-center gap-2 px-6 sm:px-8 pb-3">
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
          <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--tl-text)] pl-0.5 pr-0.5">
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

        {/* Направления: мультивыбор чипами (только скрывает рейсы — данные не меняются). */}
        <div className={barSegment} data-ui="dir-filter" role="group" aria-label="Фильтр по направлениям">
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
        </div>

        {/* Справа: вид строк, меню «Вид», обозначения и полный экран — одна строка. */}
        <div className="flex items-center gap-2 ml-auto">
          <label
            className={`${navBtn} gap-1.5 select-none`}
            title="План и факт отдельными подстроками, со значками этапов в факте. Без галочки — одна строка на машину: полоса плана и линия статуса под ней"
          >
            <input
              type="checkbox"
              data-ui="detailed-view"
              checked={detailed}
              onChange={(e) => changeDetailed(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
            />
            Подробно
          </label>

          {/* Меню «Вид»: редкие настройки отображения — панель остаётся одной строкой. */}
          <div className="relative" ref={viewRef}>
            <button
              type="button"
              data-ui="view-menu-toggle"
              aria-expanded={viewOpen}
              aria-haspopup="dialog"
              onClick={() => setViewOpen((v) => !v)}
              title="Высота строк, раскраска, архив, подсветка столбца"
              className={navBtn}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="ml-1.5">Вид</span>
              <ChevronDown className="w-3 h-3 ml-1" aria-hidden="true" />
            </button>
            {viewOpen ? (
              <div
                data-ui="view-menu"
                role="dialog"
                aria-label="Настройки вида"
                className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-[var(--tl-hairline)] bg-white shadow-[0_16px_40px_rgba(18,19,22,0.14)] p-3.5 flex flex-col gap-3"
                style={{ zIndex: TL_Z.popup }}
              >
                {/* Высота строк машин: та же ОДНА настройка, что у ручки-разделителя
                    под шапкой календаря (все машины сразу). */}
                <div className="flex flex-col gap-1.5" role="group" aria-label="Высота строк машин" data-ui="rowh-control">
                  <div className="flex items-center justify-between text-[12px] text-[var(--tl-text-strong)]">
                    Высота строк
                    <span className="text-[11px] tabular-nums text-[var(--tl-text-dim)]">{rowHPref} px</span>
                  </div>
                  <input
                    type="range"
                    min={ROWH_MIN}
                    max={ROWH_MAX}
                    step={1}
                    value={rowHPref}
                    data-ui="rowh-slider"
                    aria-label="Высота строк машин"
                    title={`Высота строк машин: ${rowHPref}px (все строки сразу; двойной клик по разделителю под шапкой — ${ROWH_DEFAULT}px)`}
                    onChange={(e) => onRowHSliderChange(Number(e.target.value))}
                    className="w-full accent-[var(--accent)] cursor-pointer"
                  />
                </div>
                <div className="h-px bg-[var(--tl-hairline)]" aria-hidden="true" />
                <label className="flex items-center gap-2 text-[12px] text-[var(--tl-text-strong)] cursor-pointer select-none" title="Полосы рейсов окрашиваются в приглушённый цвет направления (данные не меняются)">
                  <input
                    type="checkbox"
                    data-ui="paint-by-direction"
                    checked={paintByDirection}
                    onChange={(e) => onPaintByDirectionChange(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
                  />
                  Раскрасить по направлению
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--tl-text-strong)] cursor-pointer select-none" title="Архивные рейсы плана дохода и архивные записи учёта выезда (база, ремонт)">
                  <input
                    type="checkbox"
                    data-ui="show-archived"
                    checked={showArchived}
                    onChange={(e) => onShowArchivedChange(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
                  />
                  Показывать архивные данные
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--tl-text-strong)] cursor-pointer select-none" title="При наведении подсвечиваются строка машины и столбец дня. Настройка сохраняется в вашем профиле">
                  <input
                    type="checkbox"
                    data-ui="column-highlight"
                    checked={columnHighlight}
                    onChange={(e) => onColumnHighlightChange(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
                  />
                  Подсветка столбца
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--tl-text-strong)] cursor-pointer select-none" title="Карточка с текстом заметок появляется при наведении на точку события или на номер машины. Клик по точке закрепляет карточку в любом случае">
                  <input
                    type="checkbox"
                    data-ui="event-hover"
                    checked={eventHover}
                    onChange={(e) => changeEventHover(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
                  />
                  Заметки при наведении
                </label>
                {onAddDirection ? (
                  <button
                    type="button"
                    data-ui="add-direction"
                    onClick={() => {
                      setViewOpen(false);
                      onAddDirection();
                    }}
                    title="Добавить вариант направления (название + короткий код, например LT)"
                    className="inline-flex items-center gap-1.5 self-start text-[12px] text-[var(--accent-ink)] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Добавить направление
                  </button>
                ) : null}
                <div className="h-px bg-[var(--tl-hairline)]" aria-hidden="true" />
                <span className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--tl-text-dim)]" data-ui="visible-range-wrap">
                  На экране:
                  <VisibleRangeLabel scrollRef={scrollRef} vs={vs} vn={vn} colW={colW} carColW={carColW} />
                </span>
              </div>
            ) : null}
          </div>

          <div className="relative" ref={legendRef}>
            <button
              type="button"
              data-ui="legend-toggle"
              aria-expanded={legendOpen}
              aria-haspopup="dialog"
              onClick={() => {
                // Попап открывается в ту сторону, где хватает места: панель
                // переносится, и кнопка бывает и у левого, и у правого края.
                const r = legendRef.current?.getBoundingClientRect();
                setLegendAlignLeft(!!r && r.left + 620 <= window.innerWidth - 8);
                setLegendOpen((v) => !v);
              }}
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
                className={`absolute ${legendAlignLeft ? 'left-0' : 'right-0'} top-full mt-2 w-[min(620px,92vw)] max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--tl-hairline)] bg-white shadow-[0_16px_40px_rgba(18,19,22,0.14)] p-4`}
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
                <ul className="mt-3 pt-2.5 border-t border-[var(--tl-hairline)] space-y-1 text-[10px] leading-[14px] text-[var(--tl-text-dim)]">
                  <li>Клик по полосе — окно рейса, по значку этапа — этап в окне рейса, по номеру машины — обзор её рейсов.</li>
                  <li>Без «Подробно» факт — тонкая линия под планом: зелёная — по плану, оранжевая — срок подходит, красная — период просрочки. С «Подробно» — отдельная строка.</li>
                  <li>Масштаб — ползунок или Ctrl+колесо; высота строк — ползунок «Строки» или разделитель под шапкой (двойной клик — сброс).</li>
                </ul>
              </div>
            ) : null}
          </div>

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
              Выйти
            </button>
          ) : (
            <button
              type="button"
              data-ui="fullscreen-enter"
              onClick={onToggleFullscreen}
              title="На весь экран"
              aria-label="На весь экран"
              className={navBtnIcon}
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Обёртка области календаря: сетка — ОДИН контейнер прокрутки, поверх —
          регулируемая граница колонки «Автомобили» (resize-handle). Сетка
          тянется по высоте (flex-1): внешней прокрутки страницы нет. На телефоне
          панели над сеткой занимают почти весь экран, поэтому сетка получает
          собственную высоту, а страница прокручивается до неё. */}
      <div className="relative flex-1 min-h-0 flex flex-col max-md:flex-none max-md:h-[75vh]">
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
        <div className="grid min-w-max relative" style={{ gridTemplateColumns: `${carColW}px ${W}px` }}>
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
                        // Без «зебры»: строки разделены тонкой линией, наведение подсвечивает строку.
                        zebra={false}
                        stageTypes={stageTypes}
                        selectedTripKey={selectedTripKey}
                        paintByDirection={paintByDirection}
                        onOpenTrip={onOpenTrip}
                        onOpenTripEvent={onOpenTripEvent}
                        onOpenTripStage={onOpenTripStage}
                        onOpenBase={onOpenBase}
                        onOpenBaseEvent={onOpenBaseEvent}
                        onOpenCar={onOpenCar}
                        onPlanBoundsDrag={onPlanBoundsDrag}
                        canDragPlan={canDragPlan}
                        canDragManual={canDragManual}
                        rowH={rowHPref}
                        detailed={detailed}
                        eventHover={eventHover}
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
          {/* Host перекрёстной подсветки: оверлей-столбец дня и полоса строки
              (lib/useCrosshair) — ПОД полосами/этапами, указатель не ловит. */}
          <div ref={crossHostRef} aria-hidden="true" className="pointer-events-none" style={{ position: 'absolute', inset: 0, zIndex: TL_Z.crosshair }} />
        </div>
      </div>
      {/* Регулировка высоты ВСЕХ строк машин (одна настройка, не по отдельности):
          полоска-разделитель толщиной 7 px по нижней границе липкой шапки
          календаря. Тянется вверх/вниз, двойной клик — по умолчанию; надёжно
          кликабельна — свой z-index (тот же, что у границы колонки) и полоса ПО
          ВЕРХУ шапки: интерактивных элементов на нижней кромке шапки нет. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Высота строк машин (двойной клик — по умолчанию)"
        data-ui="tl-rowh-resize"
        title={`Потяните вверх/вниз, чтобы изменить высоту ВСЕХ строк машин (сейчас ${rowHPref}px); двойной клик — по умолчанию (${ROWH_DEFAULT}px)`}
        onPointerDown={onRowHandleDown}
        onDoubleClick={onRowHandleReset}
        className="absolute left-0 right-0 h-[7px] cursor-row-resize group"
        style={{ zIndex: TL_Z.resizer, top: Math.max(0, headH - 7) }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 border-b-2 border-transparent group-hover:border-[var(--accent-40)]"
        />
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
