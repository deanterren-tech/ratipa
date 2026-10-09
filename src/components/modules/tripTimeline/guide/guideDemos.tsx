/**
 * Демо-иллюстрации гайда: ЖИВЫЕ мини-фрагменты таймлайна на ИЗОЛИРОВАННЫХ
 * демо-данных (объявлены в этом файле, в реальную базу ничего не пишется).
 *
 * Все цвета, подписи, геометрия и статусы считаются ТЕМИ ЖЕ функциями, что и
 * полотно таймлайна:
 *  - факт — lib/factSegments (factSegmentsOf → сегменты, фактические пороги);
 *  - база и ремонт — lib/bzFills (layoutBzFills → непрерывные полосы/отметки,
 *    статусы через vyezdStatusOf);
 *  - цвета/маркеры/бейджи — lib/visuals, lib/bzFills, lib/vyezd;
 *  - геометрия «дата → координата» — lib/timeline (barRectInWindow, dayToX).
 * Поэтому мини-фрагменты не могут «разойтись» с реальным дизайном.
 */
import React from 'react';
import { CarFront, LogIn, LogOut, TriangleAlert, Wrench } from 'lucide-react';
import { dayNum, dayStr, barRectInWindow, dayToX, fmtDM } from '../lib/timeline';
import { factSegmentsOf, FACT_SEGMENT_COLORS, type FactSegment } from '../lib/factSegments';
import { layoutBzFills, bzStripeColor, bzKindColor, type BzMark, type BzStripe } from '../lib/bzFills';
import type { BasePeriod } from '../lib/sources';
import { stageColorOf } from '../lib/stageFills';
import { PLAN_ACCENT, MARKER_TONE, circleBadgeStyle } from '../lib/visuals';
import { directionChipColors, DEFAULT_DIRECTIONS } from '../lib/directions';
import { vyezdStatusIcon } from '../lib/vyezd';
import type { TimelineStage } from '../../../../types';
import type { DemoId } from './guideContent';

// ---------------------------------------------------------------------------
// Изолированные демо-данные (фиксированные даты — иллюстрации не «плывут»)
// ---------------------------------------------------------------------------

/** Начало демо-календаря: 5 октября 2026 (демо-окно 16 дней). */
const D0 = dayNum('2026-10-05') ?? 0;
/** «Сегодня» для демо: 11 октября 2026 — влияет только на отрисовку открытых периодов. */
const TODAY = D0 + 6;

const st = (id: string, type: string, label: string, planned: number | null, actual: number | null, isCritical = false): TimelineStage => ({
  id,
  type,
  label,
  plannedDate: planned == null ? '' : dayStr(planned),
  actualDate: actual == null ? '' : dayStr(actual),
  isCritical,
  reason: '',
  action: '',
  order: 0,
});

interface DemoBaseSpec {
  arrival: number;
  ready?: number | null;
  departure?: number | null;
  repairStart?: number | null;
  repairEnd?: number | null;
}

/** BasePeriod для layoutBzFills — все границы передаём числами дней. */
const makePeriod = (id: string, spec: DemoBaseSpec): BasePeriod => ({
  id,
  key: `bz:${id}`,
  carKey: 'car:demo',
  carId: 'demo',
  carNumber: 'ДЕМО 0001',
  dispatcherId: '',
  dispatcherName: '',
  arrivalDay: spec.arrival,
  departureDay: spec.departure ?? null,
  repairStartDay: spec.repairStart ?? null,
  repairEndDay: spec.repairEnd ?? null,
  plannedReadyDay: spec.ready ?? null,
  causeLabel: 'На базе',
  causeKind: 'base',
  comment: '',
  archived: false,
  openBase: (spec.departure ?? null) == null,
  openRepair: (spec.repairStart ?? null) != null && (spec.repairEnd ?? null) == null && (spec.departure ?? null) == null,
  repairCappedByDeparture: (spec.repairStart ?? null) != null && (spec.repairEnd ?? null) == null && (spec.departure ?? null) != null,
  warnings: [],
});

