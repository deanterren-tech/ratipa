/**
 * МОДАЛЬНОЕ ОКНО ЦЕЛОГО РЕЙСА (ручного или связанного с «Планом дохода»).
 *
 * Внутри: основные сведения (авто, диспетчер, название/маршрут, статус, архив),
 * плановые и фактические границы со сравнением, плечи из плана дохода, таблица
 * этапов, ЕДИНЫЙ ЖУРНАЛ «События рейса» (добавление/правка/удаление событий
 * внутри карточки; отдельные поля «Комментарий к рейсу», «Причина», «Меры при
 * просрочке» и дублирующий блок «События машины за период рейса» убраны —
 * прежние тексты показаны в журнале с исходным контекстом) и встроенный
 * таймлайн этой машины с фокусом на выбранном рейсе.
 *
 * Плановые границы правятся ЗДЕСЬ и сохраняются в ту же запись «Плана дохода»
 * (существующий расчёт calculateTripFinances): это два интерфейса одних данных,
 * а не копии. У ручного рейса границы остаются в его собственной записи.
 * Фактические даты плановое редактирование не меняет, этапы автоматически не
 * сдвигаются — при расхождении показывается предупреждение.
 *
 * СОХРАНЕНИЕ — ОДНОЙ ОПЕРАЦИЕЙ: правки всех блоков копятся локально в черновике
 * окна и записываются единственной кнопкой «Сохранить» (или Enter/Ctrl+S) одним
 * атомарным multi-path update: поля рейса, плановые даты в «План дохода», круги,
 * запас, этапы (добавленные/изменённые/удалённые) и состояние плана этапов —
 * либо всё, либо ничего (см. dbService.saveTimelineWindowCommit). Промежуточных
 * «частей сохранено» нет. «Изменено» определяется СРАВНЕНИЕМ черновика с
 * последним сохранённым состоянием по всем блокам, а не флагом.
 *
 * Архивный статус связанного рейса меняется только в «Плане дохода»: здесь
 * пояснение и переход по прямой ссылке (в том числе для архивной записи).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CarFront,
  CalendarClock,
  ClipboardCopy,
  ExternalLink,
  EyeOff,
  Flag,
  LogIn,
  LogOut,
  Plus,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import type { LegPlan, TimelinePlanGuard, TimelinePlanHistoryEntry, TimelinePlanPermission, TimelinePlanRequest, TimelineStage, TimelineStageType, TimelineVehicleEvent, UserProfile } from '../../../types';
import { UI } from '../../../ui/kit';
import { ModalShell } from '../../../ui/components';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dbService } from '../../../api';
import { calculateTripFinances } from '../../../utils/financeCalculators';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import type { DispatcherOption } from './useTimelineData';
import { useWindowHotkeys } from './lib/useWindowHotkeys';
import DateInput from './DateInput';
import CityAutocomplete from '../../common/CityAutocomplete';
import TripEventsJournal from './TripEventsJournal';
import { PlanBarLabel, planBarLabelParts } from './PlanBarLabel';
import { FACT_SEGMENT_COLORS, factSegmentsOfTrip } from './lib/factSegments';
import { eventMarkOf, groupEventMarks, type EventMark } from './lib/eventMarks';
import { useCrosshair } from './lib/useCrosshair';
import { useColumnHighlight } from './lib/timelinePrefs';
// Z-шкала слоёв полотна — единый источник (lib/visuals): встроенный таймлайн
// использует те же слои, что основное полотно (этапы всегда поверх полос).
import { BAR_ICON_CLS, TL_Z, stageIconOf } from './lib/visuals';
// Единое правило долей ячейки дня (половины/трети событий) — общее с полотном.
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
  layoutStageFills,
  stageColorOf,
  stageFillTitle,
  stageNeighborLabel,
  stageShortName,
  type StageFillInput,
  type StageFillSection,
} from './lib/stageFills';
import { computePlanStageChanges, resolvePlanLock, type PlanStageChanges } from './lib/planLock';
import { normalizeCircles } from './lib/circles';
import { hasPlanFinancials } from './lib/planFromDraft';
import {
  WEEKEND_HINT,
  ZOOM_LEVELS,
  barRectInWindow,
  comparePlanFact,
  computeStoredRange,
  dayNum,
  dayStr,
  dayToX,
  fmtDM,
  fmtDev,
  fmtFull,
  getDeadlineStatus,
  hasWeekendInRange,
  isTripFactOngoing,
  isWeekendDay,
  layoutLaneTracks,
  stageDeviation,
  stageStateOf,
  TIMELINE_MINI_COL_W,
  tripFactEnd,
  tripSpan,
  zoomColW,
  zoomLabel,
  type LaneTrackItem,
} from './lib/timeline';
import CalendarHeader from './CalendarHeader';
import { eventTypeOf, stageFullName } from './lib/catalog';
import {
  type BasePeriod,
  type WholeTrip,
} from './lib/sources';
import {
  bzKindColor,
  bzStripeColor,
  layoutBzFills,
  type BzMark,
  type BzStripe,
} from './lib/bzFills';
import { tripRangeOf, vyezdStatusIcon } from './lib/vyezd';
import { resolveRowOverlaps, type RowOverlapResolution, type RowTripAdjust, type RowTripInterval } from './lib/overlapRow';
import type { ResolvedMarker, ResolvedWarning, WaitGap } from './lib/overlap';

const STATUS_TONE: Record<number, { dot: string; text: string }> = {
  3: { dot: 'bg-rose-500', text: 'text-rose-600 font-semibold' },
  2: { dot: 'bg-amber-500', text: 'text-amber-600 font-semibold' },
  1: { dot: 'bg-emerald-500', text: 'text-[#4B5563]' },
  0: { dot: 'bg-[#9CA3AF]', text: 'text-[#6B7280]' },
};

const isoOf = (day: number | null): string => (day == null ? '' : dayStr(day));
const money = (v?: number, cur = '€') => (v == null ? '—' : `${v.toLocaleString('ru-RU')} ${cur}`);

/** Подписи записей истории плана этапов. */
const PLAN_HISTORY_LABELS: Record<string, string> = {
  initial: 'первичное сохранение',
  update: 'изменение плана',
  'admin-update': 'изменение плана (администратор)',
  grant: 'разрешение выдано',
  revoke: 'разрешение отозвано',
};

interface Meta {
  reason: string;
  measures: string;
  comment: string;
}

interface Props {
  trip: WholeTrip;
  stageTypes: TimelineStageType[];
  dispatchers: DispatcherOption[];
  today: number;
  canWrite: boolean;
  /** Право на редактирование связанного плана дохода (как в самом модуле). */
  canEditPlan: boolean;
  /** Текущий пользователь — для записи событий журнала от его имени. */
  user: UserProfile;
  /** Прежние общие тексты рейса из tripTimeline/tripMeta (показываются в журнале). */
  meta: Meta;
  onSaveMeta: (key: string, patch: Partial<Meta>) => void;
  /** Переход с маркера события на таймлайне: id записи для журнала. */
  focusEventId?: string | null;
  onFocusEventDone?: () => void;
  /** Клик по заливке этапа на полотне: id этапа — выделить в таблице этапов. */
  focusStageId?: string | null;
  onFocusStageDone?: () => void;
  /** Клик по маркеру события другого рейса во встроенном таймлайне. */
  onOpenEventTrip?: (tripKey: string, eventId: string) => void;
  /** Клик по заливке базы/ремонта во встроенном таймлайне: открыть карточку периода. */
  onOpenBasePeriod?: (periodKey: string) => void;
  /** Состояние плана этапов рейса (tripTimeline/planGuard) — блокировка плановых дат. */
  planGuard?: TimelinePlanGuard | null;
  /** Действующие разовые разрешения рейса (tripTimeline/planPerms). */
  planPerms?: Record<string, TimelinePlanPermission>;
  /** Запросы разового доступа рейса (tripTimeline/planRequests/tripKey): статусы для кнопки запроса. */
  planRequests?: Record<string, TimelinePlanRequest>;
  /** Контроль плана этапов доступен только в облачном режиме. */
  planControlEnabled?: boolean;
  /** Рейсы, периоды и события этой же машины — контекст встроенного таймлайна. */
  carTrips: WholeTrip[];
  carBases: BasePeriod[];
  carEvents: TimelineVehicleEvent[];
  /** Города из существующего справочника расстояний портала — подсказки в «Месте» (свободный ввод). */
  cities: string[];
  onSelectTrip: (tripKey: string) => void;
  onOpenPlan: (planId: string) => void;
  onCopyPlanLink: (planId: string) => void;
  onArchiveToggle?: (trip: WholeTrip) => void;
  onDelete?: (trip: WholeTrip) => void;
  onClose: () => void;
}

interface Draft {
  route: string;
  dispatcherId: string;
  dispatcherName: string;
  bufferDays: string;
  stages: TimelineStage[];
  planStart: string;
  planEnd: string;
  /** Количество кругов рейса — целое от 1 (по умолчанию 1). */
  circles: number;
}

const toDraft = (t: WholeTrip): Draft => {
  const span = tripSpan(t);
  return {
    route: t.route || '',
    dispatcherId: t.dispatcherId || '',
    dispatcherName: t.dispatcherName || '',
    bufferDays: String(t.bufferDays ?? 0),
    stages: (t.stages || []).map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label || '',
      plannedDate: s.plannedDate || '',
      actualDate: s.actualDate || '',
      isCritical: !!s.isCritical,
      reason: s.reason || '',
      action: s.action || '',
      order: s.order ?? 0,
      circle: s.circle && s.circle >= 1 ? s.circle : undefined,
    })),
    planStart: isoOf(t.spanOverride?.pMin ?? span.pMin ?? null),
    planEnd: isoOf(t.spanOverride?.pMax ?? span.pMax ?? null),
    circles: normalizeCircles(t.circles),
  };
};

/**
 * Различия двух черновиков окна по блокам — «изменено» определяется
 * СРАВНЕНИЕМ, а не флагом: открытие окна, клики и возврат значения обратно
 * ложных срабатываний подтверждения не дают.
 */
const draftDiff = (a: Draft, b: Draft): string[] => {
  const out: string[] = [];
  if (a.route !== b.route) out.push('маршрут');
  if (a.dispatcherId !== b.dispatcherId) out.push('диспетчер');
  if (a.bufferDays !== b.bufferDays) out.push('запас дней');
  if (a.planStart !== b.planStart) out.push('плановый старт');
  if (a.planEnd !== b.planEnd) out.push('плановое возвращение');
  if (a.circles !== b.circles) out.push('количество кругов');
  if (a.stages.length !== b.stages.length || a.stages.some((s, i) => s.id !== b.stages[i].id)) {
    out.push('состав этапов');
  } else if (
    a.stages.some((s, i) => {
      const o = b.stages[i];
      return (
        s.label !== o.label ||
        s.plannedDate !== o.plannedDate ||
        s.actualDate !== o.actualDate ||
        s.type !== o.type ||
        (s.circle || 0) !== (o.circle || 0) ||
        !!s.isCritical !== !!o.isCritical
      );
    })
  ) {
    out.push('этапы');
  }
  return out;
};

/** Изменённые блоки окна: черновик против последнего сохранённого состояния. */
const changedBlocksOf = (d: Draft, m: Meta, base: { draft: Draft; meta: Meta }): string[] => {
  const out = draftDiff(d, base.draft);
  if (m.comment !== base.meta.comment) out.push('комментарий к рейсу');
  if (m.reason !== base.meta.reason) out.push('причина');
  if (m.measures !== base.meta.measures) out.push('меры');
  return out;
};

// ---------------------------------------------------------------------------
// Встроенный таймлайн выбранной машины (тот же календарь и те же правила)
// ---------------------------------------------------------------------------

const MINI_PLAN_H = 26;
const MINI_FACT_H = 32;
/** Зазор дорожек и высоты полос встроенного таймлайна (те же правила, что в основном). */
const MINI_TRACK_GAP = 2;
const MINI_PLAN_BAR_H = 16;
const MINI_FACT_BAR_H = 8;
const MINI_FACT_NONE_H = 14;

const hatchOpen = 'repeating-linear-gradient(45deg,#A7F3D0,#A7F3D0 5px,transparent 5px,transparent 10px)';
const hatchBuffer = 'repeating-linear-gradient(45deg,#FDE68A,#FDE68A 4px,transparent 4px,transparent 8px)';
/** Тонкая штриховка конфликта данных и нейтральная «Ожидание выезда» (как в основном). */
const conflictHatchMini = 'repeating-linear-gradient(45deg, rgba(190,18,60,0.30), rgba(190,18,60,0.30) 2px, transparent 2px, transparent 6px)';
const waitHatchMini = 'repeating-linear-gradient(45deg, rgba(100,116,139,0.22), rgba(100,116,139,0.22) 2px, transparent 2px, transparent 7px)';
/** Тона маркеров стыков (те же, что в основном таймлайне). */
const MARKER_TONE_MINI = {
  'early-departure': { fg: '#B45309', bg: '#FFF4DE', border: '#E3B04B' },
  departure: { fg: '#475569', bg: 'rgba(255,255,255,0.97)', border: '#CBD5E1' },
  arrival: { fg: '#0F6246', bg: 'rgba(255,255,255,0.97)', border: '#8FC9AE' },
} as const;

