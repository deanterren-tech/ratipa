/**
 * Главный график рейса: накопленный пробег от начала.
 * X — время, Y — километры от начала рейса. Линия прироста одометра рисуется
 * только по измеренным участкам (разрывы данных разрывают линию — никакой
 * интерполяции), GPS-пробег показывается пунктиром и только там, где история
 * пригодна. Абсолютное показание одометра — в подсказке точки.
 */

import type { Stop, TechEvent, TripEventRow, UnknownPeriod } from '../engine/types';
import { decimatePoints, pathOf, timeTicks, useElementWidth, clampRange, type ChartPt } from './chartUtils';
import { fmtAxis, fmtDMHM, fmtDMYHM, fmtKm } from '../engine/format';

interface Polyline {
  id: string;
  kind: 'odo' | 'gps';
  label: string;
  points: ChartPt[];
}

interface Props {
  window: { fromMs: number; toMs: number; ongoing: boolean };
  range: { fromMs: number; toMs: number };
  polylines: Polyline[];
  stops: Stop[];
  unknowns: UnknownPeriod[];
  techEvents: TechEvent[];
  events: TripEventRow[];
  selectedStopId: string | null;
  selectedEventId: string | null;
  onSelectStop: (id: string | null) => void;
  onSelectEvent: (id: string | null) => void;
  maxPoints: number;
  odoSourceLabel: string;
  gpsPartial: boolean;
}

const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;
const H = 260;