// ---------------------------------------------------------------------------
// Примитивы отрисовки (единая геометрия и стили полос — как на полотне)
// ---------------------------------------------------------------------------

const COL_W = 16;
/** Высоты/отступы — как у настоящих подстрок (PLAN_H/FACT_H = 22). */
const ROW_H = 24;
const PLAN_BAR_H = 16;
const FACT_BAR_H = 10;
/** Ширина подписи строки демо (слева от ленты). */
const LABEL_W = 110;

const DemoFrame = ({
  title,
  caption,
  days,
  children,
}: {
  title: string;
  caption?: string;
  days: number;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl border border-[#E5E7EB] bg-white p-2.5" data-guide-demo>
    <div className="text-[11px] font-semibold text-[#121316]">{title}</div>
    <div className="mt-1.5 overflow-x-auto">
      <div style={{ width: LABEL_W + days * COL_W }}>{children}</div>
    </div>
    {caption ? <div className="mt-1.5 text-[10px] leading-[14px] text-[#6B7280]">{caption}</div> : null}
  </div>
);

const DemoRow = ({
  label,
  days,
  height = ROW_H,
  children,
}: {
  label: string;
  days: number;
  height?: number;
  children: React.ReactNode;
}) => (
  <div className="flex items-stretch" style={{ height }}>
    <div
      className="shrink-0 pr-1.5 flex items-center justify-end text-[9px] font-semibold text-right leading-[11px] text-[#9CA3AF] select-none"
      style={{ width: LABEL_W }}
    >
      {label}
    </div>
    <div className="relative flex-1 border-b border-[#F1F2F4]" style={{ width: days * COL_W, height }}>
      {children}
    </div>
  </div>
);

const rect = (a: number, b: number, days: number): { left: number; width: number } | null =>
  barRectInWindow(a, b, D0, D0 + days - 1, COL_W);

/** X дня внутри демо-окна (окно начинается в D0 — единая формула с полотном). */
const xOf = (day: number): number => dayToX(day, D0, COL_W);

/** Плановая полоса — та же палитра, что у реальной полосы (PLAN_ACCENT). */
const PlanBar = ({
  a,
  b,
  days,
  label,
  circle,
  circleTotal = 2,
  dirCode,
  dirColor,
}: {
  a: number;
  b: number;
  days: number;
  label: string;
  circle?: number;
  circleTotal?: number;
  dirCode?: string;
  dirColor?: string;
}) => {
  const p = rect(a, b, days);
  if (!p) return null;
  const chip = dirCode ? directionChipColors(dirColor || DEFAULT_DIRECTIONS[0].color) : null;
  return (
    <div
      className="absolute flex items-center gap-0.5 overflow-hidden whitespace-nowrap"
      style={{
        left: p.left,
        width: p.width,
        top: 3,
        height: PLAN_BAR_H,
        zIndex: 2,
        background: PLAN_ACCENT.bg,
        border: `1px solid ${PLAN_ACCENT.border}`,
        borderRadius: 'var(--tl-bar-r)',
        color: PLAN_ACCENT.text,
      }}
    >
      {dirColor ? (
        <span aria-hidden="true" className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: dirColor }} />
      ) : null}
      {circle != null ? (
        <span
          className="inline-flex items-center justify-center shrink-0 w-[14px] h-[14px] rounded-full text-[8px] leading-none font-bold tabular-nums select-none ml-0.5"
          style={circleBadgeStyle(circleTotal, false)}
        >
          {circle}
        </span>
      ) : null}
      <span
        data-bar-label="1"
        className="inline-flex items-center min-w-0 px-1 text-[8px] leading-[10px] font-semibold truncate"
      >
        {label}
      </span>
      {chip ? (
        <span
          className="inline-flex items-center h-[12px] px-1 rounded-[4px] text-[8px] leading-[12px] font-semibold shrink-0 ml-auto mr-0.5"
          style={{ background: chip.bg, border: `1px solid ${chip.border}`, color: chip.text }}
        >
          {dirCode}
        </span>
      ) : null}
    </div>
  );
};

