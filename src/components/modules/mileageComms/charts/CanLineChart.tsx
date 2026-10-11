/**
 * График «Истории CAN-пробега» (карточка машины): линия показаний одометра
 * (абсолютных либо прироста от начала выбранного периода).
 *
 * Переиспользует общие помощники charts/chartUtils (без библиотек графиков):
 * timeTicks/useElementWidth/decimateCanPoints. Отличия от графиков рейса:
 *  - значения могут быть отрицательными (сбросы/откаты счётчика — не скрываем);
 *  - разрывы данных рвут линию (сегменты не соединяются через неизвестные
 *    интервалы);
 *  - измерения с подтверждённым временем (заполненные точки) и снимки
 *    (полые точки) различаются визуально;
 *  - разделители дней (для рейса — все дни на одной шкале);
 *  - выделение диапазона мышью/пальцем — зум (синхронизируется с графиком
 *    приростов через родителя).
 */

import { useRef, useState } from 'react';
import { timeTicks, useElementWidth } from './chartUtils';
import { fmtAxis } from '../engine/format';
import type { CanPoint } from '../engine/canSeries';
import type { Interval, Stop } from '../engine/types';

interface Props {
  window: { fromMs: number; toMs: number };
  range: { fromMs: number; toMs: number };
  /** Точки уже прореженные/готовые к показу (в window). */
  points: CanPoint[];
  /** Режим: абсолютное показание либо прирост от начала периода. */
  mode: 'abs' | 'gain';
  /** База «прироста от начала» (первое измерение периода), км. */
  baseKm: number | null;
  /** Порог разрыва (мс): интервал больше — линия рвётся. */
  gapMs: number;
  gaps: Interval[];
  stops: Stop[];
  dayMarks: number[];
  /** Подсказка точки: собирается родителем (время, значение, предыдущее, прирост, качество). */
  tooltipOf: (p: CanPoint, prev: CanPoint | null) => string;
  /** Границы выделенного интервала (подсветка). */
  highlight?: Interval | null;
  onBrush: (fromMs: number, toMs: number) => void;
  onResetZoom: () => void;
}

const PAD_L = 56;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;
const H = 260;

