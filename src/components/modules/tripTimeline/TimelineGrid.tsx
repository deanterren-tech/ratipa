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
 * линия «сегодня» считаются один раз на окно, связь «план↔факт» при наведении —
 * локальное состояние внутри строки машины. Позиция прокрутки сохраняется между
 * возвратами (sessionStorage + вкладки не размонтируются).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineStageType, TimelineVehicleEvent } from '../../../types';
import { formatPlate } from '../../../utils/salaryAutofill';
import {
  PERIOD_PRESETS,
  WEEKDAYS_RU,
  addMonthsIso,
  dayHeaderLabel,
  dayNum,
  dayStr,
  fmtDM,
  getDeadlineStatus,
  isWeekendDay,
  stageDeviation,
  tripFactEnd,
  tripSpan,
  type PeriodPreset,
} from './lib/timeline';
import { eventTypeOf, stageFullName } from './lib/catalog';
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
import { AlertTriangle } from 'lucide-react';

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
  | { kind: 'plan'; a: number; b: number; tripKey: string; label: string; archived: boolean; level: number; open: boolean; title: string }
  | { kind: 'buffer'; a: number; b: number; days: number }
  | { kind: 'markPlan'; day: number; critical: boolean; title: string; tripKey: string; weekend: boolean }
  | { kind: 'ready'; a: number; b: number; periodKey: string; title: string; deviation: string };

type FactItem =
  | { kind: 'fact'; a: number; b: number; open: boolean; tripKey: string; title: string }
  | { kind: 'factNone'; a: number; b: number; tripKey: string; title: string }
  | { kind: 'base'; a: number; b: number; open: boolean; label: string; periodKey: string; title: string }
  | { kind: 'repair'; a: number; b: number; open: boolean; capped: boolean; periodKey: string; title: string }
  | { kind: 'event'; a: number; b: number; color: string; label: string; title: string }
  | { kind: 'gap'; a: number; b: number; days: number }
  | { kind: 'markFact'; day: number; late: boolean; title: string; tripKey: string; weekend: boolean }
  | { kind: 'markReady'; day: number; title: string; periodKey: string };

interface CarRowModel {
  carKey: string;
  carNumber: string;
  carId: string;
  dispatcherId: string;
  dispatcherName: string;
  tripsCount: number;
  basesCount: number;
  repairsCount: number;
  warnings: string[];
  empty: boolean;
  planItems: PlanItem[];
  factItems: FactItem[];
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
  /** Начало базового диапазона для кнопочной навигации (без догрузки прокруткой). */
  navVs: number;
  preset: PeriodPreset;
  onPresetChange: (p: PeriodPreset) => void;
  /** Кнопки/дата двигают базовый диапазон; прокрутка — отдельный механизм. */
  onNavigate: (n: number) => void;
  /** Пользователь доскроллил до края — расширяем диапазон (без пустоты). */
  onRangeExtend: (dir: 'left' | 'right') => void;
  showArchived: boolean;
  onShowArchivedChange: (v: boolean) => void;
  onOpenTrip: (tripKey: string) => void;
  onOpenBase: (periodKey: string) => void;
  onOpenCar: (carKey: string) => void;
}

/** Запас по краям окна: полосы, пересекающиеся с [vs−margin, ve+margin],
 *  участвуют в цепочке, но за пределами окна обрезаются. */
const WINDOW_MARGIN = 60;

const PLAN_H = 26;
const FACT_H = 32;