export function CarMiniTimeline({
  focusKey,
  carTrips,
  carBases,
  carEvents,
  stageTypes,
  today,
  highlightRange,
  onSelectTrip,
  onOpenEventTrip,
  onFocusStage,
  onOpenBasePeriod,
}: {
  /** Выбранный рейс (выделен и в центре открытия); null — обзор машины: позиция на «сегодня». */
  focusKey: string | null;
  carTrips: WholeTrip[];
  carBases: BasePeriod[];
  carEvents: TimelineVehicleEvent[];
  stageTypes: TimelineStageType[];
  today: number;
  /**
   * Выделенный диапазон (период «Учёта выезда» из окна периода): масштаб и
   * позиция подбираются под него, диапазон подсвечивается мягкой полосой с
   * акцентными границами. Не задан — поведение прежнее (рейс или «сегодня»).
   */
  highlightRange?: { a: number; b: number } | null;
  onSelectTrip: (tripKey: string) => void;
  /** Клик по маркеру события связанного рейса — открыть рейс и показать запись. */
  onOpenEventTrip?: (tripKey: string, eventId: string) => void;
  /** Клик по маркеру этапа — переход и подсветка этапа в верхнем блоке окна. */
  onFocusStage?: (stageId: string) => void;
  /** Клик по заливке базы/ремонта — открыть карточку периода «Учёта выезда». */
  onOpenBasePeriod?: (periodKey: string) => void;
}) {
  const focus = carTrips.find((t) => t.key === focusKey) || null;
  const focusSpan = focus ? tripSpan(focus) : null;
  // Начальный видимый диапазон — объединение ПЛАНА и ФАКТА выбранного рейса
  // с небольшим запасом по краям (а не «сегодня»): архивный рейс открывается
  // на своих реальных датах, факт за плановой границей не обрезается.
  // Выделенный диапазон периода (окно «Учёта выезда») перекрывает оба варианта.
  // Без выбранного рейса (обзор машины) — позиция на сегодняшней дате.
  const hlA = highlightRange?.a ?? null;
  const hlB = highlightRange?.b ?? null;
  const hasHighlight = hlA != null && hlB != null;
  const planA = focus?.spanOverride?.pMin ?? focusSpan?.pMin ?? null;
  const planB = focus?.spanOverride?.pMax ?? focusSpan?.pMax ?? null;
  const factA = focusSpan?.fMin ?? null;
  const factB = focusSpan?.fMax ?? null;
  const starts = [planA, factA, hlA].filter((v): v is number => v != null);
  const ends = [planB, factB, hlB].filter((v): v is number => v != null);
  const anchorStart = starts.length ? Math.min(...starts) : today;
  const anchorEnd = ends.length ? Math.max(...ends, anchorStart) : anchorStart;
  const spanDays = Math.max(1, anchorEnd - anchorStart + 1);
  /** Масштаб, при котором весь период рейса (± неделя запаса) виден целиком. */
  const fitZoom = useCallback((): number => {
    const avail = Math.max(280, Math.min(1360, window.innerWidth * 0.9) - TIMELINE_MINI_COL_W - 90);
    const need = spanDays + 14;
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
      if (need * ZOOM_LEVELS[i] <= avail) return i;
    }
    return 0;
  }, [spanDays]);
  // Масштаб встроенного таймлайна — НЕЗАВИСИМОЕ состояние: его прокрутка и
  // масштаб не двигают основной таймлайн.
  const [miniZoom, setMiniZoom] = useState<number>(() => fitZoom());
  const colW = zoomColW(miniZoom);
  const initialStart = focus || hasHighlight ? anchorStart - 7 : anchorStart - 10;
  const initialVn = Math.max(30, anchorEnd + 7 - initialStart + 1);
  const [vs, setVs] = useState(initialStart);
  const [vn, setVn] = useState(initialVn);
  const [extL, setExtL] = useState(0);
  const [extR, setExtR] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * Перекрёстная подсветка столбца дня во встроенном таймлайне — ТОТ ЖЕ
   * механизм, что на основном полотне (lib/useCrosshair), флаг — из настроек
   * пользователя (lib/timelinePrefs, переключатель в панели полотна).
   */
  const columnHighlight = useColumnHighlight();
  const crossHostRef = useRef<HTMLDivElement | null>(null);
  const prevExtL = useRef(0);
  const prevColW = useRef(colW);
  const pendingAnchor = useRef<{ day: number; frac: number } | null>(null);
  const lastExtend = useRef(0);
  const didInit = useRef(false);

  const renderVs = vs - extL;
  const renderVn = vn + extL + extR;
  const ve = renderVs + renderVn - 1;
  const W = renderVn * colW;
  useCrosshair({ scrollRef, hostRef: crossHostRef, enabled: columnHighlight, vs: renderVs, vn: renderVn, colW, carColW: TIMELINE_MINI_COL_W });
  /** Та же единая функция «дата → координата», что в основном таймлайне. */
  const pos = (a: number, b: number) => barRectInWindow(a, b, renderVs, ve, colW);

  // Позиция прокрутки — по календарной дате-якорю (frac — доля видимой области
  // правее колонки 96px). Та же логика, что у основного таймлайна.
  const applyAnchor = useCallback(
    (day: number, frac: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const calW = Math.max(1, el.clientWidth - TIMELINE_MINI_COL_W);
      const target = (day - renderVs) * colW - frac * calW;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      if (target > max + 1) {
        pendingAnchor.current = { day, frac };
        lastExtend.current = 0;
        el.scrollLeft = max;
        return;
      }
      if (target < -1) {
        // Дата левее загруженного диапазона: запоминаем якорь, догрузка слева
        // расширит окно (scrollLeft = 0 инициирует шаг расширения), затем якорь
        // будет доведён точно — позиция не теряется.
        pendingAnchor.current = { day, frac };
        lastExtend.current = 0;
        el.scrollLeft = 0;
        return;
      }
      pendingAnchor.current = null;
      el.scrollLeft = Math.max(0, target);
    },
    [renderVs, colW],
  );

  const dayAtMiniCenter = useCallback(
    (): { day: number; frac: number } => {
      const el = scrollRef.current;
      const calW = el ? Math.max(1, el.clientWidth - TIMELINE_MINI_COL_W) : 1;
      return {
        day: el ? renderVs + Math.floor((el.scrollLeft + TIMELINE_MINI_COL_W + calW / 2 - TIMELINE_MINI_COL_W) / colW) : anchorStart,
        frac: 0.5,
      };
    },
    [renderVs, colW, anchorStart],
  );

  // При открытии окна: масштаб подобран под рейс или выделенный период (fitZoom),
  // позиция — их начало; без выбранного рейса (обзор машины) — на сегодняшней дате.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInit.current) return;
    didInit.current = true;
    if (focus || hasHighlight) applyAnchor(anchorStart, 0);
    else applyAnchor(today, 0.35);
    lastExtend.current = Date.now() + 600;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Смена масштаба встроенного таймлайна: дата-якорь остаётся на месте.
  useLayoutEffect(() => {
    if (prevColW.current === colW) return;
    prevColW.current = colW;
    const anchor = pendingAnchor.current ?? dayAtMiniCenter();
    pendingAnchor.current = null;
    lastExtend.current = 0;
    applyAnchor(anchor.day, anchor.frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colW]);

  useLayoutEffect(() => {
    if (!pendingAnchor.current) return;
    applyAnchor(pendingAnchor.current.day, pendingAnchor.current.frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extL, extR, vn]);

  // Догрузка влево: компенсация до отрисовки кадра — видимая дата не смещается.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = extL - prevExtL.current;
    prevExtL.current = extL;
    if (d > 0) el.scrollLeft += d * colW;
  }, [extL, colW]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (now < lastExtend.current) return;
    // Порционное расширение окна дней влево/вправо — вплоть до всей хронологии
    // машины (те же рамки, что у основного таймлайна). Данные по машине уже
    // загружены полностью; расширяется только окно отрисовки.
    if (el.scrollLeft < colW * 2 && extL < 400) {
      lastExtend.current = now + 250;
      setExtL((v) => v + 30);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - colW * 2 && extR < 400) {
      lastExtend.current = now + 250;
      setExtR((v) => v + 30);
    }
  }, [extL, extR, colW]);

  /**
   * Переход к произвольной дате: если день вне загруженного окна — сначала
   * расширяем нужную сторону (якорь запоминается и доводится после расширения),
   * иначе прокручиваем сразу. Позиция/масштаб — только вид; данные не фильтруются.
   */
  const jumpTo = useCallback(
    (day: number, frac = 0) => {
      if (day < renderVs) {
        pendingAnchor.current = { day, frac };
        lastExtend.current = Date.now() + 600;
        setExtL((v) => Math.min(400, v + (renderVs - day) + 14));
        return;
      }
      if (day > ve) {
        pendingAnchor.current = { day, frac };
        lastExtend.current = Date.now() + 600;
        setExtR((v) => Math.min(400, v + (day - ve) + 14));
        return;
      }
      applyAnchor(day, frac);
    },
    [renderVs, ve, applyAnchor],
  );
  const goToday = useCallback(() => {
    jumpTo(today, 0.35);
  }, [jumpTo, today]);
  const [jumpDate, setJumpDate] = useState<string>(() => dayStr(today));

  /** «Показать рейс целиком»: масштаб под полный период (план + факт) и позиция
   *  от начала рейса — независимо от основного таймлайна. */
  const showWholeTrip = useCallback(() => {
    setExtL(0);
    setExtR(0);
    setVs(initialStart);
    setVn(initialVn);
    lastExtend.current = Date.now() + 600;
    const z = fitZoom();
    pendingAnchor.current = { day: anchorStart, frac: 0 };
    if (z !== miniZoom) {
      setMiniZoom(z);
    } else {
      window.requestAnimationFrame(() => applyAnchor(anchorStart, 0));
    }
  }, [fitZoom, miniZoom, anchorStart, initialStart, initialVn, applyAnchor]);

  const setMiniZoomAt = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next));
      if (clamped === miniZoom) return;
      pendingAnchor.current = dayAtMiniCenter();
      setMiniZoom(clamped);
    },
    [miniZoom, dayAtMiniCenter],
  );

  // Фон дорожек мини-таймлайна: выходные + мягкая подсветка всего столбца
  // «сегодня» (та же логика и вид, что в основном таймлайне; если сегодня вне
  // видимого окна — подсветки нет и прокрутка не выполняется).
  const bgSegs = useMemo(() => {
    const segs: Array<{ left: number; width: number; today: boolean }> = [];
    for (let d = renderVs; d <= ve; d += 1) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) segs.push({ left: Math.round((d - renderVs) * colW), width: colW, today: false });
      if (d === today) segs.push({ left: Math.round((d - renderVs) * colW), width: Math.round(colW), today: true });
    }
    return segs;
  }, [renderVs, ve, colW, today]);

  const link = (key: string): React.CSSProperties =>
    key === focusKey ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : { opacity: 0.85 };

  /**
   * Дорожки встроенного таймлайна — те же правила, что в основном:
   * группа 0 — рейсы (план/факт). База, ремонт и готовность — заливки дня
   * (layoutBzFills, один механизм с основным таймлайном). Пересекающиеся
   * полосы одной группы разводятся на под-дорожки; горизонтальные координаты
   * не меняются — только вертикальные дорожки.
   */
  const miniPlanTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const tripSlot = new Map<string, number>();
    const bufferSlot = new Map<string, number>();
    carTrips.forEach((t) => {
      const ov = t.spanOverride || {};
      const sp = tripSpan(t);
      const a = ov.pMin ?? sp.pMin ?? null;
      if (a == null) return;
      const b = ov.pMax ?? sp.pMax ?? a;
      items.push({ group: 0, a, b, h: MINI_PLAN_BAR_H });
      tripSlot.set(t.key, items.length - 1);
      if (t.kind === 'manual' && t.bufferDays) {
        const pmax = ov.pMax ?? sp.pMax ?? null;
        if (pmax != null) {
          items.push({ group: 0, a: pmax + 1, b: pmax + t.bufferDays, h: MINI_PLAN_BAR_H });
          bufferSlot.set(t.key, items.length - 1);
        }
      }
    });
    return { layout: layoutLaneTracks(items, { padTop: 5, padBottom: 5, gap: MINI_TRACK_GAP }), tripSlot, bufferSlot };
  }, [carTrips]);
  const miniPlanH = Math.max(MINI_PLAN_H, miniPlanTrack.layout.laneH);

  const miniFactTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const factSlot = new Map<string, number>();
    const factNoneSlot = new Map<string, number>();
    carTrips.forEach((t) => {
      const sp = tripSpan(t);
      if (sp.fMin != null) {
        const endDay = tripFactEnd(t);
        const ongoing = endDay == null && !t.archived;
        const fEnd = ongoing ? Math.max(today, sp.fMax ?? sp.fMin) : (endDay ?? sp.fMax ?? sp.fMin);
        items.push({ group: 0, a: sp.fMin, b: fEnd, h: MINI_FACT_BAR_H });
        factSlot.set(t.key, items.length - 1);
      } else {
        const ov = t.spanOverride || {};
        const a = ov.pMin ?? sp.pMin;
        if (a == null) return;
        const b = ov.pMax ?? sp.pMax ?? a;
        items.push({ group: 0, a, b, h: MINI_FACT_NONE_H });
        factNoneSlot.set(t.key, items.length - 1);
      }
    });
    return {
      layout: layoutLaneTracks(items, { padTop: 3, padBottom: 3, gap: MINI_TRACK_GAP }),
      factSlot,
      factNoneSlot,
    };
  }, [carTrips, today]);
  const miniFactH = Math.max(MINI_FACT_H, miniFactTrack.layout.laneH);
  const miniFactZone0 = miniFactTrack.layout.zones.find((z) => z.key === 0) ?? null;

  // Заливки этапов и полосы базы/ремонта (та же модель отображения, что в
  // основном таймлайне): план — в подстроке «План», факт — в «Факт»; клик
  // выделяет этап в таблице. База и ремонт — непрерывные полосы периода;
  // готовность и окончание ремонта — отметки на всю ячейку дня.
  const miniTripRanges = useMemo(
    () => carTrips.map((t) => tripRangeOf(t)).filter((r): r is NonNullable<typeof r> => !!r),
    [carTrips],
  );
  const miniBzInputs = useMemo(
    () => carBases.map((p) => ({ period: p, tripRanges: miniTripRanges })),
    [carBases, miniTripRanges],
  );
  const miniPlanBz = useMemo(
    () => layoutBzFills(miniBzInputs, [], 'plan', renderVs, ve, today),
    [miniBzInputs, renderVs, ve, today],
  );
  const miniFactBz = useMemo(
    () => layoutBzFills(miniBzInputs, [], 'fact', renderVs, ve, today),
    [miniBzInputs, renderVs, ve, today],
  );
  // ── Разрешение наложений (та же единая функция, что в основном таймлайне):
  // план и факт отдельно; результата достаточно для срезов дня смены,
  // укорочения простоя, «Ожидания выезда», маркеров и конфликтов. ──
  const miniCarLabel = carTrips[0] ? formatPlate(carTrips[0].carNumber) : '';
  const miniPlanInts = useMemo<RowTripInterval[]>(
    () =>
      carTrips
        .map((t) => {
          const ov = t.spanOverride || {};
          const sp = tripSpan(t);
          const a = ov.pMin ?? sp.pMin ?? null;
          if (a == null) return null;
          const b = ov.pMax ?? sp.pMax ?? a;
          return {
            key: t.key,
            a,
            b,
            open: t.openPlan === true || (ov.pMax ?? sp.pMax) == null,
            label: `Рейс «${t.route || 'без маршрута'}»`,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [carTrips],
  );
  const miniFactInts = useMemo<RowTripInterval[]>(
    () =>
      carTrips
        .map((t) => {
          const sp = tripSpan(t);
          const ov = t.spanOverride || {};
          if (sp.fMin != null) {
            const endDay = tripFactEnd(t);
            const ongoing = endDay == null && !t.archived;
            const fEnd = ongoing ? Math.max(today, sp.fMax ?? sp.fMin) : (endDay ?? sp.fMax ?? sp.fMin);
            return { key: t.key, a: sp.fMin, b: fEnd, open: ongoing, label: `Рейс «${t.route || 'без маршрута'}»` };
          }
          const a = ov.pMin ?? sp.pMin;
          if (a == null) return null;
          const b = ov.pMax ?? sp.pMax ?? a;
          return { key: t.key, a, b, open: t.openPlan === true || (ov.pMax ?? sp.pMax) == null, label: `Рейс «${t.route || 'без маршрута'}»` };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [carTrips, today],
  );
  const miniPlanOv = useMemo(
    () => resolveRowOverlaps(carBases, miniPlanInts, 'plan', today, fmtDM, miniCarLabel),
    [carBases, miniPlanInts, today, miniCarLabel],
  );
  const miniFactOv = useMemo(
    () => resolveRowOverlaps(carBases, miniFactInts, 'fact', today, fmtDM, miniCarLabel),
    [carBases, miniFactInts, today, miniCarLabel],
  );
  const miniFillInputs = useMemo<StageFillInput[]>(
    () => carTrips.flatMap((t) => (t.stages || []).map((s) => ({ tripKey: t.key, stage: s, archived: !!t.archived }))),
    [carTrips],
  );
  /**
   * Доли ячейки дня встроенного таймлайна — ТА ЖЕ единая функция, что на
   * основном полотне (lib/dayCellSections): слева предыдущее событие, справа
   * следующее, якоря дня смены — из тех же разрешений наложений.
   */
  const miniStageLabelOf = useCallback((it: StageFillInput) => stageNeighborLabel(stageTypes, it.stage), [stageTypes]);
  const miniPlanStripeInputs = useMemo<RowStripeInput[]>(
    () =>
      miniPlanBz.stripes.map((s) => {
        const vis = visibleStripeBounds(s, miniPlanOv);
        return { kind: s.kind, a: vis.a, b: vis.b, fracA: vis.fracA, fracB: vis.fracB, periodKey: s.periodKey, label: s.label };
      }),
    [miniPlanBz.stripes, miniPlanOv],
  );
  const miniFactStripeInputs = useMemo<RowStripeInput[]>(
    () =>
      miniFactBz.stripes.map((s) => {
        const vis = visibleStripeBounds(s, miniFactOv);
        return { kind: s.kind, a: vis.a, b: vis.b, fracA: vis.fracA, fracB: vis.fracB, periodKey: s.periodKey, label: s.label };
      }),
    [miniFactBz.stripes, miniFactOv],
  );
  const miniPlanTripSides = useMemo(
    () => tripSidesOf(miniPlanInts.map((it) => ({ tripKey: it.key, a: it.a, b: it.b })), miniPlanOv),
    [miniPlanInts, miniPlanOv],
  );
  const miniFactTripSides = useMemo(
    () => tripSidesOf(miniFactInts.map((it) => ({ tripKey: it.key, a: it.a, b: it.b })), miniFactOv),
    [miniFactInts, miniFactOv],
  );
  const miniPlanSec = useMemo(
    () =>
      buildRowDaySections({
        kind: 'plan',
        vs: renderVs,
        ve,
        stages: miniFillInputs,
        stageLabelOf: miniStageLabelOf,
        stripes: miniPlanStripeInputs,
        marks: miniPlanBz.marks,
        tripSides: miniPlanTripSides,
      }),
    [renderVs, ve, miniFillInputs, miniStageLabelOf, miniPlanStripeInputs, miniPlanBz.marks, miniPlanTripSides],
  );
  const miniFactSec = useMemo(
    () =>
      buildRowDaySections({
        kind: 'fact',
        vs: renderVs,
        ve,
        stages: miniFillInputs,
        stageLabelOf: miniStageLabelOf,
        stripes: miniFactStripeInputs,
        marks: miniFactBz.marks,
        tripSides: miniFactTripSides,
      }),
    [renderVs, ve, miniFillInputs, miniStageLabelOf, miniFactStripeInputs, miniFactBz.marks, miniFactTripSides],
  );
  const miniPlanFills = useMemo(
    () => layoutStageFills(miniFillInputs, 'plan', renderVs, ve, miniPlanSec.slotForStage),
    [miniFillInputs, renderVs, ve, miniPlanSec],
  );
  const miniFactFills = useMemo(
    () => layoutStageFills(miniFillInputs, 'fact', renderVs, ve, miniFactSec.slotForStage),
    [miniFillInputs, renderVs, ve, miniFactSec],
  );
  const renderMiniFill = (f: StageFillSection, keyPrefix: string, sec: RowDaySections) => {
    const color = stageColorOf(f.stage.type);
    const left = dayToX(f.day, renderVs, colW) + Math.round((f.section * colW) / f.sections);
    const right = dayToX(f.day, renderVs, colW) + Math.round(((f.section + 1) * colW) / f.sections);
    const width = Math.max(1, right - left);
    const clickable = !!onFocusStage;
    const open = clickable ? () => onFocusStage?.(f.stage.id) : undefined;
    const radius = `${f.section === 0 ? '4px' : '0px'} ${f.section === f.sections - 1 ? '4px' : '0px'} ${
      f.section === f.sections - 1 ? '4px' : '0px'
    } ${f.section === 0 ? '4px' : '0px'}`;
    const MiniStageIcon = stageIconOf(f.stage.type);
    const neighborMini = sec.neighborsOf(f.day, [stageMergeKeyOf(f.tripKey, f.stage.id)]);
    return (
      <div
        key={`${keyPrefix}-${f.tripKey}-${f.stage.id}-${f.day}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        data-stage-fill="1"
        data-stage={clickable ? f.stage.id : undefined}
        data-trip={f.tripKey}
        onClick={open}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onFocusStage?.(f.stage.id);
                }
              }
            : undefined
        }
        className={`absolute top-0 bottom-0 overflow-hidden whitespace-nowrap flex items-center justify-center px-0.5 ${clickable ? 'cursor-pointer' : ''}`}
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
        title={`${stageFillTitle(stageTypes, f.stage, f.day, today)}${neighborMini ? `\n${neighborMini}` : ''}${clickable ? '' : ' · (только просмотр)'}`}
      >
        {width >= 40 ? (
          <span className="inline-flex items-center gap-0.5 min-w-0 max-w-full">
            <MiniStageIcon className={BAR_ICON_CLS} style={{ color: color.text }} aria-hidden="true" />
            <span className="text-[8px] leading-[10px] truncate">{stageShortName(stageTypes, f.stage)}</span>
          </span>
        ) : width >= 10 ? (
          <MiniStageIcon className={BAR_ICON_CLS} style={{ color: color.text }} aria-hidden="true" />
        ) : null}
      </div>
    );
  };
  /**
   * Непрерывная полоса периода (один элемент на период) — та же модель, что в
   * основном таймлайне: на всю высоту подстроки, скругление только на реальных
   * концах, «продолжающийся» край — обрыв с мягким градиентом.
   */
  const renderMiniBzStripe = (s: BzStripe, keyPrefix: string, ov: RowOverlapResolution, sec: RowDaySections) => {
    const color = bzStripeColor(s);
    // Те же правила разрешения наложений, что в основном таймлайне.
    const adj =
      (s.kind === 'base-plan' || s.kind === 'base-fact') && s.periodKey ? ov.baseAdjust.get(s.periodKey) : undefined;
    const srcA = adj ? adj.a : s.a;
    const srcB = adj ? adj.b : s.b;
    const baseFracA = adj ? adj.fracA : 0;
    const baseFracB = adj ? adj.fracB : 1;
    const clipA = Math.max(srcA, renderVs);
    const clipB = Math.min(srcB, ve);
    // Край полосы на границе доли дня — та же единая раскладка, что на полотне.
    const mk = periodMergeKey(s.periodKey, srcA, srcB);
    const slotA = clipA === srcA ? sec.slotForPeriod(clipA, mk) : null;
    const slotB = clipB === srcB ? sec.slotForPeriod(clipB, mk) : null;
    const fracA = slotA ? Math.max(baseFracA, slotA.left) : baseFracA;
    const fracB = slotB ? Math.min(baseFracB, slotB.right) : baseFracB;
    const neighborMini = sec.neighborsOf(slotA ? clipA : slotB ? clipB : clipA, [mk]);
    const left = dayToX(clipA, renderVs, colW) + Math.round(fracA * colW);
    const right = dayToX(clipB, renderVs, colW) + Math.round(colW * fracB);
    const width = Math.max(1, right - left);
    const r = 'var(--tl-bar-r)';
    const roundL = s.edgeL === 'round' && fracA === 0;
    const roundR = s.edgeR === 'round' && fracB === 1;
    const radius = `${roundL ? r : '0px'} ${roundR ? r : '0px'} ${roundR ? r : '0px'} ${roundL ? r : '0px'}`;
    const fadePx = 18;
    const fadeL = s.edgeL !== 'round' && fracA === 0;
    const fadeR = s.edgeR !== 'round' && fracB === 1;
    const mask = fadeL
      ? fadeR
        ? `linear-gradient(to right, transparent 0, #000 ${fadePx}px, #000 calc(100% - ${fadePx}px), transparent 100%)`
        : `linear-gradient(to right, transparent 0, #000 ${fadePx}px)`
      : fadeR
        ? `linear-gradient(to right, #000 calc(100% - ${fadePx}px), transparent 100%)`
        : undefined;
    const clickable = !!(s.periodKey && onOpenBasePeriod);
    const open = clickable && s.periodKey ? () => onOpenBasePeriod?.(s.periodKey as string) : undefined;
    // «Учёт выезда»: подпись и иконка статуса, цвет полосы задан статусом.
    const isVyezd = s.kind === 'base-fact';
    const StatusIcon = isVyezd && s.status ? vyezdStatusIcon(s.status) : null;
    const showLabel = width >= (isVyezd ? 58 : 40);
    const labelText =
      (s.kind === 'repair' || isVyezd) && width >= 128 && s.dateLabel ? `${s.label} · ${s.dateLabel}` : s.label;
    const labelEl = showLabel ? (
      <span
        data-bz-label="1"
        className={`inline-flex items-center gap-0.5 max-w-full truncate px-1 text-[8px] leading-[10px] font-semibold ${
          s.stickyLabel ? 'sticky' : 'absolute left-1 top-1/2 -translate-y-1/2'
        }`}
        style={{ ...(s.stickyLabel ? { left: 104 } : {}), background: color.bg, color: color.text, borderRadius: 4 }}
      >
        {StatusIcon ? <StatusIcon className="w-2.5 h-2.5 shrink-0" style={{ color: color.text }} aria-hidden="true" /> : null}
        {labelText}
      </span>
    ) : isVyezd && StatusIcon && width >= 16 ? (
      <span data-bz-label="icon" className="w-full h-full flex items-center justify-center" aria-hidden="true">
        <StatusIcon className="w-3 h-3 shrink-0" style={{ color: color.text }} />
      </span>
    ) : null;
    return (
      <div
        key={`${keyPrefix}-${s.kind}-${s.periodKey || 'gap'}-${s.a}-${s.b}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        data-bz-stripe={s.kind}
        data-bz-status={s.status || undefined}
        data-bz-a={s.a}
        data-bz-b={s.b}
        data-bz-edge-l={s.edgeL}
        data-bz-edge-r={s.edgeR}
        data-bz-frac-a={adj && fracA !== 0 ? `${fracA}` : undefined}
        data-bz-frac-b={adj && fracB !== 1 ? `${fracB}` : undefined}
        data-bz-trunc={adj && adj.truncatedDays > 0 ? `${adj.truncatedDays}` : undefined}
        data-period={s.periodKey || undefined}
        onClick={open}
        onKeyDown={
          clickable && s.periodKey
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenBasePeriod?.(s.periodKey as string);
                }
              }
            : undefined
        }
        className={`absolute whitespace-nowrap flex items-center ${clickable ? 'cursor-pointer' : ''}`}
        style={{
          zIndex: TL_Z.bz,
          left,
          width,
          top: s.lanes > 1 ? `calc(${(s.lane * 100) / s.lanes}% + 1px)` : 0,
          height: s.lanes > 1 ? `calc(${100 / s.lanes}% - 2px)` : undefined,
          bottom: s.lanes > 1 ? undefined : 0,
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius,
          color: color.text,
          ...(mask ? { WebkitMaskImage: mask, maskImage: mask } : {}),
          ...(s.archived ? { opacity: 0.72 } : {}),
          ...(s.kind === 'base-gap' ? { borderTopStyle: 'dashed', borderBottomStyle: 'dashed' } : {}),
        }}
        title={`${s.title}${neighborMini ? `\n${neighborMini}` : ''}${
          adj && adj.truncatedDays > 0
            ? `\nСтык с рейсом: простой укорочен до ${fmtDM(adj.b)} — машина выехала на ${adj.truncatedDays} дн. раньше учётного срока (данные учёта не изменены).`
            : adj && (adj.cutA || adj.cutB)
              ? '\nДень смены разделён с полосой рейса (штатный переход, не расхождение).'
              : ''
        }${clickable ? '' : ' · (только просмотр)'}`}
      >
        {labelEl}
      </div>
    );
  };
  /** Подсветка выделенного периода (окно «Учёта выезда»): мягкая полоса под данными,
   *  акцентные границы; сама полоса периода остаётся кликабельной. */
  const periodBand = () => {
    if (!hasHighlight || hlA == null || hlB == null) return null;
    const leftB = dayToX(Math.max(hlA, renderVs), renderVs, colW);
    const rightB = dayToX(Math.min(hlB, ve), renderVs, colW) + colW;
    const l = Math.max(0, leftB);
    const w = Math.max(1, Math.min(W, rightB) - l);
    if (rightB <= 0 || leftB >= W) return null;
    return (
      <div
        data-mini-period-band="1"
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          zIndex: TL_Z.bg,
          left: l,
          width: w,
          background: 'var(--accent-8)',
          borderLeft: '2px solid var(--accent-40)',
          borderRight: '2px solid var(--accent-40)',
        }}
      />
    );
  };
  /** Однодневная отметка на всю ячейку (готовность / окончание ремонта) с иконкой. */
  const renderMiniBzMark = (m: BzMark, keyPrefix: string, sec: RowDaySections) => {
    const color = bzKindColor(m.kind);
    const mk = periodMergeKey(m.periodKey);
    const slot = sec.slotForPeriod(m.day, mk);
    const mSection = slot ? slot.section : 0;
    const total = slot ? slot.sections : 1;
    const left = dayToX(m.day, renderVs, colW) + Math.round((mSection * colW) / total);
    const right = dayToX(m.day, renderVs, colW) + Math.round(((mSection + 1) * colW) / total);
    const width = Math.max(1, right - left);
    const r = 'var(--tl-bar-r)';
    const radius =
      total === 1
        ? r
        : `${mSection === 0 ? r : '0px'} ${mSection === total - 1 ? r : '0px'} ${
            mSection === total - 1 ? r : '0px'
          } ${mSection === 0 ? r : '0px'}`;
    const Icon = m.kind === 'ready' ? CarFront : Wrench;
    const neighborMark = sec.neighborsOf(m.day, [mk]);
    const clickable = !!onOpenBasePeriod;
    const open = clickable ? () => onOpenBasePeriod?.(m.periodKey) : undefined;
    return (
      <div
        key={`${keyPrefix}-${m.kind}-${m.periodKey}-${m.day}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        data-bz-mark={m.kind}
        data-bz-day={m.day}
        data-bz-section={mSection}
        data-bz-sections={total}
        data-period={m.periodKey}
        onClick={open}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenBasePeriod?.(m.periodKey);
                }
              }
            : undefined
        }
        className={`absolute top-0 bottom-0 overflow-hidden flex items-center justify-center ${clickable ? 'cursor-pointer' : ''}`}
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
        title={`${m.title}${neighborMark ? `\n${neighborMark}` : ''}${clickable ? '' : ' · (только просмотр)'}`}
      >
        {width >= 14 ? <Icon className="w-3 h-3 shrink-0" style={{ color: color.text }} aria-hidden="true" /> : null}
      </div>
    );
  };
  /** Правка полосы рейса из разрешения наложений (доли дня смены у краёв). */
  const miniAdjRect = (
    p: { left: number; width: number } | null,
    adj: RowTripAdjust | null,
  ): { left: number; width: number } | null => {
    if (!p || !adj) return p;
    const l = p.left + Math.round(adj.fracA * colW);
    const r = p.left + p.width - Math.round((1 - adj.fracB) * colW);
    return { left: l, width: Math.max(1, r - l) };
  };
  /** Маркер стыка (выезд/прибытие/выехала раньше) — SVG-иконка на срезе дня. */
  const renderMiniOvMarker = (m: ResolvedMarker, keyPrefix: string, rowH: number): React.ReactNode => {
    const x = dayToX(m.day, renderVs, colW) + Math.round(colW * m.frac);
    if (x < -12 || x > W + 12) return null;
    const tone =
      m.kind === 'early-departure'
        ? MARKER_TONE_MINI['early-departure']
        : m.kind === 'departure'
          ? MARKER_TONE_MINI.departure
          : MARKER_TONE_MINI.arrival;
    const Icon = m.kind === 'arrival' ? LogIn : LogOut;
    const clickable = !!(m.periodKey && onOpenBasePeriod);
    const open = clickable && m.periodKey ? () => onOpenBasePeriod?.(m.periodKey as string) : undefined;
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
          top: Math.max(1, Math.round((rowH - 14) / 2)),
          width: 14,
          height: 14,
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          boxShadow: '0 1px 2px rgba(18,19,22,0.18)',
        }}
        title={`${m.title}${clickable ? '' : ' · (только просмотр)'}`}
      >
        <Icon className="w-2.5 h-2.5" style={{ color: tone.fg }} aria-hidden="true" />
      </div>
    );
  };
  /** «Ожидание выезда»: нейтральная штриховка с подписью. */
  const renderMiniWaitGap = (g: WaitGap & { periodKey: string }, keyPrefix: string): React.ReactNode => {
    const clipA = Math.max(g.a, renderVs);
    const clipB = Math.min(g.b, ve);
    if (clipB < clipA) return null;
    const left = dayToX(clipA, renderVs, colW);
    const width = Math.max(1, dayToX(clipB, renderVs, colW) + colW - left);
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
          background: waitHatchMini,
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
  /** Конфликт данных: штриховка зоны + значок со ссылкой на источник. */
  const renderMiniConflict = (w: ResolvedWarning, keyPrefix: string, rowH: number): React.ReactNode => {
    const clipA = Math.max(w.a, renderVs);
    const clipB = Math.min(w.b, ve);
    if (clipB < clipA) return null;
    const left = dayToX(clipA, renderVs, colW);
    const width = Math.max(1, dayToX(clipB, renderVs, colW) + colW - left);
    const open = () => {
      const k = w.refs[0] || '';
      if (k.startsWith('bz:')) onOpenBasePeriod?.(k);
      else onSelectTrip(k);
    };
    return (
      <div
        key={`${keyPrefix}-${w.a}-${w.b}`}
        data-tl-conflict="1"
        data-tl-conflict-a={w.a}
        data-tl-conflict-b={w.b}
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{ zIndex: TL_Z.mark, left, width }}
      >
        <div aria-hidden="true" className="absolute inset-0" style={{ background: conflictHatchMini, borderRadius: 'var(--tl-bar-r)' }} />
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
            top: Math.max(1, Math.round((rowH - 12) / 2)),
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-[#6B7280] tabular-nums" data-ui="mini-range">
          {fmtFull(isoOf(renderVs))} – {fmtFull(isoOf(ve))}
        </span>
        {/* Навигация встроенного таймлайна: меняет только положение/масштаб —
            набор записей машины не фильтруется (видны архив, текущие и будущие) */}
        <button type="button" data-ui="mini-today" onClick={goToday} className={UI.buttonGhost} title="Прокрутить к сегодняшней дате">
          Сегодня
        </button>
        <label className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
          Перейти к
          <DateInput
            className="w-[110px]"
            value={jumpDate}
            ariaLabel="Перейти к дате (встроенный таймлайн)"
            onChange={(v) => {
              setJumpDate(v);
              const n = dayNum(v);
              if (n != null) jumpTo(n, 0);
            }}
          />
        </label>
        {focus ? (
          <button type="button" data-ui="mini-fit-trip" onClick={showWholeTrip} className={UI.buttonGhost} title="Масштаб и позиция по выбранному рейсу целиком">
            Показать рейс целиком
          </button>
        ) : null}
        {/* Масштаб встроенного таймлайна — независимый от основного */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Масштаб встроенного таймлайна" data-ui="mini-zoom-control">
          <button
            type="button"
            data-zoom="mini-out"
            className={`${UI.buttonGhost} ${miniZoom <= 0 ? 'opacity-40 cursor-default' : ''}`}
            title="Уменьшить масштаб: ширина дня меньше, дат больше"
            aria-label="Уменьшить масштаб встроенного таймлайна"
            disabled={miniZoom <= 0}
            onClick={() => setMiniZoomAt(miniZoom - 1)}
          >
            −
          </button>
          <input
            type="range"
            min={0}
            max={ZOOM_LEVELS.length - 1}
            step={1}
            value={miniZoom}
            data-ui="mini-zoom-slider"
            aria-label="Масштаб встроенного таймлайна"
            title={`Масштаб: ${zoomLabel(miniZoom)} (${colW}px на день)`}
            onChange={(e) => setMiniZoomAt(Number(e.target.value))}
            className="w-20 md:w-28 accent-[var(--accent)] cursor-pointer"
          />
          <button
            type="button"
            data-zoom="mini-in"
            className={`${UI.buttonGhost} ${miniZoom >= ZOOM_LEVELS.length - 1 ? 'opacity-40 cursor-default' : ''}`}
            title="Увеличить масштаб: больше деталей — до отдельных дней"
            aria-label="Увеличить масштаб встроенного таймлайна"
            disabled={miniZoom >= ZOOM_LEVELS.length - 1}
            onClick={() => setMiniZoomAt(miniZoom + 1)}
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-ui="mini-timeline"
        className="tl-mini tl-scroll overflow-auto overscroll-x-contain border border-[#E5E7EB] rounded-xl bg-[#F9FAFB] max-h-[300px]"
      >
        <style>{`.tl-scroll{scrollbar-width:thin;scrollbar-color:#B6BBC2 #F3F4F6;}
.tl-scroll::-webkit-scrollbar{height:12px;width:12px;}
.tl-scroll::-webkit-scrollbar-track{background:#F3F4F6;border-radius:8px;}
.tl-scroll::-webkit-scrollbar-thumb{background:#C3C8CF;border-radius:8px;border:2px solid #F3F4F6;}`}</style>
        <div className="grid min-w-max relative" style={{ gridTemplateColumns: `96px ${W}px` }}>
          <div className="sticky left-0 top-0 bg-[#F9FAFB] border-b border-r border-[#E5E7EB] px-2 py-1 w-[96px] min-w-[96px]" style={{ zIndex: TL_Z.headCorner }}>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[#9CA3AF]">План</span>
          </div>
          <div className="sticky top-0 bg-[#F9FAFB] border-b border-[#E5E7EB]" style={{ zIndex: TL_Z.head, width: W }}>
            {/* Та же календарная шапка (месяцы + дни), что и в основном таймлайне */}
            <CalendarHeader vs={renderVs} vn={renderVn} colW={colW} today={today} pinLeft={104} dense />
          </div>

          {/* План */}
          <div className="sticky left-0 bg-[#F9FAFB] border-r border-b border-[#EEF0F3] px-2 w-[96px] min-w-[96px] text-[9px] leading-[12px] text-[#9CA3AF] overflow-hidden" style={{ zIndex: TL_Z.colCell, height: miniPlanH, borderRightColor: '#D1D5DB' }}>
            {focus ? formatPlate(focus.carNumber) : ''} · план
          </div>
          <div data-lane="plan" className="relative border-b border-[#EEF0F3]" style={{ width: W, height: miniPlanH }}>
            {bgSegs.filter((s) => !s.today).map((s, i) => (
              <div
                key={`w${i}`}
                className="absolute top-0 bottom-0"
                style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.7, pointerEvents: 'none' }}
              />
            ))}
            {periodBand()}
            {miniPlanBz.stripes.map((s) => renderMiniBzStripe(s, 'mpbz', miniPlanOv, miniPlanSec))}
            {miniPlanBz.marks.map((m) => renderMiniBzMark(m, 'mpbm', miniPlanSec))}
            {miniPlanFills.map((f) => renderMiniFill(f, 'mpf', miniPlanSec))}
            {bgSegs.filter((s) => s.today).map((s, i) => (
              <div
                key={`wt${i}`}
                data-tl-today="1"
                className="absolute top-0 bottom-0"
                style={{ zIndex: TL_Z.overlay, left: s.left, width: s.width, background: '#F43F5E', opacity: 0.14, pointerEvents: 'none' }}
              />
            ))}
            {carTrips.map((t) => {
              const ov = t.spanOverride || {};
              const sp = tripSpan(t);
              const a = ov.pMin ?? sp.pMin ?? null;
              if (a == null) return null;
              const b = ov.pMax ?? sp.pMax ?? a;
              const q = pos(a, b);
              if (!q) return null;
              const adj = miniPlanOv.tripAdjust.get(t.key) ?? null;
              const qa = miniAdjRect(q, adj) ?? q;
              const parts = planBarLabelParts(t);
              const ti = miniPlanTrack.tripSlot.get(t.key);
              const top = ti == null ? 5 : miniPlanTrack.layout.tops[ti];
              return (
                <div
                  key={`p-${t.key}`}
                  role="button"
                  tabIndex={0}
                  data-bar="plan"
                  data-trip={t.key}
                  data-bar-frac-a={adj && adj.fracA !== 0 ? `${adj.fracA}` : undefined}
                  data-bar-frac-b={adj && adj.fracB !== 1 ? `${adj.fracB}` : undefined}
                  data-overlap={adj?.overlap ? '1' : undefined}
                  onClick={() => t.key !== focusKey && onSelectTrip(t.key)}
                  className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[16px] cursor-pointer px-1"
                  style={{
                    zIndex: TL_Z.tripBar,
                    left: qa.left,
                    width: qa.width,
                    top,
                    height: MINI_PLAN_BAR_H,
                    background: t.archived ? '#E5E7EB' : 'var(--accent-10)',
                    border: `1px solid ${t.archived ? '#9CA3AF' : 'var(--accent-40)'}`,
                    color: t.archived ? '#6B7280' : '#7E3A0D',
                    borderRadius: 3,
                    ...link(t.key),
                  }}
                  title={`${formatPlate(t.carNumber)} · ${parts.titleText}${t.archived ? ' · архив' : ''}${t.key === focusKey ? ' · выбранный рейс' : ' · соседний рейс (контекст)'}`}
                >
                  {adj?.overlap ? (
                    <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatchMini }} />
                  ) : null}
                  {qa.width > 40 ? <PlanBarLabel parts={parts} width={qa.width} fontPx={9} /> : ''}
                </div>
              );
            })}
            {carTrips.map((t) => {
              if (t.kind !== 'manual' || !t.bufferDays) return null;
              const ov = t.spanOverride || {};
              const sp = tripSpan(t);
              const pmax = ov.pMax ?? sp.pMax ?? null;
              if (pmax == null) return null;
              const q = pos(pmax + 1, pmax + t.bufferDays);
              if (!q) return null;
              const ti = miniPlanTrack.bufferSlot.get(t.key);
              const top = ti == null ? 5 : miniPlanTrack.layout.tops[ti];
              return (
                <div
                  key={`buf-${t.key}`}
                  data-bar="buffer"
                  className="absolute"
                  style={{ zIndex: TL_Z.tripBar, left: q.left, width: q.width, top, height: MINI_PLAN_BAR_H, background: hatchBuffer, borderRadius: 3 }}
                  title={`запас ${t.bufferDays} дн`}
                />
              );
            })}
            {miniPlanOv.waitGaps.map((g) => renderMiniWaitGap(g, 'mpw'))}
            {miniPlanOv.warnings.map((w, wi) => renderMiniConflict(w, `mpc${wi}`, miniPlanH))}
            {miniPlanOv.markers.map((m) => renderMiniOvMarker(m, 'mpm', miniPlanH))}
          </div>
          <div className="sticky left-0 bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2 w-[96px] min-w-[96px] text-[9px] leading-[12px] text-[#9CA3AF] overflow-hidden" style={{ zIndex: TL_Z.colCell, height: miniFactH, borderRightColor: '#D1D5DB' }}>
            факт · база · ремонт
          </div>
          <div data-lane="fact" className="relative border-b border-[#E5E7EB]" style={{ width: W, height: miniFactH }}>
            {bgSegs.filter((s) => !s.today).map((s, i) => (
              <div
                key={`fw${i}`}
                className="absolute top-0 bottom-0"
                style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.6, pointerEvents: 'none' }}
              />
            ))}
            {periodBand()}
            {miniFactBz.stripes.map((s) => renderMiniBzStripe(s, 'mfbz', miniFactOv, miniFactSec))}
            {miniFactBz.marks.map((m) => renderMiniBzMark(m, 'mfbm', miniFactSec))}
            {miniFactFills.map((f) => renderMiniFill(f, 'mff', miniFactSec))}
            {bgSegs.filter((s) => s.today).map((s, i) => (
              <div
                key={`fwt${i}`}
                data-tl-today="1"
                className="absolute top-0 bottom-0"
                style={{ zIndex: TL_Z.overlay, left: s.left, width: s.width, background: '#F43F5E', opacity: 0.14, pointerEvents: 'none' }}
              />
            ))}
            {(() => {
              // Компактные маркеры событий на их реальных датах (не полосы);
              // близкие события — один маркер со счётчиком.
              const marks: EventMark[] = [];
              carEvents.forEach((e) => {
                const m = eventMarkOf(
                  e,
                  eventTypeOf(e.kind).name,
                  eventTypeOf(e.kind).color,
                  e.tripKey ? 'клик — открыть рейс и показать запись' : undefined,
                );
                if (m && pos(m.day, m.day)) marks.push(m);
              });
              return groupEventMarks(marks).map((g) => {
                const q = pos(g.day, g.day);
                if (!q) return null;
                const gTrip = g.tripKey;
                const gEv = g.eventId;
                const linked = !!(gTrip && gEv);
                const grouped = g.count > 1;
                const left = grouped
                  ? dayToX(g.day, renderVs, colW) + Math.round(colW * 0.45)
                  : dayToX(g.day, renderVs, colW) + Math.round(colW * 0.62);
                const zoneTop = miniFactZone0 ? miniFactZone0.top : 3;
                const zoneH = miniFactZone0 ? miniFactZone0.h : MINI_FACT_NONE_H;
                const markerH = grouped ? 12 : 9;
                const top = Math.max(1, zoneTop + Math.max(0, Math.round((zoneH - markerH) / 2)));
                return (
                  <div
                    key={`ev-${gEv || g.day}-${g.count}`}
                    role={linked ? 'button' : undefined}
                    tabIndex={linked ? 0 : undefined}
                    data-bar="event"
                    data-event={gEv}
                    data-trip={gTrip}
                    onClick={gTrip && gEv ? () => onOpenEventTrip?.(gTrip, gEv) : undefined}
                    className={`absolute ${linked ? 'cursor-pointer' : ''}`}
                    style={
                      grouped
                        ? { zIndex: TL_Z.mark, left, top, height: 12, minWidth: 16, padding: '0 3px', background: '#7C3AED', borderRadius: 6, textAlign: 'center', opacity: 0.95 }
                        : { zIndex: TL_Z.mark, left, top, width: 9, height: 9, background: g.items[0].color, borderRadius: 2, transform: 'rotate(45deg)', opacity: 0.95 }
                    }
                    title={g.title}
                  >
                    {grouped ? <span className="text-[8px] leading-[12px] text-white font-semibold">{g.count}</span> : null}
                  </div>
                );
              });
            })()}
            {carTrips.map((t) => {
              const sp = tripSpan(t);
              if (sp.fMin == null) return null;
              const endDay = tripFactEnd(t);
              const ongoing = endDay == null && !t.archived;
              const fEnd = ongoing ? Math.max(today, sp.fMax ?? sp.fMin) : (endDay ?? sp.fMax ?? sp.fMin);
              const q = pos(sp.fMin, fEnd);
              if (!q) return null;
              const adjF = miniFactOv.tripAdjust.get(t.key) ?? null;
              const qf = miniAdjRect(q, adjF) ?? q;
              const ti = miniFactTrack.factSlot.get(t.key);
              const top = ti == null ? 4 : miniFactTrack.layout.tops[ti];
              // Сегменты цвета факта — ТА ЖЕ чистая функция и палитра, что на
              // основном таймлайне (lib/factSegments): правила не копируются.
              const segRes = factSegmentsOfTrip(t, sp.fMin, fEnd, today);
              const segs = segRes.segments;
              return (
                <div
                  key={`f-${t.key}`}
                  role="button"
                  tabIndex={0}
                  data-bar="fact"
                  data-trip={t.key}
                  data-bar-frac-a={adjF && adjF.fracA !== 0 ? `${adjF.fracA}` : undefined}
                  data-bar-frac-b={adjF && adjF.fracB !== 1 ? `${adjF.fracB}` : undefined}
                  data-overlap={adjF?.overlap ? '1' : undefined}
                  onClick={() => t.key !== focusKey && onSelectTrip(t.key)}
                  className="absolute cursor-pointer overflow-hidden"
                  style={{
                    zIndex: TL_Z.tripBar,
                    left: qf.left,
                    width: qf.width,
                    top,
                    height: MINI_FACT_BAR_H,
                    borderRadius: 2,
                    // Продолжающийся край — мягкий обрыв без скругления.
                    ...(ongoing ? { WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 10px), transparent 100%)', maskImage: 'linear-gradient(to right, #000 calc(100% - 10px), transparent 100%)' } : {}),
                    ...link(t.key),
                  }}
                  title={`${formatPlate(t.carNumber)} · факт: ${fmtFull(isoOf(sp.fMin))} – ${ongoing ? 'окончание не указано' : fmtFull(isoOf(fEnd))} · ${segs
                    .map((x) => FACT_SEGMENT_COLORS[x.color].label)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join('; ')}${segRes.noPlan ? ' · план не указан' : ''}${t.key === focusKey ? ' · выбранный рейс' : ''}`}
                >
                  {segs.map((x, i) => {
                    const col = FACT_SEGMENT_COLORS[x.color];
                    const xL = Math.max(0, Math.round(dayToX(x.a, renderVs, colW) - qf.left));
                    const xR = Math.min(qf.width, Math.round(dayToX(x.b, renderVs, colW) + colW - qf.left));
                    return (
                      <span
                        key={`mseg-${x.a}-${x.b}-${x.color}-${i}`}
                        data-fact-seg-mini={`${x.a}-${x.b}-${x.color}`}
                        className="absolute top-0 bottom-0"
                        style={{
                          left: xL,
                          width: Math.max(1, xR - xL),
                          background: col.bg,
                          borderTop: `1px solid ${col.border}`,
                          borderBottom: `1px solid ${col.border}`,
                          ...(i === 0 ? { borderLeft: `1px solid ${col.border}` } : {}),
                          ...(i === segs.length - 1 ? { borderRight: `1px solid ${col.border}` } : {}),
                        }}
                      />
                    );
                  })}
                  {adjF?.overlap ? (
                    <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatchMini }} />
                  ) : null}
                </div>
              );
            })}
            {carTrips.map((t) => {
              const sp = tripSpan(t);
              if (sp.fMin != null) return null;
              const ov = t.spanOverride || {};
              const a = ov.pMin ?? sp.pMin;
              if (a == null) return null;
              const b = ov.pMax ?? sp.pMax ?? a;
              const q = pos(a, b);
              if (!q) return null;
              const adjN = miniFactOv.tripAdjust.get(t.key) ?? null;
              const qn = miniAdjRect(q, adjN) ?? q;
              const ti = miniFactTrack.factNoneSlot.get(t.key);
              const top = ti == null ? 3 : miniFactTrack.layout.tops[ti];
              return (
                <div
                  key={`fn-${t.key}`}
                  data-bar="fact-none"
                  data-bar-frac-a={adjN && adjN.fracA !== 0 ? `${adjN.fracA}` : undefined}
                  data-bar-frac-b={adjN && adjN.fracB !== 1 ? `${adjN.fracB}` : undefined}
                  data-overlap={adjN?.overlap ? '1' : undefined}
                  className="absolute text-[8px] leading-[14px] text-ellipsis text-[#9CA3AF] px-1 overflow-hidden whitespace-nowrap"
                  style={{ zIndex: TL_Z.tripBar, left: qn.left, width: qn.width, top, height: MINI_FACT_NONE_H, border: '1px dashed #9CA3AF', borderRadius: 2, background: '#F9FAFB' }}
                  title="Фактические данные не указаны"
                >
                  {adjN?.overlap ? (
                    <span aria-hidden="true" data-overlap-hatch="1" className="absolute inset-0 pointer-events-none" style={{ background: conflictHatchMini }} />
                  ) : null}
                  {qn.width > 90 ? 'Факт не указан' : ''}
                </div>
              );
            })}
            {miniFactOv.waitGaps.map((g) => renderMiniWaitGap(g, 'mfw'))}
            {miniFactOv.warnings.map((w, wi) => renderMiniConflict(w, `mfc${wi}`, miniFactH))}
            {miniFactOv.markers.map((m) => renderMiniOvMarker(m, 'mfm', miniFactH))}
          </div>
          {/* Host перекрёстной подсветки встроенного таймлайна — тот же
              механизм lib/useCrosshair, что на основном полотне. */}
          <div ref={crossHostRef} aria-hidden="true" className="pointer-events-none" style={{ position: 'absolute', inset: 0, zIndex: TL_Z.crosshair }} />
        </div>
      </div>
      <p className="text-[10px] text-[#9CA3AF]">
        Соседние рейсы показаны как контекст — клик открывает их окно. База и ремонт — из «Учёта выезда» по этой машине
        (плановый простой на базе: приезд → срок готовности; фактический простой на базе: приезд → выезд — открытый период
        подписан «Готовится к выезду»; ремонт — свои даты) — заливка ячейки дня, клик открывает карточку периода.
        Факт рейса окрашен сегментами по отставанию (в срок / 1–2 дня / больше 2 дней / критический срок).
        Несколько отметок в одном дне делят ячейку на цветные секции.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Окно рейса
// ---------------------------------------------------------------------------

export default function TripCard({
  trip,
  stageTypes,
  dispatchers,
  today,
  canWrite,
  canEditPlan,
  user,
  meta,
  focusEventId,
  onFocusEventDone,
  focusStageId,
  onFocusStageDone,
  onOpenEventTrip,
  onOpenBasePeriod,
  planGuard,
  planPerms,
  planRequests,
  planControlEnabled,
  carTrips,
  carBases,
  carEvents,
  cities,
  onSelectTrip,
  onOpenPlan,
  onCopyPlanLink,
  onArchiveToggle,
  onDelete,
  onClose,
}: Props) {
  const { showConfirm, showUnsaved } = useDialog();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(trip));
  const [metaDraft, setMetaDraft] = useState<Meta>(meta);
  /**
   * Базовое (сохранённое) состояние окна. «Изменено» определяется СРАВНЕНИЕМ
   * черновика с ним по всем блокам (не флагом): открытие окна и клики ложных
   * подтверждений не дают; состояние сбрасывается ТОЛЬКО после успешной записи
   * или синхронизации с базой при отсутствии правок.
   */
  const [baseline, setBaseline] = useState<{ draft: Draft; meta: Meta }>(() => ({ draft: toDraft(trip), meta }));
  /** Несохранённый текст журнала событий — общий запрос подтверждения при закрытии. */
  const journalDirtyRef = useRef(false);
  const [journalDirty, setJournalDirty] = useState(false);
  /** Единое сохранение: индикатор в кнопке, ошибка с «Повторить», отметка успеха. */
  const [savingAll, setSavingAll] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimer = useRef<number | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  /** Форма запроса разового доступа (диспетчер): причина и отправка. */
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestReason, setRequestReason] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [requestError, setRequestError] = useState('');
  /** Запрос из таблицы этапов: открыть форму события с предвыбранным этапом. */
  const [eventFormRequest, setEventFormRequest] = useState<{ stageId?: string; nonce: number } | null>(null);
  /** Краткая подсветка этапа после клика по маркеру на встроенном таймлайне. */
  const [highlightStage, setHighlightStage] = useState<string | null>(null);
  const isPlan = trip.kind === 'plan';
  const planSourceId = trip.plan?.id || '';
  const archived = !!trip.archived;
  const readOnly = archived || !canWrite;

  // ── Контроль плана этапов (блокировка плановых дат после сохранения) ────
  const planEnabled = !!planControlEnabled;
  const planUserId = String(user.uid || '');
  const planLock = useMemo(
    () =>
      resolvePlanLock({
        storedStages: trip.stages,
        guard: planGuard || null,
        perms: planPerms || {},
        userId: planUserId,
        // Маркер черновика учитывается только у записей, созданных формой
        // таймлайна: у заполненных реальных рейсов он не даёт бесплатную правку.
        timelineDraft: trip.planDraftFromTimeline === true,
      }),
    [trip.stages, trip.planDraftFromTimeline, planGuard, planPerms, planUserId],
  );
  const isRootAdmin = user.role === 'root_admin';
  /** Итоговое состояние: вне облака контроль выключен (локальный режим). */
  const planState = planEnabled ? planLock.state : 'draft';
  /** Плановые даты и состав доступны правке в этом сеансе. */
  const canEditPlanned = !readOnly && (planState === 'draft' || planState === 'permitted' || isRootAdmin);
  /** Запрос разового доступа ТЕКУЩЕГО пользователя по этому рейсу (одна запись на пару). */
  const myPlanRequest = useMemo<TimelinePlanRequest | null>(() => {
    const store = planRequests || {};
    const key = planUserId ? dbService.planRequestIdOf(planUserId) : '';
    const mine = key ? store[key] : undefined;
    return mine || null;
  }, [planRequests, planUserId]);
  /** Кнопка «Запросить разовый доступ» — диспетчеру при заблокированном плане. */
  const showRequestAccess = planEnabled && planState === 'saved' && !readOnly && !isRootAdmin;

  /**
   * Отправка запроса разового доступа: свежая версия сохранённого плана, одна
   * запись на пару (рейс, пользователь); повторный запрос при ожидающем
   * запрещён (транзакция в базе, не только интерфейс).
   */
  const submitPlanRequest = async () => {
    if (requestSending || !planUserId || !planTripKey) return;
    setRequestSending(true);
    setRequestError('');
    try {
      const fresh = await dbService.getTimelinePlanGuardOnce(planTripKey);
      const version = Number(fresh?.version) || planLock.version || 1;
      const res = await dbService.createTimelinePlanRequest(
        {
          tripKey: planTripKey,
          userId: planUserId,
          userName: user.name,
          carNumber: trip.carNumber || '',
          route: draft.route || trip.plan?.direction || '',
          ...(requestReason.trim() ? { reason: requestReason.trim() } : {}),
          planVersion: version,
        },
        planLock.history,
      );
      if (res.ok) {
        setRequestFormOpen(false);
        setRequestReason('');
        toast('Запрос отправлен. Ожидается решение администратора', 'success');
      } else if (res.reason === 'already-pending') {
        setRequestError('Запрос уже отправлен и ожидает решения — повторно отправлять нельзя.');
      } else {
        setRequestError('Не удалось отправить запрос — повторите отправку.');
      }
    } catch (err) {
      setRequestError(`Не удалось отправить запрос: ${(err as Error).message}`);
    } finally {
      setRequestSending(false);
    }
  };

  /**
   * «Изменено» — СРАВНЕНИЕ черновика с последним сохранённым состоянием по всем
   * блокам (не флаг: открытие окна и клики по полям подтверждений не дают).
   * Общие для окна и подтверждения выхода чистые функции — модульные (ниже
   * toDraft), чтобы сравнение не зависело от замыканий.
   */
  const dirtyBlocks = useMemo(
    () => [
      ...changedBlocksOf(draft, metaDraft, baseline),
      ...(journalDirty ? ['текст в форме журнала событий — сохраняется кнопкой в журнале'] : []),
    ],
    [draft, metaDraft, baseline, journalDirty],
  );
  const isDirty = dirtyBlocks.length > 0;

  /** Актуальное состояние для императивных обработчиков (Esc, «Назад», клавиши). */
  const stateRef = useRef({ draft, metaDraft, baseline, isDirty });
  stateRef.current = { draft, metaDraft, baseline, isDirty };

  /**
   * Синхронизация окна с базой: свежие данные показываются, пока пользователь
   * не начал править; локальные правки ответом базы не перетираются.
   */
  useEffect(() => {
    if (stateRef.current.isDirty) return;
    const nextDraft = toDraft(trip);
    setDraft(nextDraft);
    setMetaDraft(meta);
    setBaseline({ draft: nextDraft, meta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, meta]);

  // Фокус и горячие клавиши окна (общий хук): Esc — закрыть (с проверкой
  // несохранённых), Enter в поле и Ctrl/Cmd+S — сохранить без закрытия.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = rootRef.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]');
    first?.focus();
    return () => {
      prev?.focus?.();
    };
  }, []);

  const leaveBusy = useRef(false);

  /**
   * Проверка перед закрытием/переходом: без изменений — уходим сразу; с
   * изменениями — единое брендированное подтверждение РОВНО с двумя кнопками
   * («Отмена» — основная, в фокусе, ничего не теряется; «Выйти без сохранения»
   * — деструктивная). Возвращает true, если действие можно продолжить.
   */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (leaveBusy.current) return false;
    const s = stateRef.current;
    const blocks = [
      ...changedBlocksOf(s.draft, s.metaDraft, s.baseline),
      ...(journalDirtyRef.current ? ['текст в форме журнала событий — сохраняется кнопкой в журнале'] : []),
    ];
    if (!blocks.length) return true;
    leaveBusy.current = true;
    try {
      const res = await showUnsaved({ changed: blocks });
      return res === 'discard';
    } finally {
      leaveBusy.current = false;
    }
  }, [showUnsaved]);

  /** Закрытие окна (Esc, крестик, клик по фону, «Назад») — через общую проверку.
   *  Возвращает «вышли ли» — нужно страховке кнопки «Назад». */
  const requestClose = useCallback((): Promise<boolean> => {
    return confirmLeave().then((ok) => {
      if (ok) onClose();
      return ok;
    });
  }, [confirmLeave, onClose]);

  /** Переход из окна к другой записи (рейс/событие встроенного таймлайна):
   *  окно не закрывается — спрашиваем только при несохранённых изменениях. */
  const leaveThen = useCallback(
    (action: () => void) => {
      void confirmLeave().then((ok) => {
        if (ok) action();
      });
    },
    [confirmLeave],
  );

  /** Единая точка входа «Сохранить» для кнопки и горячих клавиш (см. ниже). */
  const saveAllRef = useRef<() => void>(() => {});

  useWindowHotkeys({
    onEscape: () => {
      requestClose();
    },
    onSave: () => saveAllRef.current(),
  });

  // Отметка «Сохранено ✓» гаснет сама (уведомление об успехе — отдельный toast).
  useEffect(
    () => () => {
      if (savedFlashTimer.current !== null) window.clearTimeout(savedFlashTimer.current);
    },
    [],
  );

  // Закрытие вкладки/перезагрузка: кастомное окно браузер показать не даёт —
  // оставляем минимальный системный диалог ТОЛЬКО при несохранённых изменениях.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Кнопка «Назад» браузера: ставим страховочную запись истории, чтобы первый
  // «Назад» вернулся к тому же адресу и спросил о несохранённых данных (SPA-
  // навигацию beforeunload не ловит). «Остаться» — страховка ставится снова.
  useEffect(() => {
    const here = window.location.href;
    const arm = () => {
      try {
        window.history.pushState({ ratipaCardGuard: 1 }, '', here);
      } catch {
        /* не критично */
      }
    };
    arm();
    const onPop = () => {
      if (stateRef.current.isDirty || journalDirtyRef.current) {
        void requestClose().then((left) => {
          // Остались в окне («Отмена») — снова закрываем «Назад» страховкой.
          // Вышли («Выйти без сохранения») — историю не трогаем: поздняя
          // страховка оставила бы в адресе закрытый рейс и мешала бы открыть его снова.
          if (!left) arm();
        });
      } else {
        onClose();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Черновик журнала событий — часть несохранённых изменений карточки. */
  const handleJournalDirty = useCallback((v: boolean) => {
    journalDirtyRef.current = v;
    setJournalDirty(v);
  }, []);

  /** Оптимистичная очистка прежних текстов после переноса в событие. */
  const clearLegacyStage = useCallback((stageId: string, field: 'reason' | 'action') => {
    setDraft((d) => ({ ...d, stages: d.stages.map((s) => (s.id === stageId ? { ...s, [field]: '' } : s)) }));
  }, []);
  const clearLegacyMeta = useCallback((field: 'reason' | 'measures' | 'comment') => {
    setMetaDraft((m) => ({ ...m, [field]: '' }));
  }, []);

  /** «Добавить событие» из таблицы этапов: журнал открывает форму с этапом. */
  const requestAddEvent = useCallback((stageId?: string) => {
    setEventFormRequest({ stageId, nonce: Date.now() });
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector('[data-ui="trip-events"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  // ── Контроль плана этапов: единое сохранение и разовые разрешения ───────
  // Блокировка плановых дат остаётся ФАКТИЧЕСКИМ механизмом (planGuard +
  // planPerms + история): одиночная кнопка «Сохранить» сама фиксирует первичное
  // сохранение плана (черновик → «План сохранён») либо расходует разовое
  // разрешение администратора — отдельной кнопки «Сохранить план этапов» нет.
  const planTripKey = trip.key;

  const nextPlanHistory = useCallback(
    (action: TimelinePlanHistoryEntry['action'], note: string): TimelinePlanHistoryEntry[] =>
      [
        ...planLock.history,
        { at: new Date().toISOString(), by: user.name, ...(planUserId ? { byId: planUserId } : {}), action, note },
      ].slice(-30),
    [planLock.history, user.name, planUserId],
  );

  const describePlanChanges = useCallback(
    (changes: PlanStageChanges): string => {
      const parts: string[] = [];
      changes.plannedUpdates.forEach((u) => {
        const st = draft.stages.find((s) => s.id === u.id) || trip.stages.find((s) => s.id === u.id);
        parts.push(
          `${st ? stageFullName(stageTypes, st) : u.id}: план ${u.before ? fmtFull(u.before) : 'не указана'} → ${u.plannedDate ? fmtFull(u.plannedDate) : 'не указана'}`,
        );
      });
      changes.circleUpdates.forEach((u) => {
        const st = draft.stages.find((s) => s.id === u.id) || trip.stages.find((s) => s.id === u.id);
        parts.push(
          `${st ? stageFullName(stageTypes, st) : u.id}: круг ${u.before ?? 'не указан'} → ${u.circle ?? 'не указан'}`,
        );
      });
      if (changes.circlesChanged) {
        parts.push(`количество кругов рейса: ${normalizeCircles(trip.circles)} → ${draft.circles}`);
      }
      changes.adds.forEach((s) =>
        parts.push(`добавлен этап «${stageFullName(stageTypes, s)}»${dayNum(s.plannedDate) != null ? ` (план ${fmtFull(s.plannedDate)})` : ''}`),
      );
      changes.removes.forEach((s) => parts.push(`удалён этап «${stageFullName(stageTypes, s)}»`));
      return parts.join('; ') || 'без изменений';
    },
    [draft.stages, draft.circles, trip.stages, trip.circles, stageTypes],
  );

  /**
   * Первое невалидное поле — для фокуса ДО записи (валидация по всем блокам).
   * Проверяются: порядок плановых дат, право записи плана дохода и блокировка
   * плановых дат (страховка поверх UI-гейтов).
   */
  const findValidationIssue = (): { message: string; focus: () => void } | null => {
    const s = dayNum(draft.planStart);
    const e = dayNum(draft.planEnd);
    if (s != null && e != null && e < s) {
      const label = isPlan ? 'Плановое возвращение рейса' : 'Плановое возвращение ручного рейса';
      return {
        message: 'Плановое возвращение не может быть раньше планового старта — изменения не сохранены.',
        focus: () => rootRef.current?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.focus(),
      };
    }
    if (isPlan && !canEditPlan && (draft.planStart !== baseline.draft.planStart || draft.planEnd !== baseline.draft.planEnd)) {
      return { message: 'Нет права редактирования «Плана дохода» — изменения не сохранены.', focus: () => {} };
    }
    if (planEnabled && planState === 'saved' && !isRootAdmin) {
      const blocked = computePlanStageChanges(trip.stages, draft.stages, {
        stored: normalizeCircles(trip.circles),
        draft: draft.circles,
      });
      if (blocked.count > 0) {
        return {
          message: 'Плановые даты этапов заблокированы — изменение доступно только с разового разрешения администратора.',
          focus: () => {},
        };
      }
    }
    return null;
  };

  /**
   * ЕДИНОЕ СОХРАНЕНИЕ ОКНА (кнопка «Сохранить», Enter, Ctrl/Cmd+S): всё
   * содержимое окна — поля рейса, плановые даты «Плана дохода», круги, запас,
   * этапы (добавленные/изменённые/удалённые) и состояние плана этапов —
   * записывается ОДНОЙ атомарной операцией: либо всё, либо ничего. Валидация —
   * до записи (фокус на первом невалидном поле); при ошибке окно остаётся
   * открытым с введёнными значениями, показывается причина и «Повторить»;
   * во время записи повторные Enter/клики игнорируются. Изменённые поля плана
   * фиксируются ФАКТИЧЕСКИМ механизмом контроля плана (planGuard/planPerms/
   * история): первичное сохранение черновика либо расход разового разрешения —
   * в ТОЙ ЖЕ атомарной записи.
   */
  const saveAll = async () => {
    if (readOnly || savingRef.current) return;
    const cardBlocks = changedBlocksOf(draft, metaDraft, baseline);
    if (!cardBlocks.length) {
      toast(
        journalDirtyRef.current
          ? 'В окне нет изменений для этой кнопки; текст журнала сохраняется кнопкой в журнале'
          : 'Изменений нет — сохранять нечего',
        'info',
      );
      return;
    }
    const issue = findValidationIssue();
    if (issue) {
      setSaveError(issue.message);
      toast(issue.message, 'error');
      issue.focus();
      return;
    }
    const perm = planLock.permission;
    const nowIso = new Date().toISOString();
    // Изменение количества кругов и состава этапов — тоже изменение плана
    // (участвует в счёте: разовое разрешение расходуется осознанно).
    const changes = computePlanStageChanges(trip.stages, draft.stages, {
      stored: normalizeCircles(trip.circles),
      draft: draft.circles,
    });
    /** Правки обычных полей этапов (факт, тип, место, крит. срок, порядок). */
    const fieldPatches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    draft.stages.forEach((s) => {
      const before = trip.stages.find((x) => x.id === s.id);
      if (!before) return; // добавленные этапы пишутся целиком через changes.adds
      const patch: Record<string, unknown> = {};
      if ((before.type || '') !== (s.type || '')) patch.type = s.type;
      if ((before.label || '') !== (s.label || '')) patch.label = s.label || '';
      if ((before.actualDate || '') !== (s.actualDate || '')) patch.actualDate = s.actualDate || '';
      if (!!before.isCritical !== !!s.isCritical) patch.isCritical = !!s.isCritical;
      if ((before.reason || '') !== (s.reason || '')) patch.reason = s.reason || '';
      if ((before.action || '') !== (s.action || '')) patch.action = s.action || '';
      if ((before.order || 0) !== (s.order || 0)) patch.order = s.order || 0;
      if (Object.keys(patch).length) fieldPatches.push({ id: s.id, patch });
    });
    const stagesTouched = changes.count > 0 || fieldPatches.length > 0;
    const datesChanged = draft.planStart !== baseline.draft.planStart || draft.planEnd !== baseline.draft.planEnd;
    const circlesChanged = draft.circles !== baseline.draft.circles;
    const metaChangedFields = (['comment', 'reason', 'measures'] as const).filter((k) => metaDraft[k] !== baseline.meta[k]);
    const detailsParts: string[] = [changes.count > 0 ? describePlanChanges(changes) : cardBlocks.join(', ')];
    if (metaChangedFields.length) detailsParts.push(`прежние тексты рейса: ${metaChangedFields.join(', ')}`);
    const details = detailsParts.join('; ');

    // ── Одна атомарная запись: все пути окна вместе ────────────────────────
    const updates: Record<string, unknown> = {};
    const isManual = !isPlan;
    const stagesBase = isPlan
      ? `tripTimeline/tripStages/${planSourceId}`
      : `tripTimeline/trips/${trip.id}/stages`;
    if (isManual) {
      const base = `tripTimeline/trips/${trip.id}`;
      if (draft.route !== baseline.draft.route) updates[`${base}/route`] = draft.route;
      if (draft.dispatcherId !== baseline.draft.dispatcherId || draft.dispatcherName !== baseline.draft.dispatcherName) {
        updates[`${base}/dispatcherId`] = draft.dispatcherId;
        updates[`${base}/dispatcherName`] = draft.dispatcherName;
      }
      if (draft.bufferDays !== baseline.draft.bufferDays) {
        updates[`${base}/bufferDays`] = Math.max(0, Number(String(draft.bufferDays).replace(',', '.')) || 0);
      }
      if (circlesChanged) updates[`${base}/circles`] = draft.circles;
      // Диапазон записи (startDate/endDate): явные плановые границы окна имеют
      // приоритет; без их правок диапазон пересчитывается по этапам (та же
      // функция «дата → диапазон», что и раньше).
      if (datesChanged) {
        updates[`${base}/startDate`] = draft.planStart;
        updates[`${base}/endDate`] = draft.planEnd;
      } else if (stagesTouched) {
        const range = computeStoredRange({ ...trip, stages: draft.stages });
        updates[`${base}/startDate`] = range.startDate || '';
        updates[`${base}/endDate`] = range.endDate || '';
      }
      updates[`${base}/updatedAt`] = nowIso;
    } else {
      const base = `trips_dashboard/${planSourceId}`;
      if (datesChanged) {
        // Тот же расчёт, что делает «План дохода» при правке дат (существующая
        // calculateTripFinances): дни — только при обеих датах, финансы — только
        // у записи, где они уже заполнены.
        const raw = (trip.planRaw || {}) as Record<string, unknown>;
        const s = dayNum(draft.planStart);
        const e = dayNum(draft.planEnd);
        const fin = calculateTripFinances(
          ((raw.legs as LegPlan[] | undefined) || []),
          draft.planStart,
          draft.planEnd,
          Number(raw.extraExpense) || 0,
          Number(raw.ferryCost) || 0,
          Number(raw.factKm) || 0,
        );
        updates[`${base}/dateStart`] = draft.planStart;
        updates[`${base}/dateEnd`] = draft.planEnd;
        if (s != null && e != null) updates[`${base}/days`] = fin.days;
        if (hasPlanFinancials(raw)) {
          updates[`${base}/totalKm`] = fin.totalKm;
          updates[`${base}/totalFreight`] = fin.totalFreight;
          updates[`${base}/totalExpenses`] = fin.totalExpensesFact;
          updates[`${base}/profit`] = fin.profitPlan;
          updates[`${base}/profitFact`] = fin.profitFact;
        }
      }
      if (circlesChanged) updates[`${base}/circles`] = draft.circles;
      if (datesChanged || circlesChanged) {
        updates[`${base}/updatedAt`] = new Date().toLocaleString('ru-RU');
        updates[`${base}/updatedBy`] = user.name;
      }
    }
    // Этапы: добавленные (целиком), изменённые (точечно), удалённые (null) —
    // той же операцией, что и всё остальное окно.
    changes.adds.forEach((s) => {
      updates[`${stagesBase}/${s.id}`] = { ...s };
    });
    fieldPatches.forEach(({ id, patch }) => {
      Object.entries(patch).forEach(([k, v]) => {
        updates[`${stagesBase}/${id}/${k}`] = v;
      });
    });
    changes.plannedUpdates.forEach((u) => {
      updates[`${stagesBase}/${u.id}/plannedDate`] = u.plannedDate;
    });
    changes.circleUpdates.forEach((u) => {
      updates[`${stagesBase}/${u.id}/circle`] = u.circle ?? null;
    });
    changes.removes.forEach((s) => {
      updates[`${stagesBase}/${s.id}`] = null;
    });
    // Прежние общие тексты рейса (комментарий/причина/меры) — из того же
    // черновика, чтобы «изменено» всегда сходилось с сохранённым.
    metaChangedFields.forEach((k) => {
      const v = String(metaDraft[k] || '').trim();
      updates[`tripTimeline/tripMeta/${trip.key}/${k}`] = v ? v : null;
    });

    savingRef.current = true;
    setSavingAll(true);
    setSaveError('');
    let permConsumedSnapshot: unknown = null;
    let permConsumed = false;
    try {
      // ── Фактический механизм контроля плана этапов ───────────────────────
      if (planEnabled && changes.count > 0) {
        const guardKey = `tripTimeline/planGuard/${planTripKey}`;
        if (planState === 'draft') {
          const fresh = await dbService.getTimelinePlanGuardOnce(planTripKey);
          if (fresh && fresh.initialSavedAt) {
            throw new Error('план уже сохранён другим пользователем — ничего не записано, обновите карточку (F5)');
          }
          updates[guardKey] = {
            version: 1,
            draftCreated: null,
            initialSavedAt: nowIso,
            initialSavedBy: user.name,
            ...(planUserId ? { initialSavedById: planUserId } : {}),
            updatedAt: nowIso,
            updatedBy: user.name,
            ...(planUserId ? { updatedById: planUserId } : {}),
            history: [
              {
                at: nowIso,
                by: user.name,
                ...(planUserId ? { byId: planUserId } : {}),
                action: 'initial',
                note: `Первичное сохранение плана этапов (этапов: ${draft.stages.filter((s) => !String(s.id).endsWith('-fallback-load')).length})`,
              },
            ],
          };
        } else if (perm || isRootAdmin) {
          const baseVersion = perm ? Number(perm.planVersion) : Number(planGuard?.version) || planLock.version || 1;
          const fresh = await dbService.getTimelinePlanGuardOnce(planTripKey);
          const freshVersion = Number(fresh?.version) || (fresh?.initialSavedAt ? 1 : baseVersion);
          if (fresh && freshVersion !== baseVersion) {
            throw new Error(
              `план изменился с момента открытия (версия ${freshVersion} вместо ${baseVersion}) — ничего не записано, чтобы не перезаписать чужие изменения; обновите данные (F5)`,
            );
          }
          if (perm) {
            const consumed = await dbService.consumeTimelinePlanPermission(planTripKey, planUserId);
            if (!consumed.ok) {
              throw new Error(
                consumed.reason === 'failed'
                  ? 'не удалось погасить разрешение (ошибка сети или записи) — ничего не записано, разрешение НЕ израсходовано, повторите сохранение'
                  : 'разрешение уже использовано другим сохранением или отозвано — обновите данные',
              );
            }
            permConsumed = true;
            permConsumedSnapshot = consumed.snapshot ?? null;
            updates[`tripTimeline/planPerms/${planTripKey}/${planUserId}`] = null;
          }
          updates[guardKey] = {
            ...(planGuard || {}),
            version: baseVersion + 1,
            ...(planGuard?.initialSavedAt ? { initialSavedAt: planGuard.initialSavedAt } : {}),
            ...(planGuard?.initialSavedBy ? { initialSavedBy: planGuard.initialSavedBy } : {}),
            ...(planGuard?.initialSavedById ? { initialSavedById: planGuard.initialSavedById } : {}),
            ...(planLock.legacy || planGuard?.legacy ? { legacy: true } : {}),
            updatedAt: nowIso,
            updatedBy: user.name,
            ...(planUserId ? { updatedById: planUserId } : {}),
            history: nextPlanHistory(perm ? 'update' : 'admin-update', details),
          };
        } else {
          throw new Error('плановые даты этапов заблокированы — нужно разовое разрешение администратора');
        }
      }

      await dbService.saveTimelineWindowCommit(updates, user.name, user.role, details);

      // Успех: базовое состояние обновляем ТОЛЬКО здесь (по факту записи) —
      // «есть несохранённые изменения» сбрасывается, окно остаётся открытым.
      setBaseline({ draft: { ...draft, stages: draft.stages.map((s) => ({ ...s })) }, meta: { ...metaDraft } });
      if (permConsumed) {
        dbService.markTimelinePlanRequestUsed(planTripKey, planUserId, { byName: user.name, byId: planUserId });
      }
      setSavedFlash(true);
      if (savedFlashTimer.current !== null) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 4000);
      let message: string;
      if (isPlan) {
        if (datesChanged && stagesTouched) message = 'Рейс сохранён. Плановые даты и этапы обновлены в плане дохода';
        else if (datesChanged) message = 'Рейс сохранён. Плановые даты обновлены в плане дохода';
        else if (stagesTouched) message = 'Рейс сохранён. Этапы обновлены в плане дохода';
        else message = 'Рейс сохранён';
      } else {
        message = stagesTouched ? 'Рейс сохранён. Этапы записаны' : 'Рейс сохранён';
      }
      toast(message, 'success');
    } catch (err) {
      if (permConsumed && permConsumedSnapshot) {
        await dbService.restoreTimelinePlanPermission(planTripKey, planUserId, permConsumedSnapshot);
      }
      const reason = ((err as Error)?.message || String(err) || '').trim();
      const message = `Не удалось сохранить: ${reason}. Введённые данные остались в окне — повторите сохранение.`;
      setSaveError(message);
      toast(message, 'error', { label: 'Повторить', onClick: () => void saveAllRef.current() });
    } finally {
      savingRef.current = false;
      setSavingAll(false);
    }
  };
  saveAllRef.current = () => void saveAll();

  /** Выдача разового разрешения (администратор): пользователь + текущая версия плана. */
  const grantPlanPermission = async () => {
    if (!isRootAdmin) return;
    const sel = dispatchers.find((d) => d.id === grantUserId);
    if (!sel) {
      toast('Выберите пользователя для разрешения', 'error');
      return;
    }
    if (planLock.permissions[sel.id]) {
      const ok = await showConfirm(`У ${sel.name} уже есть действующее разрешение на этот рейс. Заменить его новым?`);
      if (!ok) return;
    }
    const version = Number(planGuard?.version) || planLock.version || 1;
    dbService.grantTimelinePlanPermission(
      planTripKey,
      {
        userId: sel.id,
        userName: sel.name,
        grantedAt: new Date().toISOString(),
        grantedBy: user.name,
        ...(planUserId ? { grantedById: planUserId } : {}),
        planVersion: version,
      },
      planLock.history,
      user.name,
      user.role,
    );
    // История запросов: прямая выдача — та же запись со статусом «одобрен»
    // (источник: администратор) + уведомление пользователю. Один механизм.
    dbService.recordDirectPlanGrant({
      tripKey: planTripKey,
      userId: sel.id,
      userName: sel.name,
      carNumber: trip.carNumber || '',
      route: draft.route || trip.plan?.direction || '',
      byName: user.name,
      ...(planUserId ? { byId: planUserId } : {}),
      planVersion: version,
    });
    setGrantOpen(false);
    toast(`Разрешено одно изменение плана: ${sel.name}`, 'success');
  };

  const revokePlanPermission = async (uid: string, name: string) => {
    if (!isRootAdmin) return;
    const ok = await showConfirm(`Отозвать неиспользованное разрешение для ${name}?`);
    if (!ok) return;
    dbService.revokeTimelinePlanPermission(planTripKey, uid, planLock.history, user.name, user.role, planUserId);
    toast('Разрешение отозвано', 'success');
  };

  const draftTrip: WholeTrip = useMemo(
    () => ({
      ...trip,
      route: draft.route,
      dispatcherId: draft.dispatcherId,
      dispatcherName: draft.dispatcherName,
      bufferDays: Math.max(0, Number(String(draft.bufferDays).replace(',', '.')) || 0),
      stages: draft.stages,
      circles: draft.circles,
      spanOverride: {
        pMin: dayNum(draft.planStart) ?? trip.spanOverride?.pMin ?? null,
        pMax: dayNum(draft.planEnd) ?? trip.spanOverride?.pMax ?? null,
      },
    }),
    [trip, draft],
  );

  const status = getDeadlineStatus(draftTrip, today, (s) => stageFullName(stageTypes, s));
  const tone = STATUS_TONE[status.level] || STATUS_TONE[0];
  const dispatcherShown = dispatchers.find((d) => d.id === draft.dispatcherId)?.name || draft.dispatcherName || 'Не указано';

  const span = tripSpan(draftTrip);
  const planStart = span.pMin;
  const planEnd = span.pMax;
  const factStart = span.fMin;
  const factReturn = tripFactEnd(draftTrip);
  const ongoing = isTripFactOngoing(draftTrip);
  const hasFact = factStart != null;
  const cmpStart = comparePlanFact(planStart, factStart);
  const cmpEnd = comparePlanFact(planEnd, factReturn);
  const planEndPassed = planEnd != null && planEnd < today;
  const weekendInside = hasWeekendInRange(planStart, planEnd);
  const factNeg = factReturn != null && factStart != null && factReturn < factStart;

  const cmpText = (c: { label: string; diffDays: number | null }): string => {
    if (c.label === 'Нет фактических данных') return c.label;
    if (c.diffDays == null || c.diffDays === 0) return c.label;
    return `${c.label} на ${Math.abs(c.diffDays)} дн`;
  };

  // ── Правки копятся ЛОКАЛЬНО в черновике окна и записываются единственной
  //    кнопкой «Сохранить» одной атомарной операцией (см. saveAll). Промежуточных
  //    записей «часть сохранена» нет: база меняется только по кнопке.

  const onRouteChange = (v: string) => {
    setDraft((d) => ({ ...d, route: v }));
  };

  const onDispatcherChange = (id: string) => {
    const disp = dispatchers.find((d) => d.id === id);
    setDraft((d) => ({ ...d, dispatcherId: id, dispatcherName: disp ? disp.name : '' }));
  };

  const onBufferChange = (v: string) => {
    setDraft((d) => ({ ...d, bufferDays: v }));
  };

  const onStageField = (stageId: string, field: keyof TimelineStage, value: string | boolean) => {
    if (field === 'plannedDate' && !canEditPlanned) return;
    setDraft((d) => ({ ...d, stages: d.stages.map((s) => (s.id === stageId ? { ...s, [field]: value } : s)) }));
  };

  /**
   * Привязка ЭТАПА к кругу рейса (номер 1..N; 0 — снять привязку). Это часть
   * плана: изменение уходит в базу кнопкой «Сохранить» (после сохранения плана —
   * с разовым разрешением администратора, гейт canEditPlanned).
   */
  const onStageCircle = (stageId: string, n: number) => {
    if (readOnly || !canEditPlanned) return;
    const value = Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
    setDraft((d) => ({
      ...d,
      stages: d.stages.map((s) => (s.id === stageId ? { ...s, circle: value != null ? value : undefined } : s)),
    }));
  };

  /**
   * «Количество кругов» рейса — целое от 1. Часть плана: пишется в ту же запись
   * рейса («План дохода» trips_dashboard / ручной рейс) кнопкой «Сохранить».
   * Копий поля нет — таймлайн и «План дохода» показывают одну запись.
   */
  const onCirclesChange = (next: number) => {
    if (readOnly || !canEditPlanned) return;
    const n = Math.max(1, Math.floor(Number(next)) || 1);
    if (n === draft.circles) return;
    setDraft((d) => ({ ...d, circles: n }));
  };

  /** Кнопка «Добавить этап»: этап копится в черновике и сохраняется кнопкой. */
  const addStage = () => {
    if (!canEditPlanned) return;
    const sid = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const order = (draft.stages.length ? Math.max(...draft.stages.map((s) => s.order || 0)) : 0) + 1;
    const stage: TimelineStage = {
      id: sid,
      type: 'other',
      label: '',
      plannedDate: '',
      actualDate: '',
      isCritical: false,
      reason: '',
      action: '',
      order,
    };
    setDraft((d) => ({ ...d, stages: [...d.stages, stage] }));
  };

  /** Удаление этапа из черновика (в базу — той же кнопкой «Сохранить»). */
  const removeStage = (stageId: string) => {
    if (!canEditPlanned) return;
    setDraft((d) => ({ ...d, stages: d.stages.filter((s) => s.id !== stageId) }));
  };

  /** Клик по маркеру этапа на встроенном таймлайне: прокрутка к этапу и
   *  краткая подсветка строки в верхнем блоке (без вложенных модалок). */
  const focusStage = useCallback(
    (stageId: string) => {
      setHighlightStage(stageId);
      window.requestAnimationFrame(() => {
        const row = rootRef.current?.querySelector(`[data-stage="${stageId}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      window.setTimeout(() => setHighlightStage((cur) => (cur === stageId ? null : cur)), 1800);
    },
    [],
  );

  /** Переход с заливки этапа на полотне: выделить этап в таблице и прокрутить к нему. */
  useEffect(() => {
    if (!focusStageId) return;
    focusStage(focusStageId);
    onFocusStageDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStageId]);

  const requestDelete = async () => {
    const ok = await showConfirm(`Удалить рейс ${formatPlate(trip.carNumber)} — ${draft.route || 'без маршрута'}?`);
    if (!ok) return;
    onDelete?.(trip);
  };

  /** Есть несохранённые изменения ПЛАНА (плановая дата/состав/круги) — индикатор. */
  const planDirtyNow = useMemo(
    () =>
      computePlanStageChanges(trip.stages, draft.stages, {
        stored: normalizeCircles(trip.circles),
        draft: draft.circles,
      }).count > 0,
    [trip.stages, trip.circles, draft.stages, draft.circles],
  );

  const outOfBounds = draft.stages.filter((s) => {
    const pd = dayNum(s.plannedDate);
    const ad = dayNum(s.actualDate);
    return (
      planStart != null &&
      planEnd != null &&
      ((pd != null && (pd < planStart || pd > planEnd)) || (ad != null && (ad < planStart || ad > planEnd)))
    );
  });

  const plan = trip.plan;
  const title = `${formatPlate(trip.carNumber)} · ${draft.route || plan?.direction || 'маршрут не указан'}`;

  return (
    <ModalShell
      isOpen
      onClose={requestClose}
      title={title}
      subtitle={`${isPlan ? 'Рейс из «Плана дохода»' : 'Ручной рейс'}${archived ? ' · архив (просмотр)' : ''} · ${dispatcherShown}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel={`Рейс ${title}`}
      closeTitle="Закрыть · Esc"
      hotkeysManaged
      maxWidth="max-w-[min(1440px,94vw)]"
      footer={
        <div className="flex flex-col gap-2 w-full">
          {/* Ошибка единого сохранения: причина + «Повторить»; данные остаются в окне. */}
          {saveError ? (
            <div data-ui="trip-save-error" role="alert" className={`${UI.errorBox} flex items-center gap-2`}>
              <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{saveError}</span>
              <button
                type="button"
                data-ui="trip-save-retry"
                disabled={savingAll}
                onClick={() => void saveAllRef.current()}
                className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-rose-200 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
              >
                Повторить
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 w-full">
            {!isPlan && canWrite ? (
              <>
                <button
                  type="button"
                  data-ui="trip-archive"
                  title="Для рейсов из «Плана дохода» архивный статус изменяется в плане дохода; здесь — только ручной рейс"
                  onClick={() => onArchiveToggle?.(trip)}
                  className={UI.buttonGhost}
                >
                  <Archive className="w-4 h-4" aria-hidden="true" />
                  {archived ? 'Вернуть из архива (ручной рейс)' : 'В архив (ручной рейс)'}
                </button>
                <button type="button" data-ui="trip-delete" onClick={requestDelete} className={UI.buttonDanger}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Удалить рейс
                </button>
              </>
            ) : null}
            <span className="text-[10px] text-[#6B7280] min-h-[16px] ml-auto flex items-center gap-2">
              {isDirty ? (
                <span className="text-amber-700 font-semibold">
                  {journalDirty && !dirtyBlocks.some((b) => !b.startsWith('текст в форме журнала')) ? 'есть несохранённый текст в журнале событий' : 'есть несохранённые изменения'}
                </span>
              ) : null}
              <span className="text-emerald-600">{savedFlash ? 'Сохранено ✓' : ''}</span>
              {!readOnly ? (
                <button
                  type="button"
                  data-ui="trip-save"
                  disabled={savingAll}
                  title="Сохранить всё окно одной операцией · Enter (Ctrl/Cmd+S — сохранить без закрытия)"
                  onClick={() => void saveAllRef.current()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                >
                  {savingAll ? (
                    <>
                      <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
                      Сохраняется…
                    </>
                  ) : (
                    'Сохранить'
                  )}
                </button>
              ) : null}
            </span>
          </div>
        </div>
      }
    >
      <div ref={rootRef} data-atrip={trip.key} className="flex flex-col gap-4">
        {trip.hiddenFromTimeline ? (
          <div
            data-ui="trip-hidden-notice"
            role="note"
            className="flex items-start gap-2.5 rounded-xl border border-[#CBD5E1] bg-[#F4F6F9] px-3 py-2.5"
          >
            <EyeOff className="w-4 h-4 mt-[1px] shrink-0 text-[#64748B]" aria-hidden="true" />
            <div className="flex flex-col gap-1 text-[11px] leading-[15px] text-[#334155]">
              <span className="font-semibold text-[#121316]">Рейс скрыт на таймлайне как дубль</span>
              <span>
                {trip.hiddenInfo?.reason ? `Причина: ${trip.hiddenInfo.reason}. ` : ''}
                {trip.hiddenInfo?.duplicate
                  ? `Основная (живая) запись — «${trip.hiddenInfo.duplicate.carNumber}», ${fmtFull(trip.hiddenInfo.duplicate.dateStart)} — ${fmtFull(trip.hiddenInfo.duplicate.dateEnd)}${trip.hiddenInfo.duplicate.archived ? ' (в архиве)' : ''}. `
                  : ''}
                Запись не удалена и по-прежнему видна в «Плане дохода»; в полосах, счётчиках и конфликтах таймлайна она не участвует.
              </span>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          <span className={`inline-flex items-center gap-1.5 ${tone.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
            {status.label}
          </span>
          {isPlan ? <span className={UI.chip}>из Плана дохода · #{planSourceId}</span> : <span className={UI.chip}>ручной рейс</span>}
          {archived ? <span className={UI.chip}>архив — просмотр</span> : null}
          {weekendInside ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#6B7280]">
              <CalendarClock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
              в периоде рейса есть выходные — проверьте график работы объектов
            </span>
          ) : null}
          {trip.warnings.length ? (
            <span title={trip.warnings.join('\n')} className="inline-flex items-center gap-1 text-[10px] text-amber-700">
              <TriangleAlert className="w-3 h-3" aria-hidden="true" /> предупреждения: {trip.warnings.length}
            </span>
          ) : null}
        </div>

        {/* Управление ручным рейсом */}
        {!isPlan ? (
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>Маршрут</label>
              <input type="text" value={draft.route} disabled={readOnly} onChange={(e) => onRouteChange(e.target.value)} placeholder="Минск — Алматы" className={`${UI.inputSm} w-[240px]`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>Диспетчер</label>
              <select
                value={draft.dispatcherId}
                disabled={readOnly}
                onChange={(e) => onDispatcherChange(e.target.value)}
                className="bg-white border border-[#E5E7EB] rounded-xl px-2.5 py-1.5 text-xs text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] disabled:opacity-60"
              >
                <option value="">— не указан —</option>
                {dispatchers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>Запас, дней</label>
              <input type="number" min={0} value={draft.bufferDays} disabled={readOnly} onChange={(e) => onBufferChange(e.target.value)} className={`${UI.inputSm} w-[80px]`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>Плановые границы (в записи ручного рейса)</label>
              <div className="flex flex-wrap items-center gap-1.5">
                <DateInput value={draft.planStart} disabled={readOnly} ariaLabel="Плановый старт ручного рейса" onChange={(v) => setDraft((d) => ({ ...d, planStart: v }))} />
                <DateInput value={draft.planEnd} disabled={readOnly} ariaLabel="Плановое возвращение ручного рейса" onChange={(v) => setDraft((d) => ({ ...d, planEnd: v }))} />
                <span className="text-[10px] text-[#6B7280]">Изменения сохранятся кнопкой «Сохранить» внизу</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Блок Б: Точки и этапы: план / факт — сразу под шапкой, без вкладок */}
        <div className="flex items-center justify-between gap-2">
          <span className={UI.sectionTitle}>Точки и этапы: план / факт</span>
          <span className="text-[10px] text-[#9CA3AF]">план и факт рядом; отсутствие факта не считается задержкой</span>
        </div>

        {/* Состояние плана этапов: черновик / сохранён (заблокирован) / разовое разрешение */}
        {planEnabled ? (
          <div data-ui="plan-state" data-state={planState} className="border border-[#E5E7EB] rounded-xl px-3 py-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  planState === 'draft' ? 'text-amber-700' : planState === 'permitted' ? 'text-[var(--accent-ink)]' : 'text-[#4B5563]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${planState === 'draft' ? 'bg-amber-500' : planState === 'permitted' ? 'bg-[var(--accent)]' : 'bg-emerald-500'}`}
                  aria-hidden="true"
                />
                {planState === 'draft'
                  ? 'Черновик плана'
                  : planState === 'permitted'
                    ? 'Разрешено одно сохранение изменений'
                    : 'План сохранён. Плановые даты этапов заблокированы'}
              </span>
              {planState === 'draft' ? (
                <span className="text-[#6B7280]">перед первым сохранением: после сохранения изменение плановых дат этапов будет доступно только с разового разрешения администратора</span>
              ) : null}
              {planState === 'permitted' ? (
                <span className="text-[#6B7280]">после успешного сохранения плановые даты снова будут заблокированы</span>
              ) : null}
              {planState === 'saved' && planLock.legacy ? (
                <span className="text-[#6B7280]">автор и дата первоначального сохранения неизвестны — план существовал до включения контроля</span>
              ) : null}
              {planState === 'saved' && !planLock.legacy && planLock.initialSavedBy ? (
                <span className="text-[#6B7280]">
                  сохранён: {planLock.initialSavedBy}
                  {planLock.initialSavedAt ? `, ${fmtFull(planLock.initialSavedAt.slice(0, 10))}` : ''}
                </span>
              ) : null}
              {planState === 'saved' && !readOnly && !isRootAdmin ? (
                <span className="text-[#6B7280]">изменение плановых дат — только с разового разрешения администратора</span>
              ) : null}
              {/* Запрос разового доступа: диспетчер при заблокированном плане.
                  Одна запись на пару (рейс, пользователь); пока ожидает решения —
                  повторный запрос запрещён; после решения кнопка снова доступна. */}
              {showRequestAccess ? (
                <>
                  {myPlanRequest?.status === 'pending' ? (
                    <span data-ui="plan-request-pending" className="text-amber-700 font-semibold">
                      Запрос отправлен. Ожидается решение администратора
                      {myPlanRequest.createdAt ? ` (${fmtFull(myPlanRequest.createdAt.slice(0, 10))})` : ''}
                    </span>
                  ) : (
                    <>
                      {myPlanRequest?.status === 'rejected' ? (
                        <span data-ui="plan-request-rejected" className="text-rose-600">
                          Запрос отклонён{myPlanRequest.decisionComment ? `: ${myPlanRequest.decisionComment}` : ''} — план остаётся заблокированным
                        </span>
                      ) : null}
                      {myPlanRequest?.status === 'used' ? (
                        <span data-ui="plan-request-used" className="text-[#6B7280]">
                          Разрешение использовано — план снова заблокирован
                        </span>
                      ) : null}
                      {myPlanRequest?.status === 'revoked' ? (
                        <span data-ui="plan-request-revoked" className="text-[#6B7280]">
                          Ранее выданное разрешение отозвано администратором
                        </span>
                      ) : null}
                      {myPlanRequest?.status === 'approved' ? null : (
                        <button
                          type="button"
                          data-ui="plan-request-open"
                          onClick={() => setRequestFormOpen((v) => !v)}
                          className={UI.buttonGhost}
                        >
                          Запросить разовый доступ
                        </button>
                      )}
                    </>
                  )}
                </>
              ) : null}
              {planState === 'saved' && isRootAdmin && !readOnly ? (
                <span className="text-[#6B7280]">root-администратор может изменить план без разрешения</span>
              ) : null}
              {planDirtyNow ? (
                <span data-ui="plan-dirty-hint" className="text-amber-700 font-semibold">
                  изменения плана не сохранены — записываются кнопкой «Сохранить» внизу
                </span>
              ) : null}
            </div>
            {/* Форма запроса разового доступа: пояснение, причина, отправка. */}
            {showRequestAccess && requestFormOpen ? (
              <div data-ui="plan-request-form" className="border border-[#E5E7EB] rounded-xl px-3 py-2 flex flex-col gap-2">
                <span className="text-[11px] text-[#6B7280]">
                  Доступ позволит один раз сохранить изменения плана этапов этого рейса. Запрос автоматически связан с этим рейсом, вами и текущей сохранённой версией плана (v{planLock.version}).
                </span>
                <label className={UI.fieldLabel}>Причина запроса (необязательно)</label>
                <textarea
                  data-ui="plan-request-reason"
                  rows={2}
                  value={requestReason}
                  disabled={requestSending}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="Например: уточнена дата границы — перенос на 2 дня"
                  className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] outline-none resize-y focus:border-[var(--accent)] disabled:opacity-60"
                />
                {requestError ? (
                  <div className={UI.errorBox} role="alert">{requestError}</div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" data-ui="plan-request-submit" disabled={requestSending} onClick={submitPlanRequest} className={UI.buttonPrimary}>
                    {requestSending ? 'Отправляется…' : 'Отправить запрос'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRequestFormOpen(false);
                      setRequestError('');
                    }}
                    className={UI.buttonGhost}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
            {isRootAdmin && !readOnly && planState !== 'draft' ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button type="button" data-ui="grant-plan-perm" onClick={() => setGrantOpen((v) => !v)} className={UI.buttonGhost}>
                  Разрешить одно изменение плана
                </button>
                {grantOpen ? (
                  <>
                    <select
                      data-ui="grant-plan-user"
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(e.target.value)}
                      className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)]"
                    >
                      <option value="">— выберите пользователя —</option>
                      {dispatchers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" data-ui="grant-plan-confirm" onClick={grantPlanPermission} className={UI.buttonPrimary}>
                      Выдать разрешение
                    </button>
                    <span className="text-[10px] text-[#9CA3AF]">действует для одного рейса и одного пользователя; после успешного сохранения сгорает</span>
                  </>
                ) : null}
                {Object.values(planLock.permissions).length ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {Object.values(planLock.permissions).map((p) => (
                      <span key={p.userId} data-ui="plan-perm-row" className="inline-flex items-center gap-2 border border-[#E5E7EB] rounded-lg px-2 py-1">
                        <span className="text-[#4B5563]">
                          действует: {p.userName} · выдано {fmtFull((p.grantedAt || '').slice(0, 10))} · {p.grantedBy}
                        </span>
                        <button
                          type="button"
                          data-ui="revoke-plan-perm"
                          data-uid={p.userId}
                          onClick={() => revokePlanPermission(p.userId, p.userName)}
                          className="text-rose-600 hover:underline cursor-pointer"
                        >
                          Отозвать
                        </button>
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            ) : null}
            {planLock.history.length ? (
              <details className="text-[11px] text-[#6B7280]">
                <summary className="cursor-pointer select-none" data-ui="plan-history-toggle">
                  История плана ({planLock.history.length})
                </summary>
                <div className="flex flex-col gap-0.5 pt-1">
                  {[...planLock.history].reverse().map((h, i) => (
                    <span key={`${h.at}-${i}`} data-ui="plan-history-row">
                      {h.at ? fmtFull(h.at.slice(0, 10)) : '—'} · {PLAN_HISTORY_LABELS[h.action] || h.action} — {h.by}
                      {h.note ? ` · ${h.note}` : ''}
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {/* Круги рейса: количество кругов — часть плана (изменение считается
            изменением плана). ОДНО поле записи рейса: правится и здесь, и в
            «Плане дохода» — копий нет. Для рейса с 2+ кругами этапы
            распределяются по кругам в колонке «Круг» таблицы этапов ниже. */}
        <div
          data-ui="trip-circles"
          data-circles={draft.circles}
          className="border border-[#E5E7EB] rounded-xl px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]"
        >
          <span className="font-semibold text-[#121316]">Круги рейса</span>
          {!readOnly && canEditPlanned ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                data-ui="circles-dec"
                aria-label="Уменьшить количество кругов"
                disabled={draft.circles <= 1}
                onClick={() => onCirclesChange(draft.circles - 1)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] text-sm font-semibold hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer"
              >
                −
              </button>
              <span
                data-ui="circles-value"
                aria-live="polite"
                className="inline-flex items-center justify-center min-w-[26px] h-6 rounded-lg border border-[#E5E7EB] bg-white text-xs font-semibold text-[#121316] tabular-nums"
              >
                {draft.circles}
              </span>
              <button
                type="button"
                data-ui="circles-inc"
                aria-label="Увеличить количество кругов"
                onClick={() => onCirclesChange(draft.circles + 1)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] text-sm font-semibold hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                +
              </button>
            </span>
          ) : (
            <span
              data-ui="circles-value"
              className="inline-flex items-center justify-center min-w-[26px] h-6 px-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold text-[#121316] tabular-nums"
            >
              {draft.circles}
            </span>
          )}
          <span className="text-[#6B7280]">
            {draft.circles >= 2
              ? 'этапы распределяются по кругам — колонка «Круг» в таблице этапов ниже'
              : 'количество кругов у рейса; задаётся здесь и в «Плане дохода» — одна запись, без копий'}
          </span>
          {!readOnly && planEnabled && planState === 'saved' && !canEditPlanned ? (
            <span className="text-amber-700">изменение количества кругов — изменение плана: нужно разовое разрешение администратора</span>
          ) : null}
          {!readOnly && planEnabled && planState !== 'draft' && canEditPlanned ? (
            <span className="text-[#6B7280]">изменение сохранится кнопкой «Сохранить» внизу</span>
          ) : null}
        </div>

        {/* План и факт: границы и сравнение */}
        <div data-ui="trip-bounds" className="border border-[#E5E7EB] rounded-xl overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-3 text-[11px]">
            <div className="px-3 py-2 bg-[#F9FAFB] text-[#6B7280] font-semibold">Границы</div>
            <div className="px-3 py-2 bg-[#F9FAFB] text-[#6B7280] font-semibold">По плану</div>
            <div className="px-3 py-2 bg-[#F9FAFB] text-[#6B7280] font-semibold">Факт / сравнение</div>
            <div className="px-3 py-2 text-[#4B5563]">Старт</div>
            <div className="px-3 py-2">
              {isPlan && !readOnly && canEditPlan ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#6B7280]">старт</span>
                  <DateInput value={draft.planStart} disabled={savingAll} ariaLabel="Плановый старт рейса" onChange={(v) => setDraft((d) => ({ ...d, planStart: v }))} />
                </div>
              ) : (
                <span className="text-[#121316]">{planStart != null ? fmtFull(isoOf(planStart)) : 'Не указано'}</span>
              )}
            </div>
            <div className="px-3 py-2">
              {factStart != null ? (
                <span className={cmpStart.diffDays ? (cmpStart.diffDays > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold') : 'text-[#4B5563]'}>
                  {fmtFull(isoOf(factStart))} · {cmpText(cmpStart)}
                </span>
              ) : (
                <span className="text-[#9CA3AF]">{planStart != null && planStart < today ? 'Плановая дата прошла, факт не указан' : 'Нет фактических данных'}</span>
              )}
            </div>
            <div className="px-3 py-2 text-[#4B5563] border-t border-[#E5E7EB]">Возвращение</div>
            <div className="px-3 py-2 border-t border-[#E5E7EB]">
              {isPlan && !readOnly && canEditPlan ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#6B7280]">возврат</span>
                  <DateInput value={draft.planEnd} disabled={savingAll} ariaLabel="Плановое возвращение рейса" onChange={(v) => setDraft((d) => ({ ...d, planEnd: v }))} />
                </div>
              ) : (
                <span className="text-[#121316]">{planEnd != null ? fmtFull(isoOf(planEnd)) : 'Не указано'}</span>
              )}
            </div>
            <div className="px-3 py-2 border-t border-[#E5E7EB]">
              {factReturn != null ? (
                <span className={cmpEnd.diffDays ? (cmpEnd.diffDays > 0 ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-semibold') : 'text-[#4B5563]'}>
                  {fmtFull(isoOf(factReturn))} · {cmpText(cmpEnd)}
                </span>
              ) : ongoing ? (
                <span className="text-[#B45309]">Факт продолжается: окончание не указано</span>
              ) : (
                <span className="text-[#9CA3AF]">{planEnd != null && planEndPassed ? 'Плановая дата прошла, факт не указан' : 'Нет фактических данных'}</span>
              )}
            </div>
          </div>
          <div className="px-3 py-2 border-t border-[#E5E7EB] text-[11px] text-[#6B7280]">
            Факт: {hasFact ? `${fmtFull(isoOf(factStart))} – ${factReturn != null ? fmtFull(isoOf(factReturn)) : 'окончание не указано'}` : 'Нет фактических данных'}
            {factNeg ? ' · фактическое окончание раньше фактического начала — проверьте события' : ''}
          </div>
          {isPlan && !readOnly && canEditPlan ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-[#6B7280]">
                Изменения сохранятся кнопкой «Сохранить» внизу — плановые даты запишутся в «План дохода» той же операцией.
                План и факт не смешиваются: фактические даты этим не меняются. Этапы автоматически не сдвигаются — при расхождении появится предупреждение.
              </span>
            </div>
          ) : isPlan && !readOnly && !canEditPlan ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] text-[10px] text-[#6B7280]">
              Нет права редактирования «Плана дохода» — плановые даты показаны только для просмотра.
            </div>
          ) : null}
        </div>

        {/* Предупреждения */}
        {trip.warnings.length || outOfBounds.length ? (
          <div className={UI.errorBox} role="alert">
            <div className="flex flex-col gap-1">
              {trip.warnings.map((w) => (
                <span key={w}>• {w}</span>
              ))}
              {outOfBounds.length ? (
                <span>
                  • Этапы вне границ рейса ({outOfBounds.length}): {outOfBounds.map((s) => stageFullName(stageTypes, s)).join(', ')} — даты не переносились автоматически
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Этапы: план и факт рядом (главный блок) */}
        <div data-ui="stages-table" className="w-full overflow-x-auto">
          <table className="w-full text-left min-w-[880px]">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Этап</th>
                <th className={UI.th} title="Город, адрес, объект или другое место выполнения этапа — свободный ввод с подсказками городов портала">Место</th>
                <th className={UI.th}>План</th>
                <th className={UI.th}>Факт</th>
                <th className={UI.th}>Отклонение / состояние</th>
                <th className={UI.th}>Крит. срок</th>
                {draft.circles >= 2 ? (
                  <th className={UI.th} title="Привязка этапа к кругу рейса (для рейса с 2+ кругами): засечки кругов на полосе строятся по датам распределённых этапов">
                    Круг
                  </th>
                ) : null}
                <th className={UI.th}>События этапа</th>
                <th className={UI.th}>{''}</th>
              </tr>
            </thead>
            <tbody>
              {draft.stages.map((s) => {
                const dev = stageDeviation(s);
                const pDay = dayNum(s.plannedDate);
                const fDay = dayNum(s.actualDate);
                const hasText = !!(s.reason || s.action);
                const stState = stageStateOf(s, today);
                const stageEvents = carEvents.filter((e) => e.tripKey === trip.key && e.stageId === s.id).length;
                return (
                  <React.Fragment key={s.id}>
                    <tr data-stage={s.id} data-stage-highlighted={highlightStage === s.id ? '1' : undefined} className={`border-b border-[#E5E7EB] transition-colors ${highlightStage === s.id ? 'bg-[var(--accent-10)] ring-1 ring-inset ring-[var(--accent-30)]' : ''}`}>
                      <td className="px-2 py-1.5 align-middle">
                        <select
                          value={s.type}
                          disabled={readOnly}
                          onChange={(e) => onStageField(s.id, 'type', e.target.value)}
                          className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none cursor-pointer focus:border-[var(--accent)] disabled:opacity-60 max-w-[180px]"
                        >
                          {stageTypes.map((t) => (
                            <option key={t.key} value={t.key}>{t.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <CityAutocomplete
                          value={s.label || ''}
                          disabled={readOnly}
                          onChange={(v) => onStageField(s.id, 'label', v)}
                          placeholder="город, адрес или объект"
                          cities={cities}
                          className={`${UI.inputSm} w-[160px]`}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center gap-1">
                          <span
                            title={
                              readOnly || canEditPlanned
                                ? undefined
                                : 'Плановые даты этапов заблокированы после сохранения плана — разблокировка только с разового разрешения администратора'
                            }
                          >
                            <DateInput value={s.plannedDate || ''} disabled={readOnly || !canEditPlanned} ariaLabel="Плановая дата этапа" onChange={(v) => onStageField(s.id, 'plannedDate', v)} />
                          </span>
                          {pDay != null && isWeekendDay(pDay) ? (
                            <span title={WEEKEND_HINT} aria-label={WEEKEND_HINT} className="shrink-0">
                              <CalendarClock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center gap-1">
                          <DateInput value={s.actualDate || ''} disabled={readOnly} ariaLabel="Фактическая дата этапа" onChange={(v) => onStageField(s.id, 'actualDate', v)} />
                          {fDay != null && isWeekendDay(fDay) ? (
                            <span title={WEEKEND_HINT} aria-label={WEEKEND_HINT} className="shrink-0">
                              <CalendarClock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          {dev != null ? (
                            <span className={`text-[11px] font-semibold ${dev > 0 ? 'text-rose-600' : dev < 0 ? 'text-emerald-600' : 'text-[#6B7280]'}`}>
                              {fmtDev(dev)}
                            </span>
                          ) : null}
                          <span
                            className={`text-[10px] ${
                              stState.code === 'late' ? 'text-rose-600' : stState.code === 'early' ? 'text-emerald-600' : 'text-[#6B7280]'
                            }`}
                          >
                            {stState.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            data-ck="critical"
                            checked={!!s.isCritical}
                            disabled={readOnly}
                            onChange={(e) => onStageField(s.id, 'isCritical', e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
                          />
                          {s.isCritical ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 whitespace-nowrap">
                              <Flag className="w-3 h-3" aria-hidden="true" />
                              крит
                            </span>
                          ) : null}
                        </label>
                      </td>
                      {draft.circles >= 2 ? (
                        <td className="px-2 py-1.5 align-middle">
                          <select
                            data-ui="stage-circle"
                            data-stage-circle={s.id}
                            value={s.circle && s.circle >= 1 && s.circle <= draft.circles ? String(s.circle) : ''}
                            disabled={readOnly || !canEditPlanned}
                            title={
                              readOnly || canEditPlanned
                                ? 'Круг этапа: номер круга рейса (пусто — этап не распределён по кругам)'
                                : 'Распределение этапов по кругам — часть плана: после сохранения доступно только с разового разрешения администратора'
                            }
                            onChange={(e) => onStageCircle(s.id, e.target.value ? Number(e.target.value) : 0)}
                            className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none cursor-pointer focus:border-[var(--accent)] disabled:opacity-60"
                          >
                            <option value="">—</option>
                            {Array.from({ length: draft.circles }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : null}
                      <td className="px-2 py-1.5 align-middle">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {stageEvents > 0 ? (
                            <span className={UI.chip} title="События, связанные с этим этапом">
                              событий: {stageEvents}
                            </span>
                          ) : null}
                          {hasText ? (
                            <span className="text-[10px] text-[#6B7280]" title="Прежние «Причина» и «Меры» этапа сохранены и показаны в журнале событий">
                              прежние сведения — в журнале
                            </span>
                          ) : null}
                          {!readOnly ? (
                            <button
                              type="button"
                              data-ui="stage-add-event"
                              onClick={() => requestAddEvent(s.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] border border-[#E5E7EB] text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                              title="Открыть форму события в журнале и заранее связать запись с этим этапом; даты этапа не меняются"
                            >
                              <Plus className="w-3 h-3" aria-hidden="true" />
                              Добавить событие
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        {!readOnly && canEditPlanned ? (
                          <button
                            type="button"
                            onClick={() => removeStage(s.id)}
                            aria-label="Удалить этап"
                            title="Удалить этап"
                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {draft.stages.length === 0 ? (
                <tr>
                  <td colSpan={draft.circles >= 2 ? 9 : 8} className="px-2 py-4 text-center text-[11px] text-[#6B7280]">
                    У рейса пока нет этапов — добавьте первый (граница, загрузка, выгрузка…).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!readOnly && canEditPlanned ? (
          <div>
            <button type="button" data-ui="add-stage" onClick={addStage} className={UI.buttonGhost}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              добавить этап
            </button>
          </div>
        ) : null}

        {/* ЕДИНЫЙ ЖУРНАЛ «События рейса» — после точек и этапов, до плана дохода.
            Замена отдельных полей «Комментарий к рейсу» / «Причина» / «Меры» и
            дублирующего блока «События машины за период рейса». */}
        <TripEventsJournal
          trip={draftTrip}
          stageTypes={stageTypes}
          stages={draft.stages}
          events={carEvents}
          meta={metaDraft}
          canWrite={canWrite}
          readOnly={readOnly}
          user={user}
          focusEventId={focusEventId}
          onFocusEventDone={onFocusEventDone}
          formRequest={eventFormRequest}
          onFormRequestHandled={() => setEventFormRequest(null)}
          onDirtyChange={handleJournalDirty}
          onClearLegacyStage={clearLegacyStage}
          onClearLegacyMeta={clearLegacyMeta}
        />

        {/* Блок В: План дохода — ниже блока дат и этапов */}
        {/* План дохода: сведения и плечи */}
        {isPlan && plan ? (
          <div className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4B5563]">
              <span className="font-semibold text-[#121316]">План дохода</span>
              <span>#{plan.id}</span>
              {plan.needsFill === true ? (
                <span
                  data-ui="plan-needs-fill"
                  className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                  title="Запись создана из таймлайна: фрахт и расходы ещё не заполнены — откройте план дохода и заполните"
                >
                  Требует заполнения
                </span>
              ) : null}
              {plan.direction ? <span>направление: {plan.direction}</span> : null}
              {plan.month ? <span>месяц в плане: {plan.month}</span> : null}
              {plan.days != null ? <span>дней: {plan.days}</span> : null}
              {plan.totalKm != null ? <span>км план: {plan.totalKm}</span> : null}
              {plan.factKm != null ? <span>км факт: {plan.factKm}</span> : null}
              <span>фрахт: {money(plan.totalFreight)}</span>
              <span>профит план: {money(plan.profit)}</span>
              <span>профит факт: {money(plan.profitFact)}</span>
            </div>
            {plan.note ? <div className="text-[11px] text-[#6B7280]">Заметка плана: {plan.note}</div> : null}
            {plan.legs.length ? (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left min-w-[420px]">
                  <thead>
                    <tr className={UI.theadRow}>
                      <th className={UI.th}>Плечо</th>
                      <th className={UI.th}>Км</th>
                      <th className={UI.th}>Ставка</th>
                      <th className={UI.th}>Фрахт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.legs.map((l, i) => (
                      <tr key={`${l.from}-${l.to}-${i}`} className="border-b border-[#E5E7EB] last:border-0">
                        <td className={UI.td}>
                          {l.from || 'Не указано'} → {l.to || 'Не указано'}
                        </td>
                        <td className={UI.td}>{l.km || '—'}</td>
                        <td className={UI.td}>{l.rate != null ? l.rate : '—'}</td>
                        <td className={UI.td}>{l.freight != null ? l.freight : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={UI.hint}>Плечи в плане не заполнены (Не указано).</div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                data-ui="open-plan"
                onClick={() => leaveThen(() => onOpenPlan(planSourceId))}
                className={UI.buttonGhost}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                Открыть план дохода
              </button>
              <button type="button" data-ui="copy-plan-link" onClick={() => onCopyPlanLink(planSourceId)} className={UI.buttonGhost}>
                <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
                Скопировать ссылку на план дохода
              </button>
              <span className="text-[10px] text-[#9CA3AF]">ссылка ведёт на конкретную запись плана дохода</span>
            </div>
          </div>
        ) : (
          <div className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#121316]">План дохода</span>
            <span className="text-[11px] text-[#6B7280]">План дохода не связан — запись автоматически по машине или датам не подбирается.</span>
          </div>
        )}

        {/* Встроенный таймлайн этой машины */}
        <div className="flex flex-col gap-2">
          <span className={UI.sectionTitle}>Таймлайн машины {formatPlate(trip.carNumber)} — план и факт выбранного рейса</span>
          <CarMiniTimeline
            focusKey={trip.key}
            carTrips={carTrips}
            carBases={carBases}
            carEvents={carEvents}
            stageTypes={stageTypes}
            today={today}
            onSelectTrip={(key) => leaveThen(() => onSelectTrip(key))}
            onOpenEventTrip={onOpenEventTrip ? (k, ev) => leaveThen(() => onOpenEventTrip(k, ev)) : undefined}
            onFocusStage={readOnly ? undefined : focusStage}
            onOpenBasePeriod={onOpenBasePeriod}
          />
        </div>
      </div>
    </ModalShell>
  );
}

/** Плановая дата начала рейса (для сортировок в родителе). */
export const planStartOf = (t: WholeTrip): number => tripSpan(t).pMin ?? 0;
