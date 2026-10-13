/**
 * График «Показания CAN-одометра» (без библиотек, собственный SVG).
 *
 * Один график по уточнённой спецификации:
 *  - X — дата и время измерения, Y — АБСОЛЮТНОЕ показание одометра в км;
 *  - ступенчатая линия без сглаживания: значение держится до следующего
 *    измерения (горизонтальный участок), на новом измерении — вертикальный
 *    переход; снижение/сброс показания показывается как есть;
 *  - линия рвётся там, где измерений не было дольше gapMs — интервал без
 *    данных не достраивается «по прямой» (нет выдуманных значений);
 *  - наведение (мышь) и касание с перемещением пальца (мобильный) выделяют
 *    БЛИЖАЙШЕЕ РЕАЛЬНОЕ измерение: точка, вертикальный указатель времени и
 *    подсказка с точной датой, временем и показанием — строго реальная запись,
 *    интерполяции нет;
 *  - выделение участка мышью — приближение (brush-zoom), двойной клик —
 *    возврат ко всему периоду (кнопка сброса — в окне).
 */

import { useMemo, useRef, useState } from 'react';
import { timeTicks, useElementWidth } from './chartUtils';
import { fmtAxis, fmtKm } from '../engine/format';
import type { CanPoint } from '../engine/canSeries';

interface Props {
  /** Измерения периода, отсортированы по времени (реальные времена tMs). */
  points: CanPoint[];
  /** Видимый диапазон: зум либо весь период. */
  range: { fromMs: number; toMs: number };
  /** Разрыв линии: пауза без измерений дольше — линия рвётся. */
  gapMs: number;
  /** Начала дней (+03) для разделителей, мс. */
  dayMarks: number[];
  onBrush: (fromMs: number, toMs: number) => void;
  onResetZoom: () => void;
}

const PAD_L = 64;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 30;
const H = 330;

const SRC_RU: Record<CanPoint['source'], string> = {
  stat_window: 'оконное измерение Nav.by',
  city_segment: 'граница сегмента пути',
  parking_segment: 'граница интервала стоянка/движение',
  snapshot: 'снимок портала',
};

