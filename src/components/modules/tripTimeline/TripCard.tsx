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
 * Плановые границы правится ЗДЕСЬ и сохраняются в ту же запись «Плана дохода»
 * (существующий pdService.updateTrip + существующий расчёт calculateTripFinances):
 * это два интерфейса одних данных, а не копии. У ручного рейса границы остаются
 * в его собственной записи. Фактические даты плановое редактирование не меняет,
 * этапы автоматически не сдвигаются — при расхождении показывается предупреждение.
 *
 * Архивный статус связанного рейса меняется только в «Плане дохода»: здесь
 * пояснение и переход по прямой ссылке (в том числе для архивной записи).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CalendarClock,
  ClipboardCopy,
  ExternalLink,
  Flag,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { LegPlan, TimelinePlanGuard, TimelinePlanHistoryEntry, TimelinePlanPermission, TimelineStage, TimelineStageType, TimelineVehicleEvent, UserProfile } from '../../../types';
import { UI } from '../../../ui/kit';
import { ModalShell } from '../../../ui/components';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dbService, pdService } from '../../../api';
import { calculateTripFinances } from '../../../utils/financeCalculators';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import type { DispatcherOption } from './useTimelineData';
import { useDebouncedSaver } from './useDebouncedSaver';
import DateInput from './DateInput';
import TripEventsJournal from './TripEventsJournal';
import { PlanBarLabel, planBarLabelParts } from './PlanBarLabel';
import { eventMarkOf, groupEventMarks, type EventMark } from './lib/eventMarks';
import { computePlanStageChanges, resolvePlanLock, type PlanStageChanges } from './lib/planLock';
import {
  WEEKEND_HINT,
  ZOOM_LEVELS,
  barRectInWindow,
  comparePlanFact,
  computeStoredRange,
  dayNum,
  dayStr,
  dayToX,
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
  baseBarRange,
  baseDeviation,
  readyBarRange,
  repairBarRange,
  type BasePeriod,
  type WholeTrip,
} from './lib/sources';

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
  /** Клик по маркеру события другого рейса во встроенном таймлайне. */
  onOpenEventTrip?: (tripKey: string, eventId: string) => void;
  /** Состояние плана этапов рейса (tripTimeline/planGuard) — блокировка плановых дат. */
  planGuard?: TimelinePlanGuard | null;
  /** Действующие разовые разрешения рейса (tripTimeline/planPerms). */
  planPerms?: Record<string, TimelinePlanPermission>;
  /** Контроль плана этапов доступен только в облачном режиме. */
  planControlEnabled?: boolean;
  /** Рейсы, периоды и события этой же машины — контекст встроенного таймлайна. */
  carTrips: WholeTrip[];
  carBases: BasePeriod[];
  carEvents: TimelineVehicleEvent[];
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
    })),
    planStart: isoOf(t.spanOverride?.pMin ?? span.pMin ?? null),
    planEnd: isoOf(t.spanOverride?.pMax ?? span.pMax ?? null),
  };
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
const MINI_BASE_BAR_H = 14;
const MINI_REPAIR_BAR_H = 10;

const hatchReady = 'repeating-linear-gradient(45deg,#FDE68A,#FDE68A 3px,transparent 3px,transparent 6px)';
const hatchBase = 'repeating-linear-gradient(135deg,transparent,transparent 4px,#CFD4DC 4px,#CFD4DC 5px)';
const hatchOpen = 'repeating-linear-gradient(45deg,#A7F3D0,#A7F3D0 5px,transparent 5px,transparent 10px)';
const hatchBuffer = 'repeating-linear-gradient(45deg,#FDE68A,#FDE68A 4px,transparent 4px,transparent 8px)';