const colWidthFor = (vn: number): number => (vn > 120 ? 10 : vn > 60 ? 16 : vn > 30 ? 24 : 30);

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
): CarRowModel[] => {
  const from = vs - WINDOW_MARGIN;
  const to = ve + WINDOW_MARGIN;
  const visibleTrips = trips.filter((t) => showArchived || !t.archived);
  const tripCandidates = visibleTrips.filter((t) => {
    const ov = t.spanOverride || {};
    const span = tripSpan(t);
    const s = ov.pMin ?? span.pMin ?? span.fMin ?? null;
    const e = ov.pMax ?? span.pMax ?? span.fMax ?? s;
    return intersects(s, e, from, to);
  });

  const baseCandidates = bases.filter((p) => {
    const rb = baseBarRange(p, today);
    const rr = repairBarRange(p, today);
    return (rb && intersects(rb.a, rb.b, from, to)) || (rr && intersects(rr.a, rr.b, from, to));
  });

  const eventCandidates = events.filter((e) => {
    const a = dayNum(e.dateFrom);
    const b = dayNum(e.dateTo) ?? a;
    return intersects(a, b, from, to);
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
        planItems.push({
          kind: 'plan',
          a: pMin,
          b: planEnd,
          tripKey: t.key,
          label: t.route || t.carNumber,
          archived: !!t.archived,
          level: deadline.level,
          open: openPlan,
          title: `${formatPlate(car.carNumber)} · ${t.route || 'без маршрута'} · ${t.dispatcherName || 'без диспетчера'}${t.kind === 'plan' ? ' · из плана дохода' : ''}${t.archived ? ' · архив' : ''}${openPlan ? ' · неполный план (нет даты возвращения)' : ''} · ${deadline.label}`,
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

      // Маркеры этапов: план — на подстроке «План», факт — на «Факт»
      t.stages.forEach((s) => {
        const p = dayNum(s.plannedDate);
        const f = dayNum(s.actualDate);
        if (p != null && visible(p, p)) {
          planItems.push({
            kind: 'markPlan',
            day: p,
            critical: !!s.isCritical,
            tripKey: t.key,
            weekend: isWeekendDay(p),
            title: `${s.isCritical ? 'КРИТИЧЕСКИЙ СРОК: ' : 'план: '}${stageFullName(stageTypes, s)} ${s.plannedDate}`,
          });
        }
        if (f != null && visible(f, f)) {
          const dev = stageDeviation(s);
          factItems.push({
            kind: 'markFact',
            day: f,
            late: dev != null && dev > 0,
            tripKey: t.key,
            weekend: isWeekendDay(f),
            title: `факт: ${stageFullName(stageTypes, s)} ${s.actualDate}${dev != null ? ` (${dev > 0 ? '+' : ''}${dev} дн)` : ''}`,
          });
        }
      });
    });

    // ── Периоды «Учёта выезда»: ПЛАН приезд→срок готовности, ФАКТ приезд→выезд ──
    const baseRanges: Array<{ a: number; b: number }> = [];
    myBases.forEach((p) => {
      p.warnings.forEach((w) => warnings.add(w));
      const dev = baseDeviation(p, today);
      const readyDay = p.plannedReadyDay;
      const readyTxt = readyDay != null ? fmtDM(readyDay) : 'не указан';
      const rb = baseBarRange(p, today);
      if (rb && visible(rb.a, rb.b)) {
        baseRanges.push({ a: rb.a, b: rb.b });
        factItems.push({
          kind: 'base',
          a: rb.a,
          b: rb.b,
          open: rb.open,
          label: rb.open ? `${p.causeLabel} · выезд не указан` : dev.short ? `${p.causeLabel} · ${dev.short}` : p.causeLabel,
          periodKey: p.key,
          title: `База (факт): приезд ${fmtDM(rb.a)} – ${rb.open ? 'выезд не указан (период продолжается)' : fmtDM(rb.b)} · срок готовности ${readyTxt} · ${dev.label}${p.comment ? ` · ${p.comment}` : ''}`,
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
          title: `План базы: приезд ${fmtDM(rdy.a)} → срок готовности ${fmtDM(rdy.b)}${dev.short ? ` · ${dev.label}` : ''}`,
        });
      }
      // Отметка срока готовности на подстроке «Факт» — для сравнения с выездом
      if (readyDay != null && visible(readyDay, readyDay)) {
        factItems.push({
          kind: 'markReady',
          day: readyDay,
          periodKey: p.key,
          title: `Срок готовности: ${fmtDM(readyDay)} — ${dev.label}`,
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
          title: `Ремонт: ${fmtDM(rr.a)} – ${rr.open ? 'продолжается (окончание не указано)' : fmtDM(rr.b)}${rr.capped ? ' · показан до фактического выезда (ремонт не закрыт)' : ''}`,
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

    // ── События машины (ручные, ветка модуля) — на подстроке «Факт» ──
    myEvents.forEach((e) => {
      const meta = eventTypeOf(e.kind);
      const a = dayNum(e.dateFrom);
      const b = dayNum(e.dateTo) ?? a;
      if (a == null || b == null || !visible(a, b)) return;
      factItems.push({
        kind: 'event',
        a,
        b,
        color: meta.color,
        label: e.note ? `${meta.name}: ${e.note}` : meta.name,
        title: `${meta.name} ${e.dateFrom} – ${e.dateTo || e.dateFrom}${e.note ? ` · ${e.note}` : ''}`,
      });
    });

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

    const empty = myTrips.length === 0 && myBases.length === 0;
    rows.push({
      carKey: car.carKey,
      carNumber: car.carNumber,
      carId: car.carId,
      dispatcherId: car.dispatcherId,
      dispatcherName: car.dispatcherName,
      tripsCount: myTrips.length,
      basesCount: myBases.filter((p) => p.arrivalDay != null).length,
      repairsCount: myBases.filter((p) => p.repairStartDay != null).length,
      warnings: Array.from(warnings),
      empty,
      planItems,
      factItems,
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
  onOpenTrip,
  onOpenBase,
  onOpenCar,
}: {
  row: CarRowModel;
  colW: number;
  vs: number;
  vn: number;
  bg: BgSeg[];
  onOpenTrip: (key: string) => void;
  onOpenBase: (key: string) => void;
  onOpenCar: (key: string) => void;
}) {
  const [hoverTrip, setHoverTrip] = useState<string | null>(null);
  const W = vn * colW;
  const pos = (a: number, b: number): { left: number; width: number } | null => {
    if (b < vs || a > vs + vn - 1) return null;
    const A = Math.max(a, vs);
    const B = Math.min(b, vs + vn - 1);
    return { left: Math.round((A - vs) * colW), width: Math.round((B - A + 1) * colW) };
  };
  const link = (tripKey: string): React.CSSProperties =>
    hoverTrip
      ? hoverTrip === tripKey
        ? { boxShadow: 'inset 0 0 0 2px var(--accent)' }
        : { boxShadow: 'inset 0 0 0 1px rgba(18,19,22,0.25)' }
      : {};
  const hoverProps = (tripKey: string) => ({
    onMouseEnter: () => setHoverTrip(tripKey),
    onMouseLeave: () => setHoverTrip((v) => (v === tripKey ? null : v)),
  });

  const warnTitle = row.warnings.join('\n');
  const bgPlane = (keyPrefix: string, opacity: number) =>
    bg.map((seg, i) => (
      <div
        key={`${keyPrefix}${i}`}
        className="absolute top-0 bottom-0"
        style={{
          left: seg.left,
          width: seg.width,
          background: seg.kind === 'weekend' ? CLR.weekend : CLR.today,
          opacity: seg.kind === 'weekend' ? opacity : 0.5,
        }}
      />
    ));

  return (
    <>
      {/* Подстрока «План» */}
      <div
        data-tl-row={row.carNumber}
        data-tl-car={row.carKey}
        className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2.5 pt-1.5 w-[170px] min-w-[170px] overflow-hidden"
      >
        <div className="flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenCar(row.carKey)}
            title="Обзор рейсов и периодов машины"
            className="text-[11px] font-semibold text-[#121316] leading-tight truncate text-left hover:text-[var(--accent-ink)] cursor-pointer"
          >
            {formatPlate(row.carNumber)}
          </button>
          <span className="text-[8px] font-semibold uppercase tracking-wider text-[#9CA3AF] shrink-0 pt-0.5">План</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-[#6B7280] truncate">
            {row.dispatcherName || 'без диспетчера'} · рейсов: {row.tripsCount}
          </span>
          {row.warnings.length ? (
            <span title={warnTitle} className="shrink-0" aria-label={warnTitle}>
              <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
            </span>
          ) : null}
        </div>
      </div>
      <div data-lane="plan" className="relative border-b border-[#EEF0F3]" style={{ width: W, height: PLAN_H }}>
        {bgPlane('bg', 0.75)}
        {row.planItems.map((it, idx) => {
          const p = pos(it.kind === 'markPlan' ? it.day : it.a, it.kind === 'markPlan' ? it.day : it.b);
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
                className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[16px] z-[2] cursor-pointer px-1 text-[#92400E]"
                style={{ left: p.left, width: p.width, top: 5, height: 16, background: hatchReady, border: `1px solid #F59E0B`, borderRadius: 3 }}
                title={it.title}
              >
                {p.width > 80 ? `готовность${it.deviation ? ` · ${it.deviation}` : ''}` : ''}
              </div>
            );
          }
          if (it.kind === 'plan') {
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
                  top: 5,
                  height: 16,
                  background: it.archived ? CLR.planArchBg : CLR.planBg,
                  border: `1px solid ${it.archived ? CLR.planArchBorder : CLR.planBorder}`,
                  color: it.archived ? CLR.planArchText : CLR.planText,
                  borderRadius: 3,
                  padding: '0 4px',
                  ...link(it.tripKey),
                }}
                title={it.title}
              >
                {it.level === 3 ? '⛔ ' : it.level === 2 ? '⚠ ' : ''}
                {it.open ? 'неполный план' : it.label}
              </div>
            );
          }
          if (it.kind === 'buffer') {
            return (
              <div
                key={`b${idx}`}
                data-bar="buffer"
                className="absolute z-[2]"
                style={{ left: p.left, width: p.width, top: 5, height: 16, background: hatch45, borderRadius: 3 }}
                title={`запас ${it.days} дн`}
              />
            );
          }
          return (
            <div
              key={`m${idx}`}
              data-bar={it.critical ? 'mark-critical' : 'mark-plan'}
              className="absolute z-[4]"
              style={{
                left: Math.round((it.day - vs) * colW + colW * 0.3),
                top: 2,
                height: 22,
                width: it.critical ? 3 : 2,
                background: it.critical ? CLR.markCritical : CLR.markPlan,
              }}
              title={`${it.weekend ? '⚠ дата на выходном · ' : ''}${it.title}`}
            />
          );
        })}
      </div>

      {/* Подстрока «Факт» */}
      <div className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2.5 pb-1.5 w-[170px] min-w-[170px] overflow-hidden">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[8px] font-semibold uppercase tracking-wider text-[#9CA3AF] pt-0.5">Факт</span>
          <span className="text-[9px] text-[#9CA3AF] tabular-nums">
            {row.basesCount ? `база: ${row.basesCount}` : ''}
            {row.basesCount && row.repairsCount ? ' · ' : ''}
            {row.repairsCount ? `ремонт: ${row.repairsCount}` : ''}
          </span>
        </div>
        {row.empty ? <div className="text-[10px] text-[#9CA3AF] mt-0.5">Нет рейсов в выбранном периоде</div> : null}
      </div>
      <div data-lane="fact" className="relative border-b border-[#E5E7EB]" style={{ width: W, height: FACT_H }}>
        {bgPlane('fbg', 0.6)}
        {row.factItems.map((it, idx) => {
          const p = pos(it.kind === 'markFact' || it.kind === 'markReady' ? it.day : it.a, it.kind === 'markFact' || it.kind === 'markReady' ? it.day : it.b);
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
                    top: 4,
                    height: 8,
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
                  className="absolute z-[2] cursor-pointer text-[9px] leading-[14px] text-[#9CA3AF] overflow-hidden whitespace-nowrap px-1"
                  style={{
                    left: p.left,
                    width: p.width,
                    top: 3,
                    height: 14,
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
                  className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[14px] z-[2] cursor-pointer px-1"
                  style={{ left: p.left, width: p.width, top: 16, height: 14, background: hatchBase, border: `1px solid ${CLR.baseBorder}`, borderRadius: 3, color: CLR.baseText }}
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
                  className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[10px] text-white z-[3] cursor-pointer px-1 text-center"
                  style={{ left: p.left, width: p.width, top: 18, height: 10, background: CLR.repair, opacity: 0.92, borderRadius: 2 }}
                  title={it.title}
                >
                  {p.width > 60 ? 'ремонт' : ''}
                </div>
              );
            case 'event':
              return (
                <div
                  key={`e${idx}`}
                  data-bar="event"
                  className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[14px] text-white z-[3] px-1 text-center"
                  style={{ left: p.left, width: p.width, top: 16, height: 14, background: it.color, opacity: 0.85, borderRadius: 3 }}
                  title={it.title}
                >
                  {p.width > 60 ? it.label : ''}
                </div>
              );
            case 'gap':
              return (
                <div
                  key={`g${idx}`}
                  data-bar="gap"
                  className="absolute overflow-hidden whitespace-nowrap text-[9px] leading-[14px] text-center z-[1]"
                  style={{ left: p.left, width: p.width, top: 16, height: 14, background: hatch135, border: `1px dashed ${CLR.gapBorder}`, borderRadius: 3, color: CLR.baseText }}
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
                  className="absolute z-[4] cursor-pointer"
                  style={{
                    left: Math.round((it.day - vs) * colW + colW * 0.45),
                    top: 2,
                    height: FACT_H - 4,
                    width: 3,
                    background: CLR.warn,
                    opacity: 0.85,
                  }}
                  title={it.title}
                />
              );
            case 'markFact': {
              return (
                <div
                  key={`mf${idx}`}
                  role="button"
                  tabIndex={0}
                  data-bar={it.late ? 'mark-late' : 'mark-fact'}
                  data-trip={it.tripKey}
                  onClick={() => onOpenTrip(it.tripKey)}
                  className="absolute z-[4] cursor-pointer"
                  style={{
                    left: Math.round((it.day - vs) * colW + colW * 0.6),
                    top: 2,
                    height: FACT_H - 4,
                    width: 2,
                    background: it.late ? CLR.markLate : CLR.markFact,
                  }}
                  title={`${it.weekend ? '⚠ дата на выходном · ' : ''}${it.title}`}
                />
              );
            }
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
  navVs,
  preset,
  onPresetChange,
  onNavigate,
  onRangeExtend,
  showArchived,
  onShowArchivedChange,
  onOpenTrip,
  onOpenBase,
  onOpenCar,
}: Props) {
  const ve = vs + vn - 1;
  const colW = colWidthFor(vn);
  const W = vn * colW;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wantTodayScroll = useRef(true);
  const prevExtL = useRef(extL);
  const lastExtend = useRef(0);

  const rows = useMemo(
    () => buildRows(trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today),
    [trips, bases, events, fleetCars, stageTypes, showArchived, vs, ve, today],
  );

  // Фоновая дорожка одна на всё окно: выходные и линия «сегодня»
  const bg = useMemo(() => {
    const segs: BgSeg[] = [];
    for (let d = vs; d <= ve; d += 1) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) segs.push({ left: Math.round((d - vs) * colW), width: colW, kind: 'weekend' });
      if (d === today) segs.push({ left: Math.round((d - vs) * colW + colW / 2 - 1), width: 2, kind: 'today' });
    }
    return segs;
  }, [vs, ve, colW, today]);

  // Прокрутка: при входе — к сегодняшнему дню; при возврате — сохранённая позиция
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem('ratipa_timeline_scroll') || 'null') as { vs: number; left: number } | null;
      if (saved && saved.vs === vs && !wantTodayScroll.current) {
        el.scrollLeft = saved.left || 0;
      }
    } catch {
      /* не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wantTodayScroll.current) return;
    wantTodayScroll.current = false;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (today - vs) * colW - 60);
  }, [vs, today, colW]);

  const persistScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      sessionStorage.setItem('ratipa_timeline_scroll', JSON.stringify({ vs: vs - extL, left: el.scrollLeft }));
    } catch {
      /* не критично */
    }
  }, [vs, extL]);

  // Догрузка дней по краям прокрутки: без пустоты и без скачка видимой области
  const handleScroll = useCallback(() => {
    persistScroll();
    const el = scrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (now - lastExtend.current < 250) return;
    if (el.scrollLeft < colW * 2 && extL < 400) {
      lastExtend.current = now;
      onRangeExtend('left');
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - colW * 2 && extL < 400) {
      lastExtend.current = now;
      onRangeExtend('right');
    }
  }, [persistScroll, colW, extL, onRangeExtend]);

  // Расширение слева сдвигает начало диапазона — компенсируем прокрутку,
  // чтобы видимая область осталась той же (без скачка).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = extL - prevExtL.current;
    prevExtL.current = extL;
    if (d > 0) el.scrollLeft = el.scrollLeft + d * colW;
  }, [extL, colW]);

  // После кнопочной навигации не догружаем даты мгновенно: пользователь ещё не
  // скроллил, а программное изменение scrollLeft не должно вызывать расширение.
  useEffect(() => {
    lastExtend.current = Date.now() + 800;
  }, [navVs, preset]);

  const goToday = useCallback(() => {
    wantTodayScroll.current = true;
    onNavigate(today - 10);
  }, [onNavigate, today]);

  const shiftMonth = useCallback(
    (dir: 1 | -1) => {
      const next = dayNum(addMonthsIso(dayStr(navVs), dir));
      if (next != null) onNavigate(next);
    },
    [onNavigate, navVs],
  );

  return (
    <div className="flex flex-col">
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
        <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          Период
          <select
            data-ui="period"
            value={preset}
            onChange={(e) => onPresetChange(e.target.value as PeriodPreset)}
            className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none cursor-pointer focus:border-[var(--accent)]"
          >
            {PERIOD_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-[#6B7280] tabular-nums" data-ui="range-label">
          {fmtDM(vs)} – {fmtDM(ve)} · {vn} дн
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280] cursor-pointer select-none py-1">
          <input
            type="checkbox"
            data-ui="show-archived"
            checked={showArchived}
            onChange={(e) => onShowArchivedChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
          />
          показывать архивные рейсы
        </label>
      </div>

      {/* Сетка */}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6B7280]">
          В выбранной вкладке нет машин. Проверьте вкладку диспетчера или добавьте рейс кнопкой «Новый рейс».
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-ui="timeline-scroll"
          className="tl-scroll overflow-auto overscroll-x-contain border border-[#E5E7EB] rounded-xl bg-[#F9FAFB] max-h-[68vh] min-h-[280px]"
        >
          <style>{`.tl-scroll{scrollbar-width:thin;scrollbar-color:#B6BBC2 #F3F4F6;}
.tl-scroll::-webkit-scrollbar{height:12px;width:12px;}
.tl-scroll::-webkit-scrollbar-track{background:#F3F4F6;border-radius:8px;}
.tl-scroll::-webkit-scrollbar-thumb{background:#C3C8CF;border-radius:8px;border:2px solid #F3F4F6;}
.tl-scroll::-webkit-scrollbar-thumb:hover{background:#9CA3AF;}`}</style>
          <div className="grid min-w-max" style={{ gridTemplateColumns: `170px ${W}px` }}>
            {/* Шапка — закреплена и прокручивается синхронно с полосами */}
            <div className="sticky left-0 top-0 z-[6] bg-[#F9FAFB] border-b border-r border-[#E5E7EB] px-2.5 py-1.5 w-[170px] min-w-[170px]">
              <span className="text-[10px] text-[#6B7280] tabular-nums">
                {fmtDM(vs)} – {fmtDM(ve)}
              </span>
            </div>
            <div className="sticky top-0 z-[5] bg-[#F9FAFB] border-b border-[#E5E7EB] flex" style={{ width: W }}>
              {Array.from({ length: vn }, (_, i) => vs + i).map((d) => {
                const wd = new Date(d * 86400000).getUTCDay();
                const isWeekend = wd === 0 || wd === 6;
                const isToday = d === today;
                const wide = colW >= 24;
                const showNarrow = colW < 24 && (d === vs || new Date(d * 86400000).getUTCDate() === 1 || wd === 1);
                return (
                  <div
                    key={d}
                    className="flex-none text-center text-[9px] leading-tight pt-1 overflow-hidden"
                    style={{
                      width: colW,
                      background: isWeekend ? CLR.weekend : undefined,
                      color: isToday ? CLR.today : '#6B7280',
                      boxShadow: isToday ? `inset 0 -2px 0 ${CLR.today}` : undefined,
                    }}
                  >
                    {wide ? (
                      <>
                        <b className="block text-[10px] text-[#121316] font-semibold">{dayHeaderLabel(d)}</b>
                        <span>{WEEKDAYS_RU[wd]}</span>
                      </>
                    ) : showNarrow ? (
                      <b className="text-[8px]">{dayHeaderLabel(d)}</b>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Группы машин: «План» сверху, «Факт» снизу */}
            {rows.map((row) => (
              <TimelineCarRow
                key={row.carKey}
                row={row}
                colW={colW}
                vs={vs}
                vn={vn}
                bg={bg}
                onOpenTrip={onOpenTrip}
                onOpenBase={onOpenBase}
                onOpenCar={onOpenCar}
              />
            ))}
          </div>
        </div>
      )}

      {/* Легенда */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#6B7280] mt-3">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: CLR.planBg, border: `1px solid ${CLR.planBorder}` }} />
          рейс (план — из «Плана дохода»)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatch45 }} />
          запас на риски
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[6px] rounded-[2px]" style={{ background: CLR.fact, opacity: 0.65 }} />
          факт (только заполненные фактические даты)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchOpen, border: `1px dashed ${CLR.fact}` }} />
          факт продолжается (окончание не указано)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: CLR.planNoneBg, border: `1px dashed ${CLR.planNoneBorder}` }} />
          «Факт не указан»
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchBase, border: `1px solid ${CLR.baseBorder}` }} />
          база: факт (приезд → выезд)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: hatchReady, border: '1px solid #F59E0B' }} />
          база: план (приезд → срок готовности)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[8px] rounded-[2px]" style={{ background: CLR.repair }} />
          ремонт (внутри базы)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[18px] h-[10px] rounded-[2px]" style={{ background: '#7C3AED', opacity: 0.85 }} />
          событие машины
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[3px] h-[12px]" style={{ background: CLR.markCritical }} />
          критический дедлайн
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-[3px] h-[12px]" style={{ background: CLR.warn, opacity: 0.7 }} />
          плановая готовность (учёт выезда)
        </span>
      </div>
      <p className="text-[10px] text-[#9CA3AF] mt-2">
        Клик по плановой или фактической полосе открывает модальное окно всего рейса; клик по названию машины — обзор её рейсов и периодов.
        Периоды базы и ремонта открываются кликом по полосе. Календарь прокручивается по горизонтали (тачпад, колесо с Shift, полоса прокрутки) —
        прокрутка догружает даты влево и вправо; выходные подсвечены фоном.
      </p>
    </div>
  );
}