export default function CanLineChart(props: Props) {
  const { window: win, range, points, mode, baseKm, gapMs, gaps, stops, dayMarks, tooltipOf, highlight, onBrush, onResetZoom } = props;
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  const innerW = Math.max(120, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;

  const rel = (p: CanPoint): number => (mode === 'gain' && baseKm != null ? p.valueKm - baseKm : p.valueKm);
  const vals = points.map(rel);
  let yMin = vals.length ? Math.min(...vals) : 0;
  let yMax = vals.length ? Math.max(...vals) : 1;
  if (yMax - yMin < 0.5) { yMax += 0.25; yMin -= 0.25; }
  const pad = (yMax - yMin) * 0.06;
  yMax += pad; yMin -= pad;
  if (mode === 'gain' && baseKm != null && yMin > 0) yMin = 0;

  const x = (t: number) => PAD_L + ((t - range.fromMs) / Math.max(1, range.toMs - range.fromMs)) * innerW;
  const y = (v: number) => PAD_T + innerH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;

  const xTicks = timeTicks(range.fromMs, range.toMs, width);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);

  // Сегменты линии: рвём на разрывах (не соединяем неизвестные интервалы).
  const segments: CanPoint[][] = [];
  {
    const inRange = points.filter((p) => p.xMs >= range.fromMs && p.xMs <= range.toMs);
    let cur: CanPoint[] = [];
    for (const p of inRange) {
      const last = cur[cur.length - 1];
      if (last && p.xMs - last.xMs > gapMs) {
        segments.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length) segments.push(cur);
  }

  const toX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return range.fromMs;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / Math.max(1, rect.width)) * width;
    const t = range.fromMs + ((px - PAD_L) / innerW) * (range.toMs - range.fromMs);
    return Math.min(range.toMs, Math.max(range.fromMs, t));
  };

  const dragRect = drag ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : null;

  // Предыдущая точка для подсказки — один проход, без O(n²).
  const inRangePoints = points.filter((p) => p.xMs >= range.fromMs && p.xMs <= range.toMs);
  const prevByPoint = new Map<CanPoint, CanPoint | null>();
  for (let i = 0; i < points.length; i += 1) prevByPoint.set(points[i], i > 0 ? points[i - 1] : null);

  return (
    <div ref={ref} className="w-full" data-testid="mc-can-chart">
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label="История показаний одометра"
        className="block select-none touch-none"
        onDoubleClick={() => onResetZoom()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag({ a: toX(e.clientX), b: toX(e.clientX) });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          setDrag((d) => (d ? { a: d.a, b: toX(e.clientX) } : d));
        }}
        onPointerUp={(e) => {
          if (!drag) return;
          const b = toX(e.clientX);
          const a = drag.a;
          setDrag(null);
          const from = Math.min(a, b);
          const to = Math.max(a, b);
          if (to - from > 60_000) onBrush(from, to); // выделение короче минуты игнорируем
        }}
      >
        <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} fill="#FFFFFF" stroke="#E5E7EB" />
        {/* Сетка Y */}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} x2={PAD_L + innerW} y1={y(v)} y2={y(v)} stroke={Math.abs(v) < 1e-9 ? '#E5E7EB' : '#F3F4F6'} />
            <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#9CA3AF">{v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</text>
          </g>
        ))}
        <text x={8} y={PAD_T + 2} fontSize={10} fill="#9CA3AF">{mode === 'gain' ? 'прирост, км' : 'одометр, км'}</text>
        {/* Сетка X */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T + innerH} y2={PAD_T + innerH + 4} stroke="#D1D5DB" />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="#9CA3AF">{fmtAxis(t)}</text>
          </g>
        ))}

        <defs>
          <pattern id="mc-can-gap" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} fill="#F9FAFB" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#D1D5DB" strokeWidth={2} />
          </pattern>
        </defs>

        {/* Разделители дней */}
        {dayMarks.filter((t) => t > range.fromMs && t < range.toMs).map((t) => (
          <g key={`d${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={PAD_T + innerH} stroke="#E5E7EB" strokeDasharray="4 4" />
            <text x={x(t) + 3} y={PAD_T + 10} fontSize={9} fill="#9CA3AF">{new Date(t + 180 * 60_000).getUTCDate()}.{(new Date(t + 180 * 60_000).getUTCMonth() + 1).toString().padStart(2, '0')}</text>
          </g>
        ))}

        {/* Разрывы данных — штриховка */}
        {gaps.map((g) => {
          const a = Math.max(g.fromMs, range.fromMs);
          const b = Math.min(g.toMs, range.toMs);
          if (b <= a) return null;
          return (
            <rect key={`g${g.fromMs}`} x={x(a)} y={PAD_T} width={Math.max(1, x(b) - x(a))} height={innerH} fill="url(#mc-can-gap)" stroke="#E5E7EB">
              <title>Нет данных: разрыв {Math.max(1, Math.round((g.toMs - g.fromMs) / 60_000))} мин</title>
            </rect>
          );
        })}

        {/* Стоянки (поверх) */}
        {stops.map((s) => {
          const a = Math.max(s.startMs, range.fromMs);
          const b = Math.min(s.endMs, range.toMs);
          if (b <= a) return null;
          const confirmed = s.category === 'confirmed';
          return (
            <rect
              key={s.id}
              x={x(a)} y={PAD_T} width={Math.max(2, x(b) - x(a))} height={innerH}
              fill={confirmed ? 'rgba(245, 158, 11, 0.14)' : 'rgba(148, 163, 184, 0.14)'}
              stroke={confirmed ? '#FCD34D' : '#CBD5E1'} strokeDasharray={confirmed ? undefined : '3 3'}
            >
              <title>{`${confirmed ? 'Стоянка' : 'Предполагаемая стоянка'}: ${new Date(s.startMs + 180 * 60_000).toISOString().slice(11, 16)} → ${new Date(s.endMs + 180 * 60_000).toISOString().slice(11, 16)} (${Math.round(s.durationMin)} мин)`}</title>
            </rect>
          );
        })}

        {/* Подсветка выбранного/приближаемого интервала */}
        {highlight && highlight.toMs > range.fromMs && highlight.fromMs < range.toMs && (
          <rect
            x={x(Math.max(highlight.fromMs, range.fromMs))} y={PAD_T}
            width={Math.max(2, x(Math.min(highlight.toMs, range.toMs)) - x(Math.max(highlight.fromMs, range.fromMs)))}
            height={innerH} fill="rgba(18,19,22,0.05)" stroke="#121316" strokeDasharray="3 3"
          />
        )}

        {/* Линии (по сегментам, без склейки разрывов) */}
        {segments.map((seg, i) => (
          <path
            key={`seg${i}`}
            d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.xMs).toFixed(1)} ${y(rel(p)).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="#121316"
            strokeWidth={1.6}
          />
        ))}

        {/* Точки: измерения — заполненные, снимки — полые */}
        {inRangePoints.map((p, i) => {
          const prev = prevByPoint.get(p) || null;
          return (
            <circle
              key={`p${i}`}
              cx={x(p.xMs)} cy={y(rel(p))} r={p.kind === 'measured' ? 2.2 : 1.8}
              fill={p.kind === 'measured' ? '#121316' : '#FFFFFF'}
              stroke={p.source === 'stat_window' && p.precision === 'km_int' ? '#6B7280' : '#121316'}
              strokeWidth={p.kind === 'measured' ? 0.6 : 1}
              opacity={0.9}
            >
              <title>{tooltipOf(p, prev)}</title>
            </circle>
          );
        })}

        {/* Выделение мышью */}
        {dragRect && (
          <rect x={x(dragRect.a)} y={PAD_T} width={Math.max(1, x(dragRect.b) - x(dragRect.a))} height={innerH} fill="rgba(37,99,235,0.12)" stroke="#2563EB" strokeDasharray="3 2" />
        )}

        {/* Границы окна периода */}
        {win.fromMs >= range.fromMs && win.fromMs <= range.toMs && (
          <line x1={x(win.fromMs)} x2={x(win.fromMs)} y1={PAD_T} y2={PAD_T + innerH} stroke="#121316" strokeDasharray="4 3" />
        )}
        {win.toMs >= range.fromMs && win.toMs <= range.toMs && win.toMs < Date.now() - 60_000 && (
          <line x1={x(win.toMs)} x2={x(win.toMs)} y1={PAD_T} y2={PAD_T + innerH} stroke="#121316" strokeDasharray="4 3" />
        )}

        {points.length === 0 && (
          <text x={PAD_L + innerW / 2} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={11} fill="#9CA3AF">
            Измерений одометра за период нет
          </text>
        )}
      </svg>
      <div className="mt-1.5 text-[10px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-1">
        <span><span className="inline-block w-3 border-t-2 border-[#121316] align-middle mr-1" />{mode === 'gain' ? 'прирост от начала периода' : 'показание одометра'}</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#121316] align-middle mr-1" />измерение с подтверждённым временем</span>
        <span><span className="inline-block w-2 h-2 rounded-full border border-[#121316] bg-white align-middle mr-1" />снимок (время измерения нет в API)</span>
        <span><span className="inline-block w-3 h-2.5 border border-[#E5E7EB] align-middle mr-1" style={{ background: 'repeating-linear-gradient(45deg,#F9FAFB,#F9FAFB 2px,#D1D5DB 2px,#D1D5DB 3px)' }} />разрыв данных</span>
        <span>Выделите участок — приближение; двойной клик — сброс</span>
      </div>
    </div>
  );
}