/** «13/10/2026 10:10:09» — точное время измерения в поясе портала (+03). */
function fmtSec(ms: number): string {
  const d = new Date(ms + 180 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export default function CanOdomChart(props: Props) {
  const { points, range, gapMs, dayMarks, onBrush, onResetZoom } = props;
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const pointerRef = useRef<{ id: number; touch: boolean } | null>(null);

  const innerW = Math.max(120, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  const span = Math.max(1, range.toMs - range.fromMs);

  const visible = useMemo(
    () => points.filter((p) => p.xMs >= range.fromMs && p.xMs <= range.toMs),
    [points, range.fromMs, range.toMs],
  );

  let yMin = 0;
  let yMax = 1;
  if (visible.length) {
    yMin = Math.min(...visible.map((p) => p.valueKm));
    yMax = Math.max(...visible.map((p) => p.valueKm));
    if (yMax - yMin < 1) {
      yMax += 0.5;
      yMin -= 0.5;
    }
    const padY = (yMax - yMin) * 0.06;
    yMax += padY;
    yMin -= padY;
  }

  const x = (t: number) => PAD_L + ((t - range.fromMs) / span) * innerW;
  const y = (v: number) => PAD_T + innerH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;

  const xTicks = timeTicks(range.fromMs, range.toMs, width);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  // Длинные периоды (рейс/произвольный): подписи времени суток без даты путают —
  // показываем календарные даты; на дневном масштабе — часы, а полночь — дату.
  const longSpan = span > 2 * 86_400_000;
  const xLabel = (t: number): string => {
    if (!longSpan) return fmtAxis(t);
    const d = new Date(t + 180 * 60_000);
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  // Разделители дней рисуем, только когда соседние сутки различимы (≥46 px),
  // иначе подписи дней сливаются в «мешанину» — для длинных периодов их нет.
  const dayPx = (innerW * 86_400_000) / span;
  const showDayMarks = dayPx >= 46;

  // Сегменты ступенчатой линии: пауза без измерений дольше gapMs рвёт линию.
  const segments = useMemo(() => {
    const out: CanPoint[][] = [];
    let cur: CanPoint[] = [];
    for (const p of visible) {
      const last = cur[cur.length - 1];
      if (last && p.xMs - last.xMs > gapMs) {
        out.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length) out.push(cur);
    return out;
  }, [visible, gapMs]);

  const toPx = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(1, rect.width)) * width;
  };
  const toTime = (px: number): number => {
    const t = range.fromMs + ((px - PAD_L) / innerW) * span;
    return Math.min(range.toMs, Math.max(range.fromMs, t));
  };

  /** Индекс ближайшего РЕАЛЬНОГО измерения к пикселю (бинарный поиск). */
  const nearestIndex = (px: number): number | null => {
    if (!visible.length) return null;
    let lo = 0;
    let hi = visible.length - 1;
    if (px <= x(visible[0].xMs)) return 0;
    if (px >= x(visible[hi].xMs)) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x(visible[mid].xMs) < px) lo = mid;
      else hi = mid;
    }
    return Math.abs(x(visible[lo].xMs) - px) <= Math.abs(x(visible[hi].xMs) - px) ? lo : hi;
  };

  const hoverPoint = hover != null && visible[hover] ? visible[hover] : null;
  const dragRect = drag ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : null;
  const lastWasTouchRef = useRef(false);

  const tooltipLines = hoverPoint
    ? [
        hoverPoint.tMs != null ? fmtSec(hoverPoint.tMs) : fmtSec(hoverPoint.xMs),
        fmtKm(hoverPoint.valueKm, hoverPoint.precision === 'km_int' ? 0 : 3),
        `источник: odom_can · ${SRC_RU[hoverPoint.source]}`,
        ...(hoverPoint.precision === 'km_int' ? ['округление источника до 1 км'] : []),
        ...(hoverPoint.receivedAtMs != null ? [`получено порталом: ${fmtSec(hoverPoint.receivedAtMs)}`] : []),
      ]
    : [];

  return (
    <div ref={ref} className="w-full relative" data-testid="mc-can-chart">
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label="Показания CAN-одометра"
        className="block select-none touch-none cursor-crosshair"
        onDoubleClick={() => onResetZoom()}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          lastWasTouchRef.current = e.pointerType !== 'mouse';
          pointerRef.current = { id: e.pointerId, touch: e.pointerType !== 'mouse' };
          const px = toPx(e.clientX);
          setHover(nearestIndex(px));
          if (e.pointerType === 'mouse') setDrag({ a: toTime(px), b: toTime(px) });
        }}
        onPointerMove={(e) => {
          const px = toPx(e.clientX);
          const active = pointerRef.current;
          if (active && active.id === e.pointerId) {
            if (active.touch) setHover(nearestIndex(px));
            else setDrag((d) => (d ? { a: d.a, b: toTime(px) } : d));
          } else if (e.pointerType === 'mouse') {
            lastWasTouchRef.current = false;
            setHover(nearestIndex(px));
          }
        }}
        onPointerUp={(e) => {
          const active = pointerRef.current;
          if (!active || active.id !== e.pointerId) return;
          pointerRef.current = null;
          if (active.touch) return; // касание — только просмотр значений
          const b = toTime(toPx(e.clientX));
          const a = drag?.a ?? b;
          setDrag(null);
          const from = Math.min(a, b);
          const to = Math.max(a, b);
          if (to - from >= Math.max(60_000, span * 0.02)) onBrush(from, to);
        }}
        onPointerLeave={() => {
          if (pointerRef.current == null && !lastWasTouchRef.current) setHover(null);
        }}
      >
        <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} fill="#FFFFFF" stroke="#E5E7EB" />

        {/* Сетка Y */}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} x2={PAD_L + innerW} y1={y(v)} y2={y(v)} stroke="#F3F4F6" />
            <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#9CA3AF">
              {v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}
        <text x={PAD_L - 6} y={9} textAnchor="end" fontSize={10} fill="#9CA3AF">одометр, км</text>

        {/* Сетка X */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T + innerH} y2={PAD_T + innerH + 4} stroke="#D1D5DB" />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="#9CA3AF">{xLabel(t)}</text>
          </g>
        ))}

        {/* Разделители дней (только когда сутки различимы по ширине) */}
        {showDayMarks && dayMarks.filter((t) => t > range.fromMs && t < range.toMs).map((t) => (
          <g key={`d${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={PAD_T + innerH} stroke="#E5E7EB" strokeDasharray="4 4" />
            <text x={x(t) + 3} y={PAD_T + 10} fontSize={9} fill="#9CA3AF">
              {new Date(t + 180 * 60_000).getUTCDate()}.{String(new Date(t + 180 * 60_000).getUTCMonth() + 1).padStart(2, '0')}
            </text>
          </g>
        ))}

        {/* Ступенчатая линия: горизонтальные участки при неизменном значении,
            вертикальный переход на новом измерении; разрыв — линия рвётся. */}
        {segments.map((seg, i) => (
          <path
            key={`seg${i}`}
            d={seg
              .map((p, j) => (j === 0 ? `M ${x(p.xMs).toFixed(1)} ${y(p.valueKm).toFixed(1)}` : `H ${x(p.xMs).toFixed(1)} V ${y(p.valueKm).toFixed(1)}`))
              .join(' ')}
            fill="none"
            stroke="#121316"
            strokeWidth={1.7}
          />
        ))}

        {/* Точки измерений: много точек — без кружков (линия и подсказка точны). */}
        {visible.length <= 300 && visible.map((p, i) => (
          <circle key={`p${i}`} cx={x(p.xMs)} cy={y(p.valueKm)} r={2} fill="#121316" opacity={0.85} />
        ))}

        {/* Выделение участка (brush-zoom, мышь) */}
        {dragRect && Math.abs(x(dragRect.b) - x(dragRect.a)) > 2 && (
          <rect
            x={x(dragRect.a)}
            y={PAD_T}
            width={Math.max(1, x(dragRect.b) - x(dragRect.a))}
            height={innerH}
            fill="rgba(37,99,235,0.12)"
            stroke="#2563EB"
            strokeDasharray="3 2"
          />
        )}

        {/* Ближайшее реальное измерение: точка + вертикальный указатель времени */}
        {hoverPoint && (
          <g pointerEvents="none">
            <line x1={x(hoverPoint.xMs)} x2={x(hoverPoint.xMs)} y1={PAD_T} y2={PAD_T + innerH} stroke="#121316" strokeDasharray="3 3" />
            <circle cx={x(hoverPoint.xMs)} cy={y(hoverPoint.valueKm)} r={4.5} fill="#121316" stroke="#FFFFFF" strokeWidth={1.5} />
          </g>
        )}

        {points.length === 0 && (
          <text x={PAD_L + innerW / 2} y={PAD_T + innerH / 2} textAnchor="middle" fontSize={11} fill="#9CA3AF">
            Измерений показаний за период нет
          </text>
        )}
      </svg>

      {/* Подсказка точного измерения (строго реальная запись) */}
      {hoverPoint && (
        <div
          className="absolute z-10 pointer-events-none bg-[#121316] text-white rounded-lg px-2.5 py-1.5 shadow-lg"
          style={{
            left: Math.min(Math.max(x(hoverPoint.xMs), 96), Math.max(96, width - 96)),
            top: PAD_T + 6,
            transform: 'translateX(-50%)',
          }}
          data-testid="mc-chart-tooltip"
        >
          <div className="text-[11px] font-semibold whitespace-nowrap">{tooltipLines[0]}</div>
          <div className="text-[11px] whitespace-nowrap">{tooltipLines[1]}</div>
          <div className="text-[10px] text-white/70 whitespace-nowrap">{tooltipLines.slice(2).join(' · ')}</div>
        </div>
      )}

      <div className="mt-1.5 text-[10px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-1">
        <span>
          <span className="inline-block w-3 border-t-2 border-[#121316] align-middle mr-1" />
          Показания одометра — источник: odom_can (ступенчатая линия, пояс +03)
        </span>
        <span>разрыв линии — нет измерений дольше {Math.round(gapMs / 60_000)} мин</span>
        <span>наведение/касание — точное измерение; выделение участка — приблизить, двойной клик — весь период</span>
      </div>
    </div>
  );
}
