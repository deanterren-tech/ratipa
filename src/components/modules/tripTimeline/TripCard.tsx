/**
 * МОДАЛЬНОЕ ОКНО ЦЕЛОГО РЕЙСА (ручного или связанного с «Планом дохода»).
 *
 * Внутри: основные сведения (авто, диспетчер, название/маршрут, статус, архив),
 * плановые и фактические границы со сравнением, отдельные многострочные поля
 * «Причина» и «Меры при просрочке» (по рейсу — здесь, по этапу — в раскрываемой
 * области этого этапа), плечи из плана дохода, таблица этапов, события машины и
 * встроенный таймлайн этой машины с фокусом на выбранном рейсе.
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { LegPlan, TimelineStage, TimelineStageType, TimelineVehicleEvent } from '../../../types';
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
import {
  WEEKEND_HINT,
  WEEKDAYS_RU,
  comparePlanFact,
  computeStoredRange,
  dayNum,
  dayStr,
  fmtDev,
  fmtFull,
  getDeadlineStatus,
  hasWeekendInRange,
  isStageLate,
  isTripFactOngoing,
  isWeekendDay,
  stageDeviation,
  tripFactEnd,
  tripSpan,
} from './lib/timeline';
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  rows?: number;
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
      onChange={(e) => onChange(e.target.value)}
      className={TEXTAREA_CLS}
    />
  );
}

const isoOf = (day: number | null): string => (day == null ? '' : dayStr(day));
const money = (v?: number, cur = '€') => (v == null ? '—' : `${v.toLocaleString('ru-RU')} ${cur}`);

interface Meta {
  reason: string;
  measures: string;
}

interface Props {
  trip: WholeTrip;
  stageTypes: TimelineStageType[];
  dispatchers: DispatcherOption[];
  today: number;
  canWrite: boolean;
  /** Право на редактирование связанного плана дохода (как в самом модуле). */
  canEditPlan: boolean;
  /** Общие тексты рейса (Причина / Меры) из tripTimeline/tripMeta. */
  meta: Meta;
  onSaveMeta: (key: string, patch: Partial<Meta>) => void;
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