export default function MileageChart(props: Props) {
  const {
    window, range, polylines, stops, unknowns, techEvents, events,
    selectedStopId, selectedEventId, onSelectStop, onSelectEvent, maxPoints,
    odoSourceLabel, gpsPartial,
  } = props;
  const { ref, width } = useElementWidth<HTMLDivElement>(760);

  const innerW = Math.max(120, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;

  const allPts = polylines.flatMap((p) => p.points);
  const odoPts = polylines.filter((p) => p.kind === 'odo').flatMap((p) => p.points);
  let yMax = 0;
  for (const p of allPts) if (p.km > yMax) yMax = p.km;
  yMax = Math.max(1, Math.ceil(yMax * 1.05));

  const x = (t: number) => PAD_L + ((t - range.fromMs) / Math.max(1, range.toMs - range.fromMs)) * innerW;
  const y = (km: number) => PAD_T + innerH - (Math.max(0, km) / yMax) * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = timeTicks(range.fromMs, range.toMs, width);

  const stopsInRange = stops
    .map((s) => ({ stop: s, rect: clampRange(s.startMs, s.endMs, range.fromMs, range.toMs) }))
    .filter((v): v is { stop: Stop; rect: { a: number; b: number } } => v.rect != null);
  const gapsInRange = unknowns
    .map((u) => ({ u, rect: clampRange(u.fromMs, u.toMs, range.fromMs, range.toMs) }))
    .filter((v): v is { u: UnknownPeriod; rect: { a: number; b: number } } => v.rect != null);
  const eventsInRange = events.filter((e) => e.interval.fromMs >= range.fromMs && e.interval.fromMs <= range.toMs);

  const decimated = polylines.map((p) => ({ ...p, points: p.kind === 'odo' ? decimatePoints(p.points, maxPoints) : decimatePoints(p.points, Math.max(120, maxPoints / 3)) }));

  const empty = odoPts.length === 0 && polylines.every((p) => p.kind !== 'odo' || !p.points.length);

  return (
    <div ref={ref} className="w-full" data-testid="mc-accumulated-chart">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Накопленный пробег от начала рейса" className="block select-none">
        {/* фон */}
        <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} fill="#FFFFFF" stroke="#E5E7EB" />
        {/* сетка Y */}
        {yTicks.map((km) => (
          <g key={`y${km}`}>
            <line x1={PAD_L} x2={PAD_L + innerW} y1={y(km)} y2={y(km)} stroke="#F3F4F6" />
            <text x={PAD_L - 6} y={y(km) + 3} textAnchor="end" fontSize={10} fill="#9CA3AF">{Math.round(km)}</text>
          </g>
        ))}
        <text x={10} y={PAD_T + 2} fontSize={10} fill="#9CA3AF">км от начала</text>
        {/* сетка X */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T + innerH} y2={PAD_T + innerH + 4} stroke="#D1D5DB" />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="#9CA3AF">{fmtAxis(t)}</text>
          </g>
        ))}

        {/* неизвестные периоды (разрывы данных) — штриховка */}
        <defs>
          <pattern id="mc-gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#F9FAFB" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#D1D5DB" strokeWidth="2" />
          </pattern>
        </defs>
        {gapsInRange.map(({ u, rect }) => (
          <rect
            key={`g${u.fromMs}`}
            x={x(rect.a)} y={PAD_T} width={Math.max(1, x(rect.b) - x(rect.a))} height={innerH}
            fill="url(#mc-gap)" stroke="#E5E7EB"
          >
            <title>{`Нет данных: ${fmtDMYHM(u.fromMs)} → ${fmtDMYHM(u.toMs)}. ${u.reason}`}</title>
          </rect>
        ))}

        {/* стоянки — затенённые интервалы */}
        {stopsInRange.map(({ stop, rect }) => {
          const confirmed = stop.category === 'confirmed';
          const selected = stop.id === selectedStopId;
          return (
            <g key={stop.id} onClick={(e) => { e.stopPropagation(); onSelectStop(selected ? null : stop.id); }} style={{ cursor: 'pointer' }}>
              <rect
                x={x(rect.a)} y={PAD_T} width={Math.max(2, x(rect.b) - x(rect.a))} height={innerH}
                fill={confirmed ? 'rgba(245, 158, 11, 0.16)' : 'rgba(148, 163, 184, 0.18)'}
                stroke={selected ? '#121316' : confirmed ? '#FCD34D' : '#CBD5E1'}
                strokeWidth={selected ? 1.5 : 1}
                strokeDasharray={confirmed ? undefined : '3 3'}
              >
                <title>{`${confirmed ? 'Стоянка' : 'Предполагаемая стоянка'} ${fmtDMHM(stop.startMs)} → ${fmtDMHM(stop.endMs)} (${Math.round(stop.durationMin)} мин). ${stop.basis}`}</title>
              </rect>
            </g>
          );
        })}

        {/* границы рейса */}
        {width >= 520 && clampRange(window.fromMs, window.fromMs, range.fromMs, range.toMs) && (
          <g>
            <line x1={x(window.fromMs)} x2={x(window.fromMs)} y1={PAD_T} y2={PAD_T + innerH} stroke="#121316" strokeDasharray="4 3" strokeWidth={1} />
            <text x={x(window.fromMs) + 3} y={PAD_T + 10} fontSize={9} fill="#121316">начало рейса</text>
          </g>
        )}
        {width >= 520 && !window.ongoing && clampRange(window.toMs, window.toMs, range.fromMs, range.toMs) && (
          <g>
            <line x1={x(window.toMs)} x2={x(window.toMs)} y1={PAD_T} y2={PAD_T + innerH} stroke="#121316" strokeDasharray="4 3" strokeWidth={1} />
            <text x={x(window.toMs) - 3} y={PAD_T + 10} fontSize={9} fill="#121316" textAnchor="end">окончание рейса</text>
          </g>
        )}

        {/* технические события (ромбы) */}
        {techEvents.filter((t) => t.atMs >= range.fromMs && t.atMs <= range.toMs).map((t) => (
          <g key={t.id}>
            <path d={`M ${x(t.atMs)} ${PAD_T + innerH - 8} l 4 -5 l -4 -5 l -4 5 Z`} fill="#7C3AED" opacity={0.85}>
              <title>{`${t.label} · ${fmtDMYHM(t.atMs)}${t.detail ? ` · ${t.detail}` : ''}`}</title>
            </path>
          </g>
        ))}

        {/* GPS-пробег (пунктир, по пригодным фрагментам) */}
        {decimated.filter((p) => p.kind === 'gps').map((p) => (
          <path key={p.id} d={pathOf(p.points, x, y)} fill="none" stroke="#2563EB" strokeWidth={1.4} strokeDasharray="5 3" opacity={0.8}>
            <title>{`${p.label} — только пригодные участки GPS${gpsPartial ? ' (история неполная, сумма не равна пробегу рейса)' : ''}`}</title>
          </path>
        ))}

        {/* линии одометра (по участкам, без склейки разрывов) */}
        {decimated.filter((p) => p.kind === 'odo').map((p) => (
          <path key={p.id} d={pathOf(p.points, x, y)} fill="none" stroke="#121316" strokeWidth={1.8}>
            <title>{`${p.label}`}</title>
          </path>
        ))}
        {/* точки (подсказка: время, накоплено, абсолютный одометр) */}
        {decimated.filter((p) => p.kind === 'odo').flatMap((p) =>
          p.points.map((pt, i) => (
            <circle key={`${p.id}:${i}`} cx={x(pt.atMs)} cy={y(pt.km)} r={1.9} fill="#121316" opacity={0.7}>
              <title>{`${fmtDMYHM(pt.atMs)}\nнакоплено: ${fmtKm(pt.km)} от начала\nодометр: ${pt.odoKm != null ? `${pt.odoKm.toFixed(1)} км` : 'не передаётся'} (${odoSourceLabel})`}</title>
            </circle>
          )),
        )}

        {/* маркеры событий */}
        {eventsInRange.map((e) => {
          const px = x(e.interval.fromMs);
          const py = PAD_T + 12;
          const selected = e.id === selectedEventId;
          const color = e.severity === 'check' ? '#E11D48' : '#F59E0B';
          return (
            <g key={e.id} onClick={(ev) => { ev.stopPropagation(); onSelectEvent(selected ? null : e.id); }} style={{ cursor: 'pointer' }}>
              <circle cx={px} cy={py} r={selected ? 6 : 4.5} fill={color} stroke={selected ? '#121316' : '#FFFFFF'} strokeWidth={selected ? 1.5 : 1} />
              <title>{`${e.title}${e.deltaKm != null ? ` · ${fmtKm(Math.abs(e.deltaKm))}` : ''} · ${fmtDMYHM(e.interval.fromMs)}`}</title>
            </g>
          );
        })}

        {empty && (
          <text x={PAD_L + innerW / 2} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={11} fill="#9CA3AF">
            Накопленных измерений одометра за период нет
          </text>
        )}
      </svg>
      <div className="mt-1.5 text-[10px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-1">
        <span><span className="inline-block w-3 border-t-2 border-[#121316] align-middle mr-1" />прирост одометра ({odoSourceLabel})</span>
        <span><span className="inline-block w-3 border-t-2 border-dashed border-[#2563EB] align-middle mr-1" />GPS-пробег{gpsPartial ? ' (неполный)' : ''}</span>
        <span><span className="inline-block w-3 h-2.5 bg-amber-500/20 border border-amber-300 align-middle mr-1" />подтверждённая стоянка</span>
        <span><span className="inline-block w-3 h-2.5 bg-slate-400/20 border border-slate-300 border-dashed align-middle mr-1" />предполагаемая стоянка</span>
        <span><span className="inline-block w-3 h-2.5 border border-[#E5E7EB] align-middle mr-1" style={{ background: 'repeating-linear-gradient(45deg,#F9FAFB,#F9FAFB 2px,#D1D5DB 2px,#D1D5DB 3px)' }} />разрыв данных (неизвестный период)</span>
        <span><span className="inline-flex w-2.5 h-2.5 rounded-full bg-rose-600 align-middle mr-1" />событие «требуется проверка»</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-[#7C3AED] align-middle mr-1" style={{ clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }} />техотметка</span>
      </div>
    </div>
  );
}