function CarMiniTimeline({
  focusKey,
  carTrips,
  carBases,
  carEvents,
  stageTypes,
  today,
  onSelectTrip,
  onOpenEventTrip,
  onFocusStage,
}: {
  focusKey: string;
  carTrips: WholeTrip[];
  carBases: BasePeriod[];
  carEvents: TimelineVehicleEvent[];
  stageTypes: TimelineStageType[];
  today: number;
  onSelectTrip: (tripKey: string) => void;
  /** Клик по маркеру события связанного рейса — открыть рейс и показать запись. */
  onOpenEventTrip?: (tripKey: string, eventId: string) => void;
  /** Клик по маркеру этапа — переход и подсветка этапа в верхнем блоке окна. */
  onFocusStage?: (stageId: string) => void;
}) {
  const focus = carTrips.find((t) => t.key === focusKey) || null;
  const focusSpan = focus ? tripSpan(focus) : null;
  // Начальный видимый диапазон — объединение ПЛАНА и ФАКТА выбранного рейса
  // с небольшим запасом по краям (а не «сегодня»): архивный рейс открывается
  // на своих реальных датах, факт за плановой границей не обрезается.
  const planA = focus?.spanOverride?.pMin ?? focusSpan?.pMin ?? null;
  const planB = focus?.spanOverride?.pMax ?? focusSpan?.pMax ?? null;
  const factA = focusSpan?.fMin ?? null;
  const factB = focusSpan?.fMax ?? null;
  const starts = [planA, factA].filter((v): v is number => v != null);
  const ends = [planB, factB].filter((v): v is number => v != null);
  const anchorStart = starts.length ? Math.min(...starts) : today - 10;
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
  const initialStart = anchorStart - 7;
  const initialVn = Math.max(30, anchorEnd + 7 - initialStart + 1);
  const [vs, setVs] = useState(initialStart);
  const [vn, setVn] = useState(initialVn);
  const [extL, setExtL] = useState(0);
  const [extR, setExtR] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevExtL = useRef(0);
  const prevColW = useRef(colW);
  const pendingAnchor = useRef<{ day: number; frac: number } | null>(null);
  const lastExtend = useRef(0);
  const didInit = useRef(false);

  const renderVs = vs - extL;
  const renderVn = vn + extL + extR;
  const ve = renderVs + renderVn - 1;
  const W = renderVn * colW;
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

  // При открытии окна: масштаб подобран под рейс (fitZoom), позиция — начало рейса.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInit.current) return;
    didInit.current = true;
    applyAnchor(anchorStart, 0);
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
    if (el.scrollLeft < colW * 2 && extL < 300) {
      lastExtend.current = now + 250;
      setExtL((v) => v + 30);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - colW * 2 && extR < 300) {
      lastExtend.current = now + 250;
      setExtR((v) => v + 30);
    }
  }, [extL, extR, colW]);

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

  const bgWeekend = useMemo(() => {
    const segs: Array<{ left: number; width: number }> = [];
    for (let d = renderVs; d <= ve; d += 1) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) segs.push({ left: Math.round((d - renderVs) * colW), width: colW });
    }
    return segs;
  }, [renderVs, ve, colW]);

  const link = (key: string): React.CSSProperties =>
    key === focusKey ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : { opacity: 0.85 };

  /**
   * Дорожки встроенного таймлайна — те же правила, что в основном:
   * группа 0 — рейсы (план/факт), 1 — база (готовность/приезд→выезд),
   * 2 — ремонт. Пересекающиеся полосы одной группы разводятся на под-дорожки;
   * горизонтальные координаты не меняются — только вертикальные дорожки.
   */
  const miniPlanTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const readySlot = new Map<string, number>();
    const tripSlot = new Map<string, number>();
    const bufferSlot = new Map<string, number>();
    carBases.forEach((p) => {
      const rdy = readyBarRange(p);
      if (!rdy) return;
      items.push({ group: 1, a: rdy.a, b: rdy.b, h: MINI_PLAN_BAR_H });
      readySlot.set(p.key, items.length - 1);
    });
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
    return { layout: layoutLaneTracks(items, { padTop: 5, padBottom: 5, gap: MINI_TRACK_GAP }), readySlot, tripSlot, bufferSlot };
  }, [carBases, carTrips]);
  const miniPlanH = Math.max(MINI_PLAN_H, miniPlanTrack.layout.laneH);

  const miniFactTrack = useMemo(() => {
    const items: LaneTrackItem[] = [];
    const baseSlot = new Map<string, number>();
    const repairSlot = new Map<string, number>();
    const factSlot = new Map<string, number>();
    const factNoneSlot = new Map<string, number>();
    carBases.forEach((p) => {
      const rb = baseBarRange(p, today);
      if (rb) {
        items.push({ group: 1, a: rb.a, b: rb.b, h: MINI_BASE_BAR_H });
        baseSlot.set(p.key, items.length - 1);
      }
      const rr = repairBarRange(p, today);
      if (rr) {
        items.push({ group: 2, a: rr.a, b: rr.b, h: MINI_REPAIR_BAR_H });
        repairSlot.set(p.key, items.length - 1);
      }
    });
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
    return { layout: layoutLaneTracks(items, { padTop: 3, padBottom: 3, gap: MINI_TRACK_GAP }), baseSlot, repairSlot, factSlot, factNoneSlot };
  }, [carBases, carTrips, today]);
  const miniFactH = Math.max(MINI_FACT_H, miniFactTrack.layout.laneH);
  const miniFactZone0 = miniFactTrack.layout.zones.find((z) => z.key === 0) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-[#6B7280] tabular-nums" data-ui="mini-range">
          {fmtFull(isoOf(renderVs))} – {fmtFull(isoOf(ve))}
        </span>
        <button type="button" data-ui="mini-fit-trip" onClick={showWholeTrip} className={UI.buttonGhost}>
          Показать рейс целиком
        </button>
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
        className="tl-scroll overflow-auto overscroll-x-contain border border-[#E5E7EB] rounded-xl bg-[#F9FAFB] max-h-[300px]"
      >
        <style>{`.tl-scroll{scrollbar-width:thin;scrollbar-color:#B6BBC2 #F3F4F6;}
.tl-scroll::-webkit-scrollbar{height:12px;width:12px;}
.tl-scroll::-webkit-scrollbar-track{background:#F3F4F6;border-radius:8px;}
.tl-scroll::-webkit-scrollbar-thumb{background:#C3C8CF;border-radius:8px;border:2px solid #F3F4F6;}`}</style>
        <div className="grid min-w-max" style={{ gridTemplateColumns: `96px ${W}px` }}>
          <div className="sticky left-0 top-0 z-[6] bg-[#F9FAFB] border-b border-r border-[#E5E7EB] px-2 py-1 w-[96px] min-w-[96px]">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[#9CA3AF]">План</span>
          </div>
          <div className="sticky top-0 z-[5] bg-[#F9FAFB] border-b border-[#E5E7EB]" style={{ width: W }}>
            {/* Та же календарная шапка (месяцы + дни), что и в основном таймлайне */}
            <CalendarHeader vs={renderVs} vn={renderVn} colW={colW} today={today} pinLeft={104} dense />
          </div>

          {/* План */}
          <div className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#EEF0F3] px-2 w-[96px] min-w-[96px] text-[9px] leading-[12px] text-[#9CA3AF] overflow-hidden" style={{ height: miniPlanH, borderRightColor: '#D1D5DB' }}>
            {focus ? formatPlate(focus.carNumber) : ''} · план
          </div>
          <div data-lane="plan" className="relative z-0 border-b border-[#EEF0F3]" style={{ width: W, height: miniPlanH }}>
            {bgWeekend.map((s, i) => (
              <div key={`w${i}`} className="absolute top-0 bottom-0" style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.7 }} />
            ))}
            {carBases.map((p) => {
              const rdy = readyBarRange(p);
              if (!rdy) return null;
              const q = pos(rdy.a, rdy.b);
              if (!q) return null;
              const dev = baseDeviation(p, today);
              const ti = miniPlanTrack.readySlot.get(p.key);
              const top = ti == null ? 5 : miniPlanTrack.layout.tops[ti];
              return (
                <div
                  key={`rdy-${p.key}`}
                  data-bar="ready"
                  className="absolute z-[2] overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[16px] px-1 text-[#92400E]"
                  style={{ left: q.left, width: q.width, top, height: MINI_PLAN_BAR_H, background: hatchReady, border: '1px solid #F59E0B', borderRadius: 3 }}
                  title={`План базы: ${fmtFull(isoOf(rdy.a))} → срок готовности ${fmtFull(isoOf(rdy.b))} · ${dev.label}`}
                >
                  {q.width > 90 ? `готовность${dev.short ? ` · ${dev.short}` : ''}` : ''}
                </div>
              );
            })}
            {carTrips.map((t) => {
              const ov = t.spanOverride || {};
              const sp = tripSpan(t);
              const a = ov.pMin ?? sp.pMin ?? null;
              if (a == null) return null;
              const b = ov.pMax ?? sp.pMax ?? a;
              const q = pos(a, b);
              if (!q) return null;
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
                  onClick={() => t.key !== focusKey && onSelectTrip(t.key)}
                  className="absolute z-[3] overflow-hidden whitespace-nowrap text-[9px] leading-[16px] cursor-pointer px-1"
                  style={{
                    left: q.left,
                    width: q.width,
                    top,
                    height: MINI_PLAN_BAR_H,
                    background: t.archived ? '#E5E7EB' : '#DBEAFE',
                    border: `1px solid ${t.archived ? '#9CA3AF' : '#60A5FA'}`,
                    color: t.archived ? '#6B7280' : '#1E3A8A',
                    borderRadius: 3,
                    ...link(t.key),
                  }}
                  title={`${formatPlate(t.carNumber)} · ${parts.titleText}${t.archived ? ' · архив' : ''}${t.key === focusKey ? ' · выбранный рейс' : ' · соседний рейс (контекст)'}`}
                >
                  {q.width > 40 ? <PlanBarLabel parts={parts} width={q.width} fontPx={9} /> : ''}
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
                  className="absolute z-[2]"
                  style={{ left: q.left, width: q.width, top, height: MINI_PLAN_BAR_H, background: hatchBuffer, borderRadius: 3 }}
                  title={`запас ${t.bufferDays} дн`}
                />
              );
            })}
            {carTrips.flatMap((t) =>
              t.stages.map((s) => {
                const d = dayNum(s.plannedDate);
                if (d == null) return null;
                const q = pos(d, d);
                if (!q) return null;
                return (
                  <div
                    key={`m-${t.key}-${s.id}`}
                    data-bar={s.isCritical ? 'mark-critical' : 'mark-plan'}
                    data-stage={t.key === focusKey ? s.id : undefined}
                    role={t.key === focusKey && onFocusStage ? 'button' : undefined}
                    onClick={t.key === focusKey && onFocusStage ? () => onFocusStage(s.id) : undefined}
                    className={`absolute z-[4] ${t.key === focusKey && onFocusStage ? 'cursor-pointer' : ''}`}
                    style={{
                      left: dayToX(d, renderVs, colW) + Math.round(colW * 0.3),
                      top: 2,
                      height: miniPlanH - 4,
                      width: s.isCritical ? 3 : 2,
                      background: s.isCritical ? '#DC2626' : '#2563EB',
                    }}
                    title={`${s.isCritical ? 'КРИТИЧЕСКИЙ СРОК: ' : 'план: '}${stageFullName(stageTypes, s)} ${s.plannedDate}${t.key === focusKey && onFocusStage ? ' · клик — к этапу в списке' : ''}`}
                  />
                );
              }),
            )}
          </div>

          {/* Факт */}
          <div className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2 w-[96px] min-w-[96px] text-[9px] leading-[12px] text-[#9CA3AF] overflow-hidden" style={{ height: miniFactH, borderRightColor: '#D1D5DB' }}>
            факт · база · ремонт
          </div>
          <div data-lane="fact" className="relative z-0 border-b border-[#E5E7EB]" style={{ width: W, height: miniFactH }}>
            {bgWeekend.map((s, i) => (
              <div key={`fw${i}`} className="absolute top-0 bottom-0" style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.6 }} />
            ))}
            {carBases.map((p) => {
              const dev = baseDeviation(p, today);
              const rb = baseBarRange(p, today);
              const rr = repairBarRange(p, today);
              const qb = rb ? pos(rb.a, rb.b) : null;
              const qr = rr ? pos(rr.a, rr.b) : null;
              const tBase = miniFactTrack.baseSlot.get(p.key);
              const tRep = miniFactTrack.repairSlot.get(p.key);
              return (
                <React.Fragment key={`base-${p.key}`}>
                  {qb ? (
                    <div
                      data-bar="base"
                      className="absolute z-[2] overflow-hidden whitespace-nowrap text-ellipsis text-[9px] leading-[14px] px-1 text-[#4B5563]"
                      style={{ left: qb.left, width: qb.width, top: tBase == null ? 16 : miniFactTrack.layout.tops[tBase], height: MINI_BASE_BAR_H, background: hatchBase, border: '1px solid #9CA3AF', borderRadius: 3 }}
                      title={`База (факт): ${fmtFull(isoOf(rb ? rb.a : null))} → ${rb && rb.open ? 'выезд не указан' : fmtFull(isoOf(rb ? rb.b : null))} · срок готовности ${
                        p.plannedReadyDay != null ? fmtFull(isoOf(p.plannedReadyDay)) : 'не указан'
                      } · ${dev.label}`}
                    >
                      {qb.width > 70 ? `${p.causeLabel}${dev.short ? ` · ${dev.short}` : ''}` : ''}
                    </div>
                  ) : null}
                  {qr ? (
                    <div
                      data-bar="repair"
                      className="absolute z-[3] text-center text-ellipsis text-[9px] leading-[10px] text-white px-1"
                      style={{ left: qr.left, width: qr.width, top: tRep == null ? 18 : miniFactTrack.layout.tops[tRep], height: MINI_REPAIR_BAR_H, background: '#D97706', opacity: 0.92, borderRadius: 2 }}
                      title={`Ремонт: ${fmtFull(isoOf(rr ? rr.a : null))} – ${rr && rr.open ? 'не завершён' : fmtFull(isoOf(rr ? rr.b : null))}`}
                    >
                      {qr.width > 60 ? 'ремонт' : ''}
                    </div>
                  ) : null}
                </React.Fragment>
              );
            })}
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
                    className={`absolute z-[4] ${linked ? 'cursor-pointer' : ''}`}
                    style={
                      grouped
                        ? { left, top, height: 12, minWidth: 16, padding: '0 3px', background: '#7C3AED', borderRadius: 6, textAlign: 'center', opacity: 0.95 }
                        : { left, top, width: 9, height: 9, background: g.items[0].color, borderRadius: 2, transform: 'rotate(45deg)', opacity: 0.95 }
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
              const ti = miniFactTrack.factSlot.get(t.key);
              const top = ti == null ? 4 : miniFactTrack.layout.tops[ti];
              return (
                <div
                  key={`f-${t.key}`}
                  role="button"
                  tabIndex={0}
                  data-bar="fact"
                  data-trip={t.key}
                  onClick={() => t.key !== focusKey && onSelectTrip(t.key)}
                  className="absolute z-[3] cursor-pointer"
                  style={{
                    left: q.left,
                    width: q.width,
                    top,
                    height: MINI_FACT_BAR_H,
                    background: ongoing ? hatchOpen : '#10B981',
                    opacity: ongoing ? 1 : 0.65,
                    border: ongoing ? '1px dashed #10B981' : undefined,
                    borderRadius: 2,
                    ...link(t.key),
                  }}
                  title={`${formatPlate(t.carNumber)} · факт: ${fmtFull(isoOf(sp.fMin))} – ${ongoing ? 'окончание не указано' : fmtFull(isoOf(fEnd))}${t.key === focusKey ? ' · выбранный рейс' : ''}`}
                />
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
              const ti = miniFactTrack.factNoneSlot.get(t.key);
              const top = ti == null ? 3 : miniFactTrack.layout.tops[ti];
              return (
                <div
                  key={`fn-${t.key}`}
                  data-bar="fact-none"
                  className="absolute z-[2] text-[8px] leading-[14px] text-ellipsis text-[#9CA3AF] px-1 overflow-hidden whitespace-nowrap"
                  style={{ left: q.left, width: q.width, top, height: MINI_FACT_NONE_H, border: '1px dashed #9CA3AF', borderRadius: 2, background: '#F9FAFB' }}
                  title="Фактические данные не указаны"
                >
                  {q.width > 90 ? 'Факт не указан' : ''}
                </div>
              );
            })}
            {carBases.map((p) => {
              if (p.plannedReadyDay == null) return null;
              const q = pos(p.plannedReadyDay, p.plannedReadyDay);
              if (!q) return null;
              return (
                <div
                  key={`mk-${p.key}`}
                  data-bar="mark-ready"
                  className="absolute z-[4]"
                  style={{ left: dayToX(p.plannedReadyDay, renderVs, colW) + Math.round(colW * 0.45), top: 2, height: miniFactH - 4, width: 3, background: '#B45309', opacity: 0.85 }}
                  title={`Срок готовности: ${fmtFull(isoOf(p.plannedReadyDay))} — ${baseDeviation(p, today).label}`}
                />
              );
            })}
            {carTrips.flatMap((t) =>
              t.stages.map((s) => {
                const d = dayNum(s.actualDate);
                if (d == null) return null;
                const q = pos(d, d);
                if (!q) return null;
                const dev = stageDeviation(s);
                return (
                  <div
                    key={`mf-${t.key}-${s.id}`}
                    data-bar={dev != null && dev > 0 ? 'mark-late' : 'mark-fact'}
                    data-stage={t.key === focusKey ? s.id : undefined}
                    role={t.key === focusKey && onFocusStage ? 'button' : undefined}
                    onClick={t.key === focusKey && onFocusStage ? () => onFocusStage(s.id) : undefined}
                    className={`absolute z-[4] ${t.key === focusKey && onFocusStage ? 'cursor-pointer' : ''}`}
                    style={{
                      left: dayToX(d, renderVs, colW) + Math.round(colW * 0.6),
                      top: 2,
                      height: miniFactH - 4,
                      width: 2,
                      background: dev != null && dev > 0 ? '#E11D48' : '#10B981',
                    }}
                    title={`факт: ${stageFullName(stageTypes, s)} ${s.actualDate}${dev != null ? ` (${dev > 0 ? '+' : ''}${dev} дн)` : ''}${t.key === focusKey && onFocusStage ? ' · клик — к этапу в списке' : ''}`}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-[#9CA3AF]">
        Соседние рейсы показаны как контекст — клик открывает их окно. База и ремонт — из «Учёта выезда» по этой машине
        (план базы: приезд → срок готовности; факт: приезд → фактический выезд; ремонт — свои даты).
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
  onOpenEventTrip,
  planGuard,
  planPerms,
  planControlEnabled,
  carTrips,
  carBases,
  carEvents,
  onSelectTrip,
  onOpenPlan,
  onCopyPlanLink,
  onArchiveToggle,
  onDelete,
  onClose,
}: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(trip));
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [metaDraft, setMetaDraft] = useState<Meta>(meta);
  /** Несохранённый текст журнала событий — общий запрос подтверждения при закрытии. */
  const journalDirtyRef = useRef(false);
  const [journalDirty, setJournalDirty] = useState(false);
  /** Несохранённые правки плана этапов (записываются кнопкой «Сохранить план этапов»). */
  const planDirtyRef = useRef(false);
  const [planDirty, setPlanDirty] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaveError, setPlanSaveError] = useState('');
  /** Выдача разового разрешения администратором: выбор пользователя. */
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  /** Запрос из таблицы этапов: открыть форму события с предвыбранным этапом. */
  const [eventFormRequest, setEventFormRequest] = useState<{ stageId?: string; nonce: number } | null>(null);
  /** Краткая подсветка этапа после клика по маркеру на встроенном таймлайне. */
  const [highlightStage, setHighlightStage] = useState<string | null>(null);
  const [planDatesError, setPlanDatesError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const saver = useDebouncedSaver();
  const flush = saver.flush;
  const isPlan = trip.kind === 'plan';
  const planSourceId = trip.plan?.id || '';
  const archived = !!trip.archived;
  const readOnly = archived || !canWrite;

  // ── Контроль плана этапов (блокировка плановых дат после сохранения) ────
  const planEnabled = !!planControlEnabled;
  const planUserId = String(user.uid || '');
  const planLock = useMemo(
    () => resolvePlanLock({ storedStages: trip.stages, guard: planGuard || null, perms: planPerms || {}, userId: planUserId }),
    [trip.stages, planGuard, planPerms, planUserId],
  );
  const isRootAdmin = user.role === 'root_admin';
  /** Итоговое состояние: вне облака контроль выключен (локальный режим). */
  const planState = planEnabled ? planLock.state : 'draft';
  /** Плановые даты и состав доступны правке в этом сеансе. */
  const canEditPlanned = !readOnly && (planState === 'draft' || planState === 'permitted' || isRootAdmin);
  /** Правки плана пишутся сразу (черновик); иначе — только кнопкой явного сохранения. */
  const autoSavePlanned = !planEnabled || planState === 'draft';
  /** Кнопка «Сохранить план этапов» (первичное сохранение / после разрешения / админ). */
  const showSavePlanStages = planEnabled && !readOnly && (planState === 'draft' || planState === 'permitted' || isRootAdmin);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(toDraft(trip));
  }, [trip]);
  useEffect(() => setMetaDraft(meta), [meta]);
  useEffect(() => () => flush(), [flush]);

  // Фокус и Escape — управление фокусом внутри окна
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestCloseRef = useRef<() => void>(() => {});
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = rootRef.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);

  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
  };

  const requestClose = useCallback(() => {
    if (dirtyRef.current || journalDirtyRef.current || planDirtyRef.current) {
      const notes: string[] = [];
      if (journalDirtyRef.current) notes.push('в журнале событий есть несохранённый текст');
      if (planDirtyRef.current) notes.push('в плане этапов есть несохранённые изменения (записываются кнопкой «Сохранить план этапов»)');
      const ok = window.confirm(
        notes.length
          ? `${notes.join('; ')}. При закрытии это будет потеряно. Закрыть окно? «Отмена» — остаться.`
          : 'Есть несохранённые изменения. Сохранить и закрыть? «Отмена» — остаться в окне.',
      );
      if (!ok) return;
      if (dirtyRef.current) flush();
    }
    onClose();
  }, [flush, onClose]);
  requestCloseRef.current = requestClose;

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

  // ── Контроль плана этапов: явное сохранение и разовые разрешения ────────
  const planTripKey = trip.key;
  const draftMarkerRef = useRef(false);

  /**
   * Первое содержательное действие с планом БЕЗ записи состояния: фиксируем
   * черновик явно, чтобы только что заполненный план не считался «историческим»
   * (заполненым до включения контроля) и не блокировался сразу.
   */
  const ensureDraftMarker = useCallback(() => {
    if (!planEnabled || draftMarkerRef.current || planGuard) return;
    draftMarkerRef.current = true;
    dbService.markTimelinePlanDraft(planTripKey);
  }, [planEnabled, planGuard, planTripKey]);

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
      changes.adds.forEach((s) =>
        parts.push(`добавлен этап «${stageFullName(stageTypes, s)}»${dayNum(s.plannedDate) != null ? ` (план ${fmtFull(s.plannedDate)})` : ''}`),
      );
      changes.removes.forEach((s) => parts.push(`удалён этап «${stageFullName(stageTypes, s)}»`));
      return parts.join('; ') || 'без изменений';
    },
    [draft.stages, trip.stages, stageTypes],
  );

  /**
   * «Сохранить план этапов»: первичное окончательное сохранение (черновик) или
   * разовое разрешённое изменение. Разрешение гасится транзакцией и в той же
   * атомарной записи вместе с планом; при ошибке записи — возвращается.
   */
  const savePlanStages = async () => {
    if (!showSavePlanStages || planSaving) return;
    setPlanSaveError('');
    const changes = computePlanStageChanges(trip.stages, draft.stages);
    if (planState === 'draft') {
      const ok = await showConfirm(
        'Сохранить план этапов? После сохранения изменение плановых дат этапов будет доступно только с разового разрешения администратора.',
      );
      if (!ok) return;
      setPlanSaving(true);
      try {
        flush();
        const fresh = await dbService.getTimelinePlanGuardOnce(planTripKey);
        if (fresh && fresh.initialSavedAt) {
          setPlanSaveError('План уже сохранён другим пользователем — ничего не записано. Обновите карточку (F5).');
          return;
        }
        await dbService.saveTimelinePlanInitial(
          planTripKey,
          {
            at: new Date().toISOString(),
            by: user.name,
            ...(planUserId ? { byId: planUserId } : {}),
            note: `Первичное сохранение плана этапов (этапов: ${draft.stages.filter((s) => !String(s.id).endsWith('-fallback-load')).length})`,
          },
          user.name,
          user.role,
        );
        planDirtyRef.current = false;
        setPlanDirty(false);
        toast('План этапов сохранён — плановые даты этапов заблокированы', 'success');
      } catch (err) {
        setPlanSaveError(`Не удалось сохранить план этапов: ${(err as Error).message}. Черновик остался в окне — повторите сохранение.`);
      } finally {
        setPlanSaving(false);
      }
      return;
    }
    // Разрешённое изменение: пустые изменения разрешение не расходуют.
    if (changes.count === 0) {
      toast('Изменений в плане нет — сохранять нечего; разрешение не расходуется', 'info');
      return;
    }
    const perm = planLock.permission;
    setPlanSaving(true);
    let consumedSnapshot: unknown = null;
    try {
      flush();
      const fresh = await dbService.getTimelinePlanGuardOnce(planTripKey);
      const baseVersion = perm ? Number(perm.planVersion) : Number(planGuard?.version) || planLock.version || 1;
      const freshVersion = Number(fresh?.version) || (fresh?.initialSavedAt ? 1 : baseVersion);
      if (fresh && freshVersion !== baseVersion) {
        setPlanSaveError(
          `План изменился с момента открытия (версия ${freshVersion} вместо ${baseVersion}) — ничего не записано, чтобы не перезаписать чужие изменения. Обновите данные (F5)${perm ? ' и запросите новое разрешение' : ''}.`,
        );
        return;
      }
      if (perm) {
        const consumed = await dbService.consumeTimelinePlanPermission(planTripKey, planUserId);
        if (!consumed.ok) {
          setPlanSaveError('Разрешение уже использовано другим сохранением или отозвано — обновите данные: повторное использование невозможно.');
          return;
        }
        consumedSnapshot = consumed.snapshot ?? null;
      }
      const updates: Record<string, unknown> = {};
      const base = isPlan ? `tripTimeline/tripStages/${planSourceId}` : `tripTimeline/trips/${trip.id}/stages`;
      changes.adds.forEach((s) => {
        updates[`${base}/${s.id}`] = { ...s };
      });
      changes.plannedUpdates.forEach((u) => {
        updates[`${base}/${u.id}/plannedDate`] = u.plannedDate;
      });
      changes.removes.forEach((s) => {
        updates[`${base}/${s.id}`] = null;
      });
      if (!isPlan) {
        const range = computeStoredRange({ ...trip, stages: draft.stages });
        updates[`tripTimeline/trips/${trip.id}/startDate`] = range.startDate || '';
        updates[`tripTimeline/trips/${trip.id}/endDate`] = range.endDate || '';
      }
      const details = describePlanChanges(changes);
      updates[`tripTimeline/planGuard/${planTripKey}`] = {
        ...(planGuard || {}),
        version: baseVersion + 1,
        ...(planGuard?.initialSavedAt ? { initialSavedAt: planGuard.initialSavedAt } : {}),
        ...(planGuard?.initialSavedBy ? { initialSavedBy: planGuard.initialSavedBy } : {}),
        ...(planGuard?.initialSavedById ? { initialSavedById: planGuard.initialSavedById } : {}),
        ...(planLock.legacy || planGuard?.legacy ? { legacy: true } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: user.name,
        ...(planUserId ? { updatedById: planUserId } : {}),
        history: nextPlanHistory(perm ? 'update' : 'admin-update', details),
      };
      if (perm) updates[`tripTimeline/planPerms/${planTripKey}/${planUserId}`] = null;
      await dbService.saveTimelinePlanCommit(updates, user.name, user.role, details);
      planDirtyRef.current = false;
      setPlanDirty(false);
      dirtyRef.current = false;
      setDirty(false);
      toast('План этапов сохранён — плановые даты снова заблокированы', 'success');
    } catch (err) {
      if (perm && consumedSnapshot) {
        await dbService.restoreTimelinePlanPermission(planTripKey, planUserId, consumedSnapshot);
      }
      setPlanSaveError(
        `Сохранение не удалось: ${(err as Error).message}. Черновик остался в окне${
          perm ? ', разрешение не израсходовано — повторите попытку' : ''
        }.`,
      );
    } finally {
      setPlanSaving(false);
    }
  };

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
    setGrantOpen(false);
    toast(`Разрешено одно изменение плана: ${sel.name}`, 'success');
  };

  const revokePlanPermission = async (uid: string, name: string) => {
    if (!isRootAdmin) return;
    const ok = await showConfirm(`Отозвать неиспользованное разрешение для ${name}?`);
    if (!ok) return;
    dbService.revokeTimelinePlanPermission(planTripKey, uid, planLock.history, user.name, user.role);
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

  const setTripField = (patch: Partial<WholeTrip>) => {
    markDirty();
    saver.queueTrip(trip.id, patch);
  };

  const onRouteChange = (v: string) => {
    setDraft((d) => ({ ...d, route: v }));
    setTripField({ route: v });
  };

  const onDispatcherChange = (id: string) => {
    const disp = dispatchers.find((d) => d.id === id);
    setDraft((d) => ({ ...d, dispatcherId: id, dispatcherName: disp ? disp.name : '' }));
    setTripField({ dispatcherId: id, dispatcherName: disp ? disp.name : '' });
  };

  const onBufferChange = (v: string) => {
    const num = Math.max(0, Number(v.replace(',', '.')) || 0);
    setDraft((d) => ({ ...d, bufferDays: v }));
    setTripField({ bufferDays: num });
  };

  /**
   * Плановые границы. Рейс из плана дохода — сохраняем в связанную запись плана
   * (тот же id) и пересчитываем показатели существующей функцией
   * calculateTripFinances, как это делает сам «План дохода». Ручной рейс —
   * границы в его собственной записи; этапы и события не двигаются.
   */
  const savePlanDates = useCallback(
    async (startIso: string, endIso: string) => {
      const s = dayNum(startIso);
      const e = dayNum(endIso);
      if (s == null && e == null) return;
      if (s != null && e != null && e < s) {
        setPlanDatesError('Плановое возвращение не может быть раньше планового старта — изменения не сохранены.');
        return;
      }
      setPlanDatesError('');
      if (!isPlan) {
        const patch = { startDate: startIso, endDate: endIso } as Partial<WholeTrip>;
        setDraft((d) => ({ ...d, planStart: startIso, planEnd: endIso }));
        setTripField(patch);
        toast('Плановые границы рейса сохранены в его записи', 'success');
        return;
      }
      if (!canEditPlan) {
        setPlanDatesError('Нет права редактирования «Плана дохода» — изменения не сохранены.');
        return;
      }
      setSavingPlan(true);
      try {
        const raw = (trip.planRaw || {}) as Record<string, unknown>;
        const fin = calculateTripFinances(
          ((raw.legs as LegPlan[] | undefined) || []),
          startIso,
          endIso,
          Number(raw.extraExpense) || 0,
          Number(raw.ferryCost) || 0,
          Number(raw.factKm) || 0,
        );
        await pdService.updateTrip(
          planSourceId,
          {
            dateStart: startIso,
            dateEnd: endIso,
            days: fin.days,
            totalKm: fin.totalKm,
            totalFreight: fin.totalFreight,
            totalExpenses: fin.totalExpensesFact,
            profit: fin.profitPlan,
            profitFact: fin.profitFact,
          },
          'timeline',
          'timeline',
        );
        toast('Плановые даты сохранены в «План дохода» — таймлайн обновится', 'success');
        setDraft((d) => ({ ...d, planStart: startIso, planEnd: endIso }));
      } catch (err) {
        setPlanDatesError(
          `Не удалось сохранить в «План дохода»: ${(err as Error).message}. Введённые даты остались черновиком в окне — повторите сохранение.`,
        );
      } finally {
        setSavingPlan(false);
      }
    },
    [isPlan, canEditPlan, planSourceId, trip.planRaw, setTripField, toast],
  );

  const onStageField = (stageId: string, field: keyof TimelineStage, value: string | boolean) => {
    markDirty();
    const nextStages = draft.stages.map((s) => (s.id === stageId ? { ...s, [field]: value } : s));
    setDraft((d) => ({ ...d, stages: d.stages.map((s) => (s.id === stageId ? { ...s, [field]: value } : s)) }));
    // Плановые даты после сохранения плана: правки идут локально и записываются
    // ТОЛЬКО кнопкой «Сохранить план этапов» (разовое разрешение/администратор).
    if (field === 'plannedDate' && !autoSavePlanned) {
      if (!canEditPlanned) return;
      planDirtyRef.current = true;
      setPlanDirty(true);
      return;
    }
    if (autoSavePlanned) ensureDraftMarker();
    if (isPlan) {
      saver.queueAutoStage(planSourceId, stageId, { [field]: value });
    } else {
      saver.queueStage(trip.id, stageId, { [field]: value });
      if (field === 'plannedDate' || field === 'actualDate') {
        saver.queueTrip(trip.id, computeStoredRange({ ...trip, stages: nextStages }));
      }
    }
  };

  /** Кнопка «Добавить этап»: в черновике — сразу в базу; после сохранения плана —
   *  локально, до явного сохранения с разовым разрешением. */
  const addStage = () => {
    if (!canEditPlanned) return;
    markDirty();
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
    if (!autoSavePlanned) {
      planDirtyRef.current = true;
      setPlanDirty(true);
      return;
    }
    ensureDraftMarker();
    if (isPlan) dbService.addTimelineTripStage(planSourceId, { ...stage });
    else dbService.addTimelineStage(trip.id, { ...stage });
  };

  /** Удаление этапа: в черновике — сразу; после сохранения плана — локально
   *  (изменение сохранённого состава требует разового разрешения). */
  const removeStage = (stageId: string) => {
    if (!canEditPlanned) return;
    flush();
    markDirty();
    const rest = draft.stages.filter((s) => s.id !== stageId);
    setDraft((d) => ({ ...d, stages: d.stages.filter((s) => s.id !== stageId) }));
    if (!autoSavePlanned) {
      planDirtyRef.current = true;
      setPlanDirty(true);
      return;
    }
    if (isPlan) dbService.deleteTimelineTripStage(planSourceId, stageId);
    else dbService.deleteTimelineStage(trip.id, stageId);
    if (!isPlan) saver.queueTrip(trip.id, computeStoredRange({ ...trip, stages: rest }));
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

  const requestDelete = async () => {
    const ok = await showConfirm(`Удалить рейс ${formatPlate(trip.carNumber)} — ${draft.route || 'без маршрута'}?`);
    if (!ok) return;
    flush();
    onDelete?.(trip);
  };

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
      maxWidth="max-w-[min(1440px,94vw)]"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          {!isPlan && canWrite ? (
            <>
              <button
                type="button"
                data-ui="trip-archive"
                title="Для рейсов из «Плана дохода» архивный статус изменяется в плане дохода; здесь — только ручной рейс"
                onClick={() => {
                  flush();
                  onArchiveToggle?.(trip);
                }}
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
            {dirty || journalDirty ? (
              <span className="text-amber-700 font-semibold">
                {journalDirty && !dirty ? 'есть несохранённый текст в журнале событий' : 'есть несохранённые изменения'}
              </span>
            ) : null}
            <span className="text-emerald-600">{saver.status === 'saved' ? 'Сохранено ✓' : ''}</span>
            {!readOnly ? (
              <button
                type="button"
                data-ui="trip-save"
                onClick={() => {
                  flush();
                  dirtyRef.current = false;
                  setDirty(false);
                  toast('Изменения сохранены', 'success');
                }}
                className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#121316] text-white hover:bg-black transition-colors cursor-pointer"
              >
                Сохранить
              </button>
            ) : null}
          </span>
        </div>
      }
    >
      <div ref={rootRef} data-atrip={trip.key} className="flex flex-col gap-4">
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
                <button type="button" data-ui="save-plan-dates" disabled={readOnly} onClick={() => savePlanDates(draft.planStart, draft.planEnd)} className={UI.buttonGhost}>
                  Сохранить границы
                </button>
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
              {planState === 'saved' && isRootAdmin && !readOnly ? (
                <span className="text-[#6B7280]">root-администратор может изменить план без разрешения</span>
              ) : null}
              {planDirty ? <span className="text-amber-700 font-semibold">изменения плана не сохранены</span> : null}
              {showSavePlanStages ? (
                <button
                  type="button"
                  data-ui="save-plan-stages"
                  disabled={planSaving}
                  onClick={savePlanStages}
                  title={
                    planState === 'draft'
                      ? 'Зафиксировать план этапов; после этого плановые даты блокируются'
                      : 'Записать изменения плана и вернуть блокировку (разовое разрешение будет использовано)'
                  }
                  className={`${UI.buttonPrimary} ml-auto`}
                >
                  {planSaving ? 'Сохраняется…' : 'Сохранить план этапов'}
                </button>
              ) : null}
            </div>
            {planSaveError ? (
              <div className={UI.errorBox} role="alert">
                <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                {planSaveError}
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
                  <DateInput value={draft.planStart} disabled={savingPlan} ariaLabel="Плановый старт рейса" onChange={(v) => setDraft((d) => ({ ...d, planStart: v }))} />
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
                  <DateInput value={draft.planEnd} disabled={savingPlan} ariaLabel="Плановое возвращение рейса" onChange={(v) => setDraft((d) => ({ ...d, planEnd: v }))} />
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
              <button type="button" data-ui="save-plan-dates" disabled={savingPlan} onClick={() => savePlanDates(draft.planStart, draft.planEnd)} className={UI.buttonPrimary}>
                {savingPlan ? 'Сохраняется…' : 'Сохранить плановые даты в «План дохода»'}
              </button>
              <span className="text-[10px] text-[#6B7280]">
                План и факт не смешиваются: фактические даты этим не меняются. Этапы автоматически не сдвигаются — при расхождении появится предупреждение.
              </span>
            </div>
          ) : isPlan && !readOnly && !canEditPlan ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] text-[10px] text-[#6B7280]">
              Нет права редактирования «Плана дохода» — плановые даты показаны только для просмотра.
            </div>
          ) : null}
          {planDatesError ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] text-[11px] text-rose-600" role="alert">
              {planDatesError}
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
                <th className={UI.th}>Уточнение</th>
                <th className={UI.th}>План</th>
                <th className={UI.th}>Факт</th>
                <th className={UI.th}>Отклонение / состояние</th>
                <th className={UI.th}>Крит. срок</th>
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
                        <input
                          type="text"
                          value={s.label || ''}
                          disabled={readOnly}
                          onChange={(e) => onStageField(s.id, 'label', e.target.value)}
                          placeholder="напр. Достык"
                          list="tl-checkpoints-list"
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
                  <td colSpan={8} className="px-2 py-4 text-center text-[11px] text-[#6B7280]">
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
                onClick={() => {
                  if (dirtyRef.current) {
                    const ok = window.confirm(
                      'Есть несохранённые изменения. Сохранить их перед переходом в «План дохода»? «Отмена» — остаться в окне рейса.',
                    );
                    if (!ok) return;
                    flush();
                    dirtyRef.current = false;
                    setDirty(false);
                  }
                  onOpenPlan(planSourceId);
                }}
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
            onSelectTrip={onSelectTrip}
            onOpenEventTrip={onOpenEventTrip}
            onFocusStage={readOnly ? undefined : focusStage}
          />
        </div>
      </div>
    </ModalShell>
  );
}

/** Плановая дата начала рейса (для сортировок в родителе). */
export const planStartOf = (t: WholeTrip): number => tripSpan(t).pMin ?? 0;