/** Маркер планового возвращения — та же синяя линия, что на полотне. */
const ReturnMark = ({ day, days }: { day: number; days: number }) => {
  const x = xOf(day) + COL_W - 3;
  return (
    <span
      className="absolute"
      title={`плановое возвращение: ${fmtDM(day)}`}
      style={{ left: x, top: 3, height: PLAN_BAR_H, width: 3, zIndex: 4, background: '#2563EB', borderRadius: 2 }}
    />
  );
};

/** Фактическая полоса: те же сегменты, что считает lib/factSegments. */
const FactBar = ({ a, b, days, segments }: { a: number; b: number; days: number; segments: FactSegment[] }) => {
  const p = rect(a, b, days);
  if (!p) return null;
  const firstColor = FACT_SEGMENT_COLORS[segments[0]?.color ?? 'neutral'];
  return (
    <div
      className="absolute top-0 bottom-0 overflow-hidden"
      style={{
        left: p.left,
        width: p.width,
        top: 6,
        height: FACT_BAR_H,
        background: firstColor.bg,
        border: `1px solid ${firstColor.border}`,
        borderRadius: 'var(--tl-bar-r)',
      }}
    >
      {segments.map((s, i) => {
        const c = FACT_SEGMENT_COLORS[s.color];
        const left = Math.max(0, Math.round(xOf(s.a) - p.left));
        const right = Math.min(p.width, Math.round(xOf(s.b) + COL_W - p.left));
        const problem = s.color === 'orange' || s.color === 'red';
        return (
          <span
            key={`${s.a}-${s.b}-${s.color}-${i}`}
            data-guide-seg={s.color}
            className="absolute top-0 bottom-0"
            style={{
              left,
              width: Math.max(1, right - left),
              background: c.bg,
              ...(problem
                ? {
                    backgroundImage:
                      s.color === 'red'
                        ? 'repeating-linear-gradient(45deg, rgba(159,18,57,0.16), rgba(159,18,57,0.16) 2px, transparent 2px, transparent 7px)'
                        : 'repeating-linear-gradient(45deg, rgba(138,58,10,0.16), rgba(138,58,10,0.16) 2px, transparent 2px, transparent 7px)',
                  }
                : {}),
              borderTop: `1px solid ${c.border}`,
              borderBottom: `1px solid ${c.border}`,
              ...(i === 0 ? { borderLeft: `1px solid ${c.border}` } : {}),
              ...(i === segments.length - 1 ? { borderRight: `1px solid ${c.border}` } : {}),
            }}
            title={s.reason}
          >
            {problem && right - left >= 14 ? (
              <TriangleAlert className="absolute left-0.5 top-1/2 -translate-y-1/2 w-2 h-2" style={{ color: c.text }} aria-hidden="true" />
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

/** Заливка дня этапа — цвет по типу (stageColorOf), как в подстроке «План». */
const StageDay = ({ day, days, type, name }: { day: number; days: number; type: string; name: string }) => {
  const c = stageColorOf(type);
  const x = xOf(day);
  return (
    <span
      className="absolute top-0 bottom-0 z-[1] flex items-center justify-center overflow-hidden"
      title={`Этап «${name}» — заливка дня (цвет по типу этапа)`}
      style={{ left: x, width: COL_W, background: c.bg, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, borderRadius: 3 }}
    />
  );
};

/** Непрерывная полоса базы/ремонта — цвета и подписи из layoutBzFills. */
const BzStripeEl = ({ stripe, days }: { stripe: BzStripe; days: number }) => {
  const p = rect(stripe.a, stripe.b, days);
  if (!p) return null;
  const color = bzStripeColor(stripe);
  const StatusIcon = stripe.kind === 'base-fact' && stripe.status ? vyezdStatusIcon(stripe.status) : null;
  const showLabel = p.width >= 78;
  return (
    <div
      className="absolute flex items-center gap-0.5 overflow-hidden whitespace-nowrap"
      title={stripe.title}
      style={{
        left: p.left,
        width: p.width,
        top: 3,
        height: PLAN_BAR_H,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: 'var(--tl-bar-r)',
        color: color.text,
      }}
    >
      {StatusIcon ? <StatusIcon className="w-2.5 h-2.5 shrink-0 ml-0.5" style={{ color: color.text }} aria-hidden="true" /> : null}
      {showLabel ? <span className="text-[8px] leading-[10px] font-semibold truncate px-0.5">{stripe.label}</span> : null}
    </div>
  );
};

/** Однодневная отметка (срок готовности / окончание ремонта) — вся ячейка дня. */
const BzMarkEl = ({ mark, days }: { mark: BzMark; days: number }) => {
  const Icon = mark.kind === 'ready' ? CarFront : Wrench;
  const x = xOf(mark.day);
  // Тона — из той же палитры отметок, что на полотне (lib/bzFills: BZ_COLORS).
  const tone = mark.kind === 'ready' ? bzKindColor('ready') : bzKindColor('repair-end');
  return (
    <span
      className="absolute top-0 bottom-0 z-[2] flex items-center justify-center"
      title={mark.title}
      style={{ left: x, width: COL_W, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 3, color: tone.text }}
    >
      <Icon className="w-3 h-3" style={{ color: tone.text }} aria-hidden="true" />
    </span>
  );
};

/** Круглый маркер стыка (выезд/прибытие/ранний выезд) — те же тона MARKER_TONE. */
const MarkerEl = ({ day, frac, kind, days, title }: { day: number; frac: number; kind: 'arrival' | 'departure' | 'early-departure'; days: number; title: string }) => {
  const x = xOf(day) + Math.round(COL_W * frac);
  const tone = MARKER_TONE[kind];
  const Icon = kind === 'arrival' ? LogIn : LogOut;
  return (
    <span
      className="absolute z-[3] flex items-center justify-center rounded-full"
      title={title}
      style={{
        left: x - 7,
        top: Math.round((ROW_H - 14) / 2),
        width: 14,
        height: 14,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        boxShadow: '0 1px 2px rgba(18,19,22,0.18)',
      }}
    >
      <Icon className="w-2.5 h-2.5" style={{ color: tone.fg }} aria-hidden="true" />
    </span>
  );
};

// ---------------------------------------------------------------------------
// Демо-сценарии
// ---------------------------------------------------------------------------

const FACT_STAGES_TIMELINE = (unlFact: number, criticalBorder: boolean, borderFact = 4): TimelineStage[] => [
  st('s-load', 'load', 'Загрузка', D0, D0),
  st('s-border', 'border', 'Граница', D0 + 4, D0 + borderFact, criticalBorder),
  st('s-unl', 'unl', 'Выгрузка', D0 + 9, D0 + unlFact),
];

const PlanFactDemo = ({ unlFact, criticalBorder, title, caption }: { unlFact: number; criticalBorder: boolean; title: string; caption: string }) => {
  const days = 16;
  const stages = FACT_STAGES_TIMELINE(unlFact, criticalBorder);
  const planTo = D0 + 10;
  const factTo = D0 + unlFact;
  const res = factSegmentsOf({ stages, planFrom: D0, planTo, factFrom: D0, factTo, ongoing: false, today: TODAY });
  return (
    <DemoFrame title={title} caption={caption} days={days}>
      <DemoRow label="План" days={days}>
        <PlanBar a={D0} b={planTo} days={days} label="рейс" />
      </DemoRow>
      <DemoRow label="Факт" days={days}>
        <FactBar a={D0} b={factTo} days={days} segments={res.segments} />
      </DemoRow>
    </DemoFrame>
  );
};

const CriticalCompareDemo = () => {
  const days = 16;
  const planTo = D0 + 10;
  const mk = (critical: boolean) => {
    const stages = FACT_STAGES_TIMELINE(7, critical, 6);
    return factSegmentsOf({ stages, planFrom: D0, planTo, factFrom: D0, factTo: D0 + 9, ongoing: false, today: TODAY });
  };
  const crit = mk(true);
  const normal = mk(false);
  return (
    <DemoFrame
      title="Критический и некритический дедлайн при одном опоздании"
      caption="Верх — этап «Граница» с флагом «Крит. срок» (план 09/10, факт 11/10): участок красный. Низ — тот же этап без флага: то же опоздание 2 дня показано жёлтым."
      days={days}
    >
      <DemoRow label="План" days={days}>
        <PlanBar a={D0} b={planTo} days={days} label="рейс" />
      </DemoRow>
      <DemoRow label="Факт · крит." days={days}>
        <FactBar a={D0} b={D0 + 9} days={days} segments={crit.segments} />
      </DemoRow>
      <DemoRow label="Факт · обычн." days={days}>
        <FactBar a={D0} b={D0 + 9} days={days} segments={normal.segments} />
      </DemoRow>
    </DemoFrame>
  );
};

const BaseDemoRow = ({
  days,
  label,
  period,
  tripRanges,
}: {
  days: number;
  label: string;
  period: BasePeriod;
  tripRanges?: Array<{ a: number; b: number; label: string }>;
}) => {
  const out = layoutBzFills([{ period, tripRanges }], [], 'fact', D0, D0 + days - 1, TODAY);
  return (
    <DemoRow label={label} days={days}>
      {out.stripes.map((s2, i) => (
        <BzStripeEl key={`${s2.kind}-${i}`} stripe={s2} days={days} />
      ))}
      {out.marks.map((m, i) => (
        <BzMarkEl key={`${m.kind}-${i}`} mark={m} days={days} />
      ))}
    </DemoRow>
  );
};

const BaseColorsDemo = () => {
  const days = 16;
  const planPeriod = makePeriod('p-plan', { arrival: D0, ready: D0 + 4 });
  const planOut = layoutBzFills([{ period: planPeriod }], [], 'plan', D0, D0 + days - 1, TODAY);
  const closed = makePeriod('p-closed', { arrival: D0, ready: D0 + 4, departure: D0 + 5 });
  const active = makePeriod('p-active', { arrival: D0, ready: D0 + 8 });
  const noDep = makePeriod('p-nodep', { arrival: D0, ready: D0 + 3 });
  const conflict = makePeriod('p-conflict', { arrival: D0, ready: D0 + 4, departure: D0 + 6 });
  return (
    <DemoFrame
      title="База: «Плановый простой», «Фактический простой», «Готовится к выезду» и статусы"
      caption="Сверху — строка «План»: «Плановый простой на базе» и заливка дня срока готовности (иконка машины). Ниже — «Факт»: цвет полосы равен статусу «Учёта выезда»: серо-синий — «учёт ведётся», зелёный — «период закрыт» (выезд позже срока готовности на 1 дн — остаётся зелёным, опоздание в подсказке), янтарный «Выезд не зафиксирован», красный «Расхождение с рейсом» (рейс пересекается с периодом)."
      days={days}
    >
      <DemoRow label="План" days={days}>
        {planOut.stripes.map((s2, i) => (
          <BzStripeEl key={`${s2.kind}-${i}`} stripe={s2} days={days} />
        ))}
        {planOut.marks.map((m, i) => (
          <BzMarkEl key={`${m.kind}-${i}`} mark={m} days={days} />
        ))}
      </DemoRow>
      <BaseDemoRow days={days} label="Факт · ведётся" period={active} />
      <BaseDemoRow days={days} label="Факт · закрыт" period={closed} />
      <BaseDemoRow days={days} label="Факт · нет выезда" period={noDep} />
      <BaseDemoRow days={days} label="Факт · расхожд." period={conflict} tripRanges={[{ a: D0 + 2, b: D0 + 4, label: '«рейс»' }]} />
    </DemoFrame>
  );
};

const RepairDemo = () => {
  const days = 16;
  const p = makePeriod('p-repair', { arrival: D0, ready: D0 + 5, departure: D0 + 6, repairStart: D0 + 1, repairEnd: D0 + 4 });
  const planOut = layoutBzFills([{ period: p }], [], 'plan', D0, D0 + days - 1, TODAY);
  const factOut = layoutBzFills([{ period: p }], [], 'fact', D0, D0 + days - 1, TODAY);
  return (
    <DemoFrame
      title="Ремонт и дата окончания ремонта"
      caption="Полоса «Ремонт» — внутри фактического простоя, дата окончания ремонта заливает всю ячейку дня (иконка ключа). Ремонт без закрытия тянется до фактического выезда."
      days={days}
    >
      <DemoRow label="План" days={days}>
        {planOut.stripes.map((s2, i) => (
          <BzStripeEl key={`${s2.kind}-${i}`} stripe={s2} days={days} />
        ))}
        {planOut.marks.map((m, i) => (
          <BzMarkEl key={`${m.kind}-${i}`} mark={m} days={days} />
        ))}
      </DemoRow>
      <DemoRow label="Факт" days={days}>
        {factOut.stripes.map((s2, i) => (
          <BzStripeEl key={`${s2.kind}-${i}`} stripe={s2} days={days} />
        ))}
        {factOut.marks.map((m, i) => (
          <BzMarkEl key={`${m.kind}-${i}`} mark={m} days={days} />
        ))}
      </DemoRow>
    </DemoFrame>
  );
};

const EarlyDepartureDemo = () => {
  const days = 16;
  const p = makePeriod('p-early', { arrival: D0, ready: D0 + 8, departure: D0 + 6 });
  // Рейс начался внутри периода и тянется дальше его конца: простой укорочен
  // до дня выезда (визуально — день делится), на стыке маркер «выехала раньше».
  const trips = [{ a: D0 + 4, b: D0 + 11, label: '«рейс»' }];
  const factOut = layoutBzFills([{ period: p, tripRanges: trips }], [], 'fact', D0, D0 + days - 1, TODAY);
  const stripe = factOut.stripes.find((s2) => s2.kind === 'base-fact');
  return (
    <DemoFrame
      title="«Выехала раньше»: простой укорочен до дня выезда, маркер на стыке"
      caption="Машина выехала раньше учётного срока (фактического выезда): полоса простоя обрывается в день выезда, на стыке — янтарный маркер. Данные учёта не изменяются; в окне «Учёта выезда» статус не смягчается."
      days={days}
    >
      <DemoRow label="Факт · период" days={days}>
        {stripe ? (
          <div className="absolute flex items-center overflow-hidden whitespace-nowrap" style={{ left: rect(p.arrivalDay ?? 0, D0 + 4, days)?.left, width: (rect(p.arrivalDay ?? 0, D0 + 4, days)?.width ?? 0) + COL_W / 2, top: 3, height: PLAN_BAR_H, background: bzStripeColor(stripe).bg, border: `1px solid ${bzStripeColor(stripe).border}`, borderRadius: 'var(--tl-bar-r) 0 0 var(--tl-bar-r)', color: bzStripeColor(stripe).text }}>
            <span className="text-[8px] leading-[10px] font-semibold truncate px-0.5">{stripe.label}</span>
          </div>
        ) : null}
        <MarkerEl day={D0 + 4} frac={0.5} kind="early-departure" days={days} title="выехала раньше учётного срока — простой укорочен до дня выезда (клик — окно периода)" />
      </DemoRow>
      <DemoRow label="План · рейс" days={days}>
        <PlanBar a={D0 + 4} b={D0 + 11} days={days} label="рейс начался в день выезда" />
      </DemoRow>
    </DemoFrame>
  );
};

/** Полоса от доли дня A до доли дня B (день смены делится по горизонтали). */
const spanRect = (a: number, fracA: number, b: number, fracB: number): { left: number; width: number } => {
  const left = xOf(a) + Math.round(COL_W * fracA);
  const right = xOf(b) + Math.round(COL_W * fracB);
  return { left, width: Math.max(2, right - left) };
};

const SameDayDemo = () => {
  const days = 16;
  // Рейс завершился в день приезда на базу И новый рейс начался в день выезда:
  // оба дня — честный стык, день делится пополам, обе половины видны.
  const arrivalDay = D0 + 2;
  const departureDay = D0 + 8;
  const baseTone = bzKindColor('base-plan');
  const tripSpan = spanRect(D0, 0, arrivalDay, 0.5);
  const baseSpan = spanRect(arrivalDay, 0.5, departureDay, 0.5);
  const nextSpan = spanRect(departureDay, 0.5, D0 + 14, 1);
  return (
    <DemoFrame
      title="Смена в один день: честный стык рейса и базы"
      caption="День перехода делится пополам: слева — рейс, справа — простой (или наоборот); на срезах маркеры «прибытие на базу» (первый день) и «выезд» (последний день). Такие общие дни — не расхождение, а штатный переход."
      days={days}
    >
      <DemoRow label="План · стык в один день" days={days}>
        <div
          className="absolute flex items-center overflow-hidden whitespace-nowrap"
          style={{ left: tripSpan.left, width: tripSpan.width, top: 3, height: PLAN_BAR_H, zIndex: 2, background: PLAN_ACCENT.bg, border: `1px solid ${PLAN_ACCENT.border}`, borderRadius: 'var(--tl-bar-r) 0 0 var(--tl-bar-r)', color: PLAN_ACCENT.text }}
        >
          <span className="text-[8px] leading-[10px] font-semibold truncate px-1">рейс</span>
        </div>
        <div
          className="absolute flex items-center overflow-hidden whitespace-nowrap"
          style={{ left: baseSpan.left, width: baseSpan.width, top: 3, height: PLAN_BAR_H, zIndex: 2, background: baseTone.bg, borderTop: `1px solid ${baseTone.border}`, borderBottom: `1px solid ${baseTone.border}`, color: baseTone.text }}
        >
          <span className="text-[8px] leading-[10px] font-semibold truncate px-0.5">Плановый простой на базе</span>
        </div>
        <div
          className="absolute flex items-center overflow-hidden whitespace-nowrap"
          style={{ left: nextSpan.left, width: nextSpan.width, top: 3, height: PLAN_BAR_H, zIndex: 2, background: PLAN_ACCENT.bg, border: `1px solid ${PLAN_ACCENT.border}`, borderRadius: '0 var(--tl-bar-r) var(--tl-bar-r) 0', color: PLAN_ACCENT.text }}
        >
          <span className="text-[8px] leading-[10px] font-semibold truncate px-1">новый рейс</span>
        </div>
        <MarkerEl day={arrivalDay} frac={0.5} kind="arrival" days={days} title="маркер «прибытие на базу»: рейс завершён в день начала простоя (день делится)" />
        <MarkerEl day={departureDay} frac={0.5} kind="departure" days={days} title="маркер «выезд»: простой закончился и рейс начался в один день" />
      </DemoRow>
    </DemoFrame>
  );
};

const DirectionsCirclesDemo = () => {
  const days = 18;
  const dirs = DEFAULT_DIRECTIONS;
  const tr = dirs.find((d) => d.name === 'Турция') || dirs[0];
  const cn = dirs.find((d) => d.name === 'Китай') || dirs[1] || dirs[0];
  return (
    <DemoFrame
      title="Круги и направления"
      caption="Круг — один рейс машины на внешнем направлении; номер на начале полосы, счётчик — в колонке машины (у двух и больше бейдж заметный, «круг идёт» — пунктир). Направление: цветной акцент у левого края, код в правом углу полосы и мини-чип в колонке."
      days={days}
    >
      <DemoRow label="План · 3 круга" days={days}>
        <PlanBar a={D0} b={D0 + 4} days={days} label="Турция 1" circle={1} circleTotal={3} dirCode={tr.code} dirColor={tr.color} />
        <PlanBar a={D0 + 5} b={D0 + 9} days={days} label="Турция 2" circle={2} circleTotal={3} dirCode={tr.code} dirColor={tr.color} />
        <PlanBar a={D0 + 10} b={D0 + 15} days={days} label="Китай 3" circle={3} circleTotal={3} dirCode={cn.code} dirColor={cn.color} />
      </DemoRow>
      <DemoRow label="План · 1 круг" days={days}>
        <PlanBar a={D0 + 1} b={D0 + 7} days={days} label="рейс" circle={1} circleTotal={1} />
      </DemoRow>
    </DemoFrame>
  );
};

const PlanFullDemo = () => {
  const days = 16;
  const stages: TimelineStage[] = [
    st('d-load', 'load', 'Загрузка', D0, null),
    st('d-cust-out', 'cust_out', 'Затаможка (экспорт)', D0 + 2, null),
    st('d-border', 'border', 'Граница', D0 + 4, null),
    st('d-cust-in', 'cust_in', 'Растаможка (импорт)', D0 + 7, null),
    st('d-unl', 'unl', 'Выгрузка', D0 + 9, null),
    st('d-reserve', 'reserve', 'Бронь / согласование перехода', D0 + 11, null),
  ];
  return (
    <DemoFrame
      title="Полный план рейса до старта"
      caption="Плановая полоса и заливки дней этапов (цвет — по типу этапа: Загрузка 05/10, Затаможка 07/10, Граница 09/10, Растаможка 12/10, Выгрузка 14/10, Бронь 16/10), в конце — синяя метка планового возвращения. Каждая заливка кликабельна и открывает этап в таблице окна рейса."
      days={days}
    >
      <DemoRow label="План" days={days}>
        <PlanBar a={D0} b={D0 + 14} days={days} label="рейс: полный план" />
        {stages.map((s2) => (
          <StageDay key={s2.id} day={dayNum(s2.plannedDate) ?? D0} days={days} type={s2.type} name={s2.label || s2.type} />
        ))}
        <ReturnMark day={D0 + 14} days={days} />
      </DemoRow>
    </DemoFrame>
  );
};

// ---------------------------------------------------------------------------
// Сборка блока иллюстраций по списку demo-id
// ---------------------------------------------------------------------------

export const GuideDemos = ({ ids }: { ids: DemoId[] }) => {
  if (!ids.length) return null;
  return (
    <div className="flex flex-col gap-2" data-guide-demos>
      {ids.map((id) => {
        switch (id) {
          case 'plan-full':
            return <PlanFullDemo key={id} />;
          case 'fact-in-time':
            return (
              <PlanFactDemo
                key={id}
                unlFact={9}
                criticalBorder={false}
                title="Рейс в срок"
                caption="Все этапы выполнены в срок — факт полностью зелёный; до планового окончания рейса (15/10) остаётся запас."
              />
            );
          case 'fact-plus1':
            return (
              <PlanFactDemo
                key={id}
                unlFact={10}
                criticalBorder={false}
                title="Опоздание 1 день — жёлтый участок"
                caption="«Выгрузка»: план 14/10, факт 15/10 — опоздание 1 день, участок от планового срока жёлтый."
              />
            );
          case 'fact-plus3':
            return (
              <PlanFactDemo
                key={id}
                unlFact={12}
                criticalBorder={false}
                title="Опоздание 3 дня — оранжевый участок"
                caption="«Выгрузка»: план 14/10, факт 17/10 — больше двух дней, участок оранжевый (штриховка и значок — вторичный признак)."
              />
            );
          case 'fact-critical':
            return <CriticalCompareDemo key={id} />;
          case 'base-colors':
            return <BaseColorsDemo key={id} />;
          case 'repair':
            return <RepairDemo key={id} />;
          case 'early-departure':
            return <EarlyDepartureDemo key={id} />;
          case 'same-day':
            return <SameDayDemo key={id} />;
          case 'directions-circles':
            return <DirectionsCirclesDemo key={id} />;
          default:
            return null;
        }
      })}
      <div className="text-[9px] leading-[12px] text-[#9CA3AF]">
        Иллюстрации собраны из настоящих компонентов полос на изолированных демо-данных ({fmtDM(D0)}–{fmtDM(D0 + 15)});
        в рабочую базу ничего не записывается.
      </div>
    </div>
  );
};

export default GuideDemos;