const MINI_COL = 26;
const MINI_PLAN_H = 26;
const MINI_FACT_H = 32;

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
}: {
  focusKey: string;
  carTrips: WholeTrip[];
  carBases: BasePeriod[];
  carEvents: TimelineVehicleEvent[];
  stageTypes: TimelineStageType[];
  today: number;
  onSelectTrip: (tripKey: string) => void;
}) {
  const focus = carTrips.find((t) => t.key === focusKey) || null;
  const focusSpan = focus ? tripSpan(focus) : null;
  const anchorStart = focus?.spanOverride?.pMin ?? focusSpan?.pMin ?? focusSpan?.fMin ?? today - 10;
  const anchorEnd = focus?.spanOverride?.pMax ?? focusSpan?.fMax ?? focusSpan?.pMax ?? today;
  const initialStart = Math.min(anchorStart, anchorEnd) - 7;
  const initialEnd = Math.max(anchorStart, anchorEnd) + 7;
  const initialVn = Math.max(30, initialEnd - initialStart + 1);
  const [vs, setVs] = useState(initialStart);
  const [vn, setVn] = useState(initialVn);
  const [extL, setExtL] = useState(0);
  const [extR, setExtR] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevExtL = useRef(0);
  const lastExtend = useRef(0);

  const renderVs = vs - extL;
  const renderVn = vn + extL + extR;
  const ve = renderVs + renderVn - 1;
  const W = renderVn * MINI_COL;
  const pos = (a: number, b: number) => {
    if (b < renderVs || a > ve) return null;
    const A = Math.max(a, renderVs);
    const B = Math.min(b, ve);
    return { left: Math.round((A - renderVs) * MINI_COL), width: Math.round((B - A + 1) * MINI_COL) };
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = extL - prevExtL.current;
    prevExtL.current = extL;
    if (d > 0) el.scrollLeft += d * MINI_COL;
  }, [extL]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (anchorStart - vs) * MINI_COL - 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = Date.now();
    if (now - lastExtend.current < 250) return;
    if (el.scrollLeft < MINI_COL * 2 && extL < 300) {
      lastExtend.current = now;
      setExtL((v) => v + 30);
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - MINI_COL * 2 && extR < 300) {
      lastExtend.current = now;
      setExtR((v) => v + 30);
    }
  }, [extL, extR]);

  const toFocus = useCallback(() => {
    setExtL(0);
    setExtR(0);
    setVs(initialStart);
    setVn(initialVn);
    window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, (anchorStart - initialStart) * MINI_COL - 60);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStart, initialVn, anchorStart]);

  const bgWeekend = useMemo(() => {
    const segs: Array<{ left: number; width: number }> = [];
    for (let d = renderVs; d <= ve; d += 1) {
      const wd = new Date(d * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) segs.push({ left: Math.round((d - renderVs) * MINI_COL), width: MINI_COL });
    }
    return segs;
  }, [renderVs, ve]);

  const link = (key: string): React.CSSProperties =>
    key === focusKey ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : { opacity: 0.85 };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-[#6B7280] tabular-nums">
          {fmtFull(isoOf(renderVs))} – {fmtFull(isoOf(ve))}
        </span>
        <button type="button" data-ui="mini-to-focus" onClick={toFocus} className={UI.buttonGhost}>
          К выбранному рейсу
        </button>
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
          <div className="sticky top-0 z-[5] bg-[#F9FAFB] border-b border-[#E5E7EB] flex" style={{ width: W }}>
            {Array.from({ length: renderVn }, (_, i) => renderVs + i).map((d) => {
              const wd = new Date(d * 86400000).getUTCDay();
              const isWeekend = wd === 0 || wd === 6;
              const showWd = new Date(d * 86400000).getUTCDate() % 5 === 1;
              return (
                <div
                  key={d}
                  className="flex-none text-center text-[8px] leading-tight pt-0.5 overflow-hidden"
                  style={{ width: MINI_COL, background: isWeekend ? '#F1F2F4' : undefined, color: '#6B7280' }}
                >
                  <b className="block text-[9px] text-[#121316]">{new Date(d * 86400000).getUTCDate()}</b>
                  {showWd ? WEEKDAYS_RU[wd] : ''}
                </div>
              );
            })}
          </div>

          {/* План */}
          <div className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#EEF0F3] px-2 py-1 w-[96px] min-w-[96px] text-[9px] text-[#9CA3AF]">
            {focus ? formatPlate(focus.carNumber) : ''} · план
          </div>
          <div data-lane="plan" className="relative border-b border-[#EEF0F3]" style={{ width: W, height: MINI_PLAN_H }}>
            {bgWeekend.map((s, i) => (
              <div key={`w${i}`} className="absolute top-0 bottom-0" style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.7 }} />
            ))}
            {carBases.map((p) => {
              const rdy = readyBarRange(p);
              if (!rdy) return null;
              const q = pos(rdy.a, rdy.b);
              if (!q) return null;
              const dev = baseDeviation(p, today);
              return (
                <div
                  key={`rdy-${p.key}`}
                  data-bar="ready"
                  className="absolute z-[2] overflow-hidden whitespace-nowrap text-[9px] leading-[16px] px-1 text-[#92400E]"
                  style={{ left: q.left, width: q.width, top: 5, height: 16, background: hatchReady, border: '1px solid #F59E0B', borderRadius: 3 }}
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
                    top: 5,
                    height: 16,
                    background: t.archived ? '#E5E7EB' : '#DBEAFE',
                    border: `1px solid ${t.archived ? '#9CA3AF' : '#60A5FA'}`,
                    color: t.archived ? '#6B7280' : '#1E3A8A',
                    borderRadius: 3,
                    ...link(t.key),
                  }}
                  title={`${formatPlate(t.carNumber)} · ${t.route || 'без маршрута'}${t.archived ? ' · архив' : ''}${t.key === focusKey ? ' · выбранный рейс' : ' · соседний рейс (контекст)'}`}
                >
                  {q.width > 70 ? t.route || '' : ''}
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
              return (
                <div
                  key={`buf-${t.key}`}
                  data-bar="buffer"
                  className="absolute z-[2]"
                  style={{ left: q.left, width: q.width, top: 5, height: 16, background: hatchBuffer, borderRadius: 3 }}
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
                    className="absolute z-[4]"
                    style={{
                      left: q.left + Math.round(MINI_COL * 0.3),
                      top: 2,
                      height: MINI_PLAN_H - 4,
                      width: s.isCritical ? 3 : 2,
                      background: s.isCritical ? '#DC2626' : '#2563EB',
                    }}
                    title={`${s.isCritical ? 'КРИТИЧЕСКИЙ СРОК: ' : 'план: '}${stageFullName(stageTypes, s)} ${s.plannedDate}`}
                  />
                );
              }),
            )}
          </div>

          {/* Факт */}
          <div className="sticky left-0 z-[3] bg-[#F9FAFB] border-r border-b border-[#E5E7EB] px-2 py-1 w-[96px] min-w-[96px] text-[9px] text-[#9CA3AF]">
            факт · база · ремонт
          </div>
          <div data-lane="fact" className="relative border-b border-[#E5E7EB]" style={{ width: W, height: MINI_FACT_H }}>
            {bgWeekend.map((s, i) => (
              <div key={`fw${i}`} className="absolute top-0 bottom-0" style={{ left: s.left, width: s.width, background: '#F1F2F4', opacity: 0.6 }} />
            ))}
            {carBases.map((p) => {
              const dev = baseDeviation(p, today);
              const rb = baseBarRange(p, today);
              const rr = repairBarRange(p, today);
              const qb = rb ? pos(rb.a, rb.b) : null;
              const qr = rr ? pos(rr.a, rr.b) : null;
              return (
                <React.Fragment key={`base-${p.key}`}>
                  {qb ? (
                    <div
                      data-bar="base"
                      className="absolute z-[2] overflow-hidden whitespace-nowrap text-[9px] leading-[14px] px-1 text-[#4B5563]"
                      style={{ left: qb.left, width: qb.width, top: 16, height: 14, background: hatchBase, border: '1px solid #9CA3AF', borderRadius: 3 }}
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
                      className="absolute z-[3] text-center text-[9px] leading-[10px] text-white px-1"
                      style={{ left: qr.left, width: qr.width, top: 18, height: 10, background: '#D97706', opacity: 0.92, borderRadius: 2 }}
                      title={`Ремонт: ${fmtFull(isoOf(rr ? rr.a : null))} – ${rr && rr.open ? 'не завершён' : fmtFull(isoOf(rr ? rr.b : null))}`}
                    >
                      {qr.width > 60 ? 'ремонт' : ''}
                    </div>
                  ) : null}
                </React.Fragment>
              );
            })}
            {carEvents.map((e) => {
              const a = dayNum(e.dateFrom);
              const b = dayNum(e.dateTo) || a;
              if (a == null) return null;
              const q = pos(a, b ?? a);
              if (!q) return null;
              const meta = eventTypeOf(e.kind);
              return (
                <div
                  key={`ev-${e.id}`}
                  data-bar="event"
                  className="absolute z-[3] text-center text-[9px] leading-[14px] text-white px-1 overflow-hidden whitespace-nowrap"
                  style={{ left: q.left, width: q.width, top: 16, height: 14, background: meta.color, opacity: 0.85, borderRadius: 3 }}
                  title={`${meta.name} ${e.dateFrom} – ${e.dateTo || e.dateFrom}${e.note ? ` · ${e.note}` : ''}`}
                >
                  {q.width > 60 ? meta.name : ''}
                </div>
              );
            })}
            {carTrips.map((t) => {
              const sp = tripSpan(t);
              if (sp.fMin == null) return null;
              const endDay = tripFactEnd(t);
              const ongoing = endDay == null && !t.archived;
              const fEnd = ongoing ? Math.max(today, sp.fMax ?? sp.fMin) : (endDay ?? sp.fMax ?? sp.fMin);
              const q = pos(sp.fMin, fEnd);
              if (!q) return null;
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
                    top: 4,
                    height: 8,
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
              return (
                <div
                  key={`fn-${t.key}`}
                  data-bar="fact-none"
                  className="absolute z-[2] text-[8px] leading-[14px] text-[#9CA3AF] px-1 overflow-hidden whitespace-nowrap"
                  style={{ left: q.left, width: q.width, top: 3, height: 14, border: '1px dashed #9CA3AF', borderRadius: 2, background: '#F9FAFB' }}
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
                  style={{ left: q.left + Math.round(MINI_COL * 0.45), top: 2, height: MINI_FACT_H - 4, width: 3, background: '#B45309', opacity: 0.85 }}
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
                    className="absolute z-[4]"
                    style={{
                      left: q.left + Math.round(MINI_COL * 0.6),
                      top: 2,
                      height: MINI_FACT_H - 4,
                      width: 2,
                      background: dev != null && dev > 0 ? '#E11D48' : '#10B981',
                    }}
                    title={`факт: ${stageFullName(stageTypes, s)} ${s.actualDate}${dev != null ? ` (${dev > 0 ? '+' : ''}${dev} дн)` : ''}`}
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
  meta,
  onSaveMeta,
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
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [planDatesError, setPlanDatesError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const saver = useDebouncedSaver();
  const flush = saver.flush;
  const isPlan = trip.kind === 'plan';
  const planSourceId = trip.plan?.id || '';
  const archived = !!trip.archived;
  const readOnly = archived || !canWrite;

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
    if (dirtyRef.current) {
      const ok = window.confirm('Есть несохранённые изменения. Сохранить и закрыть? «Отмена» — остаться в окне.');
      if (!ok) return;
      flush();
    }
    onClose();
  }, [flush, onClose]);
  requestCloseRef.current = requestClose;

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
    if (isPlan) {
      saver.queueAutoStage(planSourceId, stageId, { [field]: value });
    } else {
      saver.queueStage(trip.id, stageId, { [field]: value });
      if (field === 'plannedDate' || field === 'actualDate') {
        saver.queueTrip(trip.id, computeStoredRange({ ...trip, stages: nextStages }));
      }
    }
  };

  const addStage = () => {
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
    if (isPlan) dbService.addTimelineTripStage(planSourceId, { ...stage });
    else dbService.addTimelineStage(trip.id, { ...stage });
  };

  const removeStage = (stageId: string) => {
    flush();
    markDirty();
    if (isPlan) dbService.deleteTimelineTripStage(planSourceId, stageId);
    else dbService.deleteTimelineStage(trip.id, stageId);
    const rest = draft.stages.filter((s) => s.id !== stageId);
    setDraft((d) => ({ ...d, stages: rest }));
    if (!isPlan) saver.queueTrip(trip.id, computeStoredRange({ ...trip, stages: rest }));
  };

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

  const onMeta = (patch: Partial<Meta>) => {
    setMetaDraft((m) => ({ ...m, ...patch }));
    onSaveMeta(trip.key, patch);
  };

  return (
    <ModalShell
      isOpen
      onClose={requestClose}
      title={title}
      subtitle={`${isPlan ? 'Рейс из «Плана дохода»' : 'Ручной рейс'}${archived ? ' · архив (просмотр)' : ''} · ${dispatcherShown}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel={`Рейс ${title}`}
      maxWidth="max-w-4xl"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          {isPlan ? (
            <>
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
            </>
          ) : null}
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
            {dirty ? <span className="text-amber-700 font-semibold">есть несохранённые изменения</span> : null}
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

        {/* План и факт: границы и сравнение */}
        <div className="border border-[#E5E7EB] rounded-xl overflow-hidden">
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

        {/* Причина и меры при просрочке — по рейсу */}
        <div className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#121316]">Причина и меры при просрочке (по рейсу)</span>
            <span className="text-[10px] text-[#9CA3AF]">отдельные тексты; не удаляются при изменении дат</span>
          </div>
          <label className="flex flex-col gap-1">
            <span className={UI.fieldLabel}>Причина</span>
            <AutoGrow
              value={metaDraft.reason}
              onChange={(v) => onMeta({ reason: v })}
              disabled={readOnly}
              ariaLabel="Причина просрочки по рейсу"
              placeholder="Опишите причину отклонения от планового срока (по всему рейсу)"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={UI.fieldLabel}>Меры при просрочке</span>
            <AutoGrow
              value={metaDraft.measures}
              onChange={(v) => onMeta({ measures: v })}
              disabled={readOnly}
              ariaLabel="Меры при просрочке по рейсу"
              placeholder="Укажите принятые или планируемые меры"
            />
          </label>
        </div>

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
            <div className={UI.hint}>
              Архивный статус изменяется в плане дохода; кнопка «Открыть план дохода» ведёт по прямой ссылке к этой записи, в том числе архивной.
            </div>
          </div>
        ) : null}

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

        {/* Этапы */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left min-w-[880px]">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Этап</th>
                <th className={UI.th}>Уточнение</th>
                <th className={UI.th}>План</th>
                <th className={UI.th}>Факт</th>
                <th className={UI.th}>Откл.</th>
                <th className={UI.th}>Крит. срок</th>
                <th className={UI.th}>Причина и меры</th>
                <th className={UI.th}>{''}</th>
              </tr>
            </thead>
            <tbody>
              {draft.stages.map((s) => {
                const dev = stageDeviation(s);
                const late = isStageLate(s, today);
                const pDay = dayNum(s.plannedDate);
                const fDay = dayNum(s.actualDate);
                const hasText = !!(s.reason || s.action);
                const expanded = expandedStage === s.id;
                return (
                  <React.Fragment key={s.id}>
                    <tr data-stage={s.id} className="border-b border-[#E5E7EB]">
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
                          <DateInput value={s.plannedDate || ''} disabled={readOnly} ariaLabel="Плановая дата этапа" onChange={(v) => onStageField(s.id, 'plannedDate', v)} />
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
                        <span className={`text-[11px] font-semibold ${dev != null && dev > 0 ? 'text-rose-600' : dev != null && dev < 0 ? 'text-emerald-600' : 'text-[#6B7280]'}`}>
                          {fmtDev(dev)}
                        </span>
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
                        <button
                          type="button"
                          data-ui="stage-reason-toggle"
                          aria-expanded={expanded}
                          onClick={() => setExpandedStage(expanded ? null : s.id)}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] border transition-colors cursor-pointer ${
                            expanded ? 'border-[var(--accent-30)] text-[var(--accent-ink)] bg-[var(--accent-10)]' : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#121316]'
                          }`}
                          title="Причина и меры относятся именно к этому этапу"
                        >
                          {late ? 'просрочен · ' : ''}
                          {hasText ? 'Причина и меры указаны' : 'Причина и меры'}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        {!readOnly ? (
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
                    {expanded ? (
                      <tr data-ui="stage-reason-panel" className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-semibold text-[#6B7280]">
                              Причина и меры — этап «{stageFullName(stageTypes, s)}»{s.plannedDate ? ` (план ${s.plannedDate})` : ''}
                            </span>
                            <label className="flex flex-col gap-1">
                              <span className={UI.fieldLabel}>Причина</span>
                              <AutoGrow
                                value={s.reason || ''}
                                onChange={(v) => onStageField(s.id, 'reason', v)}
                                disabled={readOnly}
                                ariaLabel={`Причина просрочки этапа ${stageFullName(stageTypes, s)}`}
                                placeholder="Опишите причину отклонения от планового срока по этому этапу"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={UI.fieldLabel}>Меры при просрочке</span>
                              <AutoGrow
                                value={s.action || ''}
                                onChange={(v) => onStageField(s.id, 'action', v)}
                                disabled={readOnly}
                                ariaLabel={`Меры при просрочке этапа ${stageFullName(stageTypes, s)}`}
                                placeholder="Укажите принятые или планируемые меры"
                              />
                            </label>
                            {s.reason && !s.action ? (
                              <div className="text-[10px] text-[#6B7280]">
                                Ранее заполнена только причина — текст не разделён автоматически. При необходимости продублируйте его в «Меры»:
                                {!readOnly ? (
                                  <button type="button" className="ml-2 underline text-[var(--accent-ink)] cursor-pointer" onClick={() => onStageField(s.id, 'action', s.reason || '')}>
                                    продублировать причину в меры
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
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
        {!readOnly ? (
          <div>
            <button type="button" data-ui="add-stage" onClick={addStage} className={UI.buttonGhost}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              добавить этап
            </button>
          </div>
        ) : null}

        {/* События машины за период рейса */}
        <div className="flex flex-col gap-1.5">
          <span className={UI.sectionTitle}>События машины за период рейса</span>
          {carEvents.length ? (
            <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB]">
              {carEvents.map((e) => {
                const em = eventTypeOf(e.kind);
                return (
                  <div key={e.id} className="px-3 py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-1">
                    <span className="font-semibold text-[#121316]">{em.name}</span>
                    <span className="text-[#6B7280]">
                      {fmtFull(e.dateFrom)} – {fmtFull(e.dateTo || e.dateFrom)}
                    </span>
                    {e.note ? <span className="text-[#6B7280]">{e.note}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={UI.hint}>События машины за этот период не зафиксированы.</div>
          )}
        </div>

        {/* Встроенный таймлайн этой машины */}
        <div className="flex flex-col gap-2">
          <span className={UI.sectionTitle}>Таймлайн машины {formatPlate(trip.carNumber)}</span>
          <CarMiniTimeline
            focusKey={trip.key}
            carTrips={carTrips}
            carBases={carBases}
            carEvents={carEvents}
            stageTypes={stageTypes}
            today={today}
            onSelectTrip={onSelectTrip}
          />
        </div>
      </div>
    </ModalShell>
  );
}

/** Плановая дата начала рейса (для сортировок в родителе). */
export const planStartOf = (t: WholeTrip): number => tripSpan(t).pMin ?? 0;
